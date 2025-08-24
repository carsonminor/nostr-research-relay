import express from 'express';
import WebSocket from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';
import { SQLiteDatabase as Database } from './db/sqlite';
import { NostrService } from './services/nostr';
import { PricingService } from './services/pricing';
import { LightningService } from './services/lightning';
import { StorageService } from './services/storage';
import { createApiRoutes } from './routes/api';
import { createAdminRoutes } from './routes/admin';

dotenv.config();

class NostrResearchRelay {
  private app: express.Application;
  private server: any;
  private wss!: WebSocket.Server;
  private db: Database;
  private nostr: NostrService;
  private pricing: PricingService;
  private lightning: LightningService;
  private storage: StorageService;

  constructor() {
    this.app = express();
    
    // Database path - prefer DATABASE_PATH, fall back to DATABASE_URL, then default
    const dbPath = process.env.DATABASE_PATH || 
                  (process.env.DATABASE_URL?.startsWith('sqlite:') ? 
                   process.env.DATABASE_URL.replace('sqlite:', '') : 
                   process.env.DATABASE_URL) || 
                  './relay.db';
    
    this.db = new Database(dbPath);
    this.pricing = new PricingService(this.db);
    this.storage = new StorageService(process.env.STORAGE_PATH);
    this.lightning = new LightningService({
      host: process.env.LND_HOST || 'localhost:8080',
      macaroonPath: process.env.LND_MACAROON_PATH || '/dev/null',
      tlsCertPath: process.env.LND_TLS_CERT_PATH || '/dev/null'
    });
    this.nostr = new NostrService(this.db, this.pricing, this.storage);
  }

  async initialize(): Promise<void> {
    // Initialize services
    await this.db.initialize();
    await this.storage.initialize();
    await this.lightning.initialize();

    console.log('✅ Services initialized');

    // Setup Express middleware
    this.app.use(cors());
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));
    this.app.use(express.static('public'));

    // Add API routes
    this.app.use('/api', createApiRoutes(this.db, this.pricing, this.lightning, this.storage));
    this.app.use('/admin', createAdminRoutes(this.db, this.pricing, this.lightning, this.storage));

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Relay info endpoint (NIP-11)
    this.app.get('/', async (req, res) => {
      if (req.headers.accept === 'application/nostr+json') {
        const info = await this.getRelayInfo();
        res.json(info);
      } else {
        res.send(`
          <html>
            <head><title>Nostr Research Relay</title></head>
            <body>
              <h1>Nostr Research Journal Relay</h1>
              <p>A specialized Nostr relay for academic research papers with Lightning payments</p>
              <h2>Features:</h2>
              <ul>
                <li>NIP-23 long-form content support</li>
                <li>Lightning Network payments for storage</li>
                <li>Peer review workflow</li>
                <li>Large content storage</li>
              </ul>
              <h2>Endpoints:</h2>
              <ul>
                <li>WebSocket: <code>ws://${req.get('host')}</code></li>
                <li>API: <code>http://${req.get('host')}/api</code></li>
                <li><strong>Admin Dashboard: <a href="/admin.html">http://${req.get('host')}/admin.html</a></strong></li>
              </ul>
            </body>
          </html>
        `);
      }
    });

    // Start HTTP server
    const port = parseInt(process.env.PORT || '8080');
    const host = process.env.HOST || '0.0.0.0'; // Bind to all interfaces
    this.server = this.app.listen(port, host, () => {
      console.log(`🚀 HTTP server running on http://${host}:${port}`);
      console.log(`🌐 Accessible from network at http://<your-ip>:${port}`);
    });

    // Setup WebSocket server
    this.wss = new WebSocket.Server({ server: this.server });
    this.setupWebSocket();

    console.log(`🔗 WebSocket server running on ws://${host}:${port}`);
    console.log(`🔗 WebSocket accessible from network at ws://<your-ip>:${port}`);
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws) => {
      console.log('New WebSocket connection');

      ws.on('message', async (data) => {
        try {
          await this.nostr.handleMessage(ws, data.toString());
        } catch (error) {
          console.error('Error handling WebSocket message:', error);
          ws.send(JSON.stringify(['NOTICE', 'Internal server error']));
        }
      });

      ws.on('close', () => {
        console.log('WebSocket connection closed');
        this.nostr.cleanup(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.nostr.cleanup(ws);
      });
    });
  }

  private async getRelayInfo(): Promise<any> {
    const [name, description, pricingInfo] = await Promise.all([
      this.db.getConfig('relay_name'),
      this.db.getConfig('relay_description'),
      this.pricing.getPricingInfo()
    ]);

    return {
      name: name || 'Research Journal Relay',
      description: description || 'Academic research papers on Nostr with peer review',
      pubkey: process.env.RELAY_PUBKEY || '',
      contact: process.env.RELAY_CONTACT || '',
      supported_nips: [1, 9, 11, 15, 16, 20, 22, 23, 28, 33, 40],
      software: 'https://github.com/research-journal/nostr-relay',
      version: '1.0.0',
      limitation: {
        max_message_length: pricingInfo.max_content_size,
        max_subscriptions: 100,
        max_filters: 10,
        max_limit: 1000,
        max_subid_length: 256,
        max_event_tags: 100,
        max_content_length: pricingInfo.max_content_size,
        min_pow_difficulty: 0,
        auth_required: false,
        payment_required: true,
        restricted_writes: false
      },
      payments_url: process.env.PAYMENTS_URL || '',
      fees: {
        admission: [{ amount: 0, unit: 'msats' }],
        subscription: [{ amount: 0, unit: 'msats' }],
        publication: [
          { 
            kinds: [30023], 
            amount: pricingInfo.price_per_mb_year * 1000, 
            unit: 'msats',
            period: 31536000 // 1 year in seconds
          },
          {
            kinds: [1111],
            amount: pricingInfo.price_per_comment_mb * 1000,
            unit: 'msats'
          }
        ]
      }
    };
  }

  async shutdown(): Promise<void> {
    console.log('Shutting down relay...');
    
    if (this.wss) {
      this.wss.close();
    }
    
    if (this.server) {
      this.server.close();
    }
    
    await this.db.close();
    console.log('✅ Relay shutdown complete');
  }
}

// Start the relay
const relay = new NostrResearchRelay();

relay.initialize().catch((error) => {
  console.error('Failed to start relay:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await relay.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await relay.shutdown();
  process.exit(0);
});