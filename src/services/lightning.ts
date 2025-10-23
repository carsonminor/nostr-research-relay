import axios from 'axios';
import * as fs from 'fs';
import 'websocket-polyfill'; // Required for Alby SDK in Node.js
import { NWCClient } from '@getalby/sdk';
import { LightningInvoice } from '../types/nostr';
import { generatePaymentHash } from '../utils/crypto';

export interface LNDConfig {
  host: string;
  macaroonPath: string;
  tlsCertPath: string;
}

export interface NWCConfig {
  connectionString: string;
}

export class LightningService {
  private config: LNDConfig;
  private nwcConfig?: NWCConfig;
  private macaroon: string;
  private nwcClient?: NWCClient;

  constructor(config: LNDConfig, nwcConfig?: NWCConfig) {
    this.config = config;
    this.nwcConfig = nwcConfig;
    this.macaroon = '';
  }

  async initialize(): Promise<void> {
    // Try NWC first if configured
    if (this.nwcConfig?.connectionString) {
      try {
        this.nwcClient = new NWCClient({
          nostrWalletConnectUrl: this.nwcConfig.connectionString
        });
        console.log('Lightning service initialized with NWC connection using Alby SDK');
        return;
      } catch (error) {
        console.error('Failed to initialize NWC with Alby SDK:', error);
      }
    }

    // Fallback to LND
    try {
      if (this.config.macaroonPath === '/dev/null') {
        throw new Error('Mock mode');
      }
      // Read macaroon file and convert to hex
      const macaroonBuffer = await fs.promises.readFile(this.config.macaroonPath);
      this.macaroon = macaroonBuffer.toString('hex');
      console.log('Lightning service initialized with LND connection');
    } catch (error) {
      console.warn('Lightning service not configured - running in mock mode');
      this.macaroon = 'mock';
    }
  }

  async createInvoice(amountSats: number, description: string, expiry: number = 3600): Promise<LightningInvoice> {
    // Use real NWC if configured
    if (this.nwcClient) {
      return this.createNWCInvoice(amountSats, description, expiry);
    }

    // Use mock if no real wallet
    if (this.macaroon === 'mock') {
      return this.createMockInvoice(amountSats, description, expiry);
    }

    // Use LND
    try {
      const response = await axios.post(
        `https://${this.config.host}/v1/invoices`,
        {
          value: amountSats,
          memo: description,
          expiry: expiry
        },
        {
          headers: {
            'Grpc-Metadata-macaroon': this.macaroon,
            'Content-Type': 'application/json'
          },
          httpsAgent: new (require('https').Agent)({
            ca: await fs.promises.readFile(this.config.tlsCertPath)
          })
        }
      );

      return {
        payment_request: response.data.payment_request,
        payment_hash: response.data.r_hash,
        amount_sats: amountSats,
        description,
        expires_at: new Date(Date.now() + expiry * 1000)
      };
    } catch (error) {
      console.error('Error creating Lightning invoice:', error);
      throw new Error('Failed to create Lightning invoice');
    }
  }

  private async createNWCInvoice(amountSats: number, description: string, expiry: number): Promise<LightningInvoice> {
    if (!this.nwcClient) {
      throw new Error('NWC client not configured');
    }

    console.log(`🧾 Creating NWC invoice for ${amountSats} sats using Alby SDK: "${description}"`);

    try {
      // Use Alby SDK to create invoice
      const response = await this.nwcClient.makeInvoice({
        amount: amountSats * 1000, // Convert sats to msats
        description: description,
        expiry: expiry
      });

      console.log(`✅ Created NWC invoice using Alby SDK:`, response);

      const invoice = {
        payment_request: response.invoice,
        payment_hash: response.payment_hash,
        amount_sats: amountSats,
        description,
        expires_at: new Date(Date.now() + expiry * 1000)
      };

      return invoice;

    } catch (error) {
      console.error('❌ Error creating NWC invoice with Alby SDK:', error);
      throw new Error(`Failed to create NWC invoice: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async checkInvoice(paymentHash: string): Promise<{ paid: boolean; settled_at?: Date }> {
    // Use real NWC if configured
    if (this.nwcClient) {
      return this.checkNWCInvoice(paymentHash);
    }

    // Use mock if no real wallet
    if (this.macaroon === 'mock') {
      return this.checkMockInvoice(paymentHash);
    }

    // Use LND
    try {
      const response = await axios.get(
        `https://${this.config.host}/v1/invoice/${paymentHash}`,
        {
          headers: {
            'Grpc-Metadata-macaroon': this.macaroon
          },
          httpsAgent: new (require('https').Agent)({
            ca: await fs.promises.readFile(this.config.tlsCertPath)
          })
        }
      );

      const invoice = response.data;
      return {
        paid: invoice.settled,
        settled_at: invoice.settle_date ? new Date(parseInt(invoice.settle_date) * 1000) : undefined
      };
    } catch (error) {
      console.error('Error checking Lightning invoice:', error);
      return { paid: false };
    }
  }

  private async checkNWCInvoice(paymentHash: string): Promise<{ paid: boolean; settled_at?: Date }> {
    if (!this.nwcClient) {
      throw new Error('NWC client not configured');
    }

    console.log(`🔍 Checking NWC invoice payment status using Alby SDK: ${paymentHash}`);

    try {
      // Use Alby SDK to lookup invoice
      const response = await this.nwcClient.lookupInvoice({
        payment_hash: paymentHash
      });

      console.log(`✅ NWC invoice lookup result:`, response);

      return {
        paid: response.state === 'settled',
        settled_at: response.settled_at ? new Date(response.settled_at * 1000) : undefined
      };

    } catch (error) {
      console.error('❌ Error checking NWC invoice with Alby SDK:', error);
      return { paid: false };
    }
  }

  async getBalance(): Promise<{ confirmed: number; unconfirmed: number }> {
    if (this.macaroon === 'mock') {
      return { confirmed: 1000000, unconfirmed: 0 }; // 1M sats
    }

    try {
      const response = await axios.get(
        `https://${this.config.host}/v1/balance/blockchain`,
        {
          headers: {
            'Grpc-Metadata-macaroon': this.macaroon
          },
          httpsAgent: new (require('https').Agent)({
            ca: await fs.promises.readFile(this.config.tlsCertPath)
          })
        }
      );

      return {
        confirmed: parseInt(response.data.confirmed_balance),
        unconfirmed: parseInt(response.data.unconfirmed_balance)
      };
    } catch (error) {
      console.error('Error getting Lightning balance:', error);
      return { confirmed: 0, unconfirmed: 0 };
    }
  }

  private createMockInvoice(amountSats: number, description: string, expiry: number): LightningInvoice {
    const paymentHash = generatePaymentHash();
    const paymentRequest = `lnbc${amountSats}u1p${paymentHash.substring(0, 10)}mock`;
    
    return {
      payment_request: paymentRequest,
      payment_hash: paymentHash,
      amount_sats: amountSats,
      description,
      expires_at: new Date(Date.now() + expiry * 1000)
    };
  }

  private checkMockInvoice(paymentHash: string): { paid: boolean; settled_at?: Date } {
    // In mock mode, always return paid for testing with 1 sat
    console.log(`✅ Mock invoice check: ${paymentHash} - automatically marking as PAID for testing`);
    return {
      paid: true,
      settled_at: new Date()
    };
  }
}