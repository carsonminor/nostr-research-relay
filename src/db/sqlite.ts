import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { NostrEvent, NostrFilter, ResearchPaper, LightningInvoice } from '../types/nostr';

export class SQLiteDatabase {
  private db: sqlite3.Database;
  public dbRun: (sql: string, params?: any[]) => Promise<any>;
  public dbGet: (sql: string, params?: any[]) => Promise<any>;
  public dbAll: (sql: string, params?: any[]) => Promise<any[]>;

  constructor(dbPath: string = './relay.db') {
    this.db = new sqlite3.Database(dbPath);
    this.dbRun = promisify(this.db.run.bind(this.db));
    this.dbGet = promisify(this.db.get.bind(this.db));
    this.dbAll = promisify(this.db.all.bind(this.db));
  }

  async initialize(): Promise<void> {
    // Create tables one by one to avoid issues with multi-statement execution
    const tables = [
      `CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        pubkey TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        kind INTEGER NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        content TEXT NOT NULL,
        sig TEXT NOT NULL,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS research_papers (
        id TEXT PRIMARY KEY,
        event_id TEXT UNIQUE,
        title TEXT NOT NULL,
        authors TEXT NOT NULL DEFAULT '[]',
        abstract TEXT,
        status TEXT DEFAULT 'submitted',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        published_at DATETIME,
        size_bytes INTEGER NOT NULL,
        payment_hash TEXT,
        price_paid INTEGER,
        reviewer_notes TEXT,
        file_path TEXT
      )`,
      
      `CREATE TABLE IF NOT EXISTS lightning_invoices (
        payment_hash TEXT PRIMARY KEY,
        payment_request TEXT NOT NULL,
        amount_sats INTEGER NOT NULL,
        description TEXT,
        expires_at DATETIME NOT NULL,
        paid BOOLEAN DEFAULT FALSE,
        paid_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS relay_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    for (const sql of tables) {
      await this.dbRun(sql);
    }

    // Create indexes
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_events_kind_created ON events(kind, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_events_pubkey_created ON events(pubkey, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_research_papers_status ON research_papers(status)`,
      `CREATE INDEX IF NOT EXISTS idx_research_papers_created ON research_papers(created_at DESC)`
    ];

    for (const sql of indexes) {
      await this.dbRun(sql);
    }

    // Insert default configuration
    const configs = [
      ['price_per_mb_year', '1000'],
      ['price_per_comment_mb', '100'],
      ['max_content_size', '52428800'],
      ['relay_name', 'Research Journal Relay'],
      ['relay_description', 'Academic research papers on Nostr with peer review']
    ];

    for (const [key, value] of configs) {
      await this.dbRun(
        'INSERT OR IGNORE INTO relay_config (key, value) VALUES (?, ?)',
        [key, value]
      );
    }

    console.log('SQLite database initialized');
  }

  async saveEvent(event: NostrEvent): Promise<void> {
    await this.dbRun(`
      INSERT OR IGNORE INTO events (id, pubkey, created_at, kind, tags, content, sig)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [event.id, event.pubkey, event.created_at, event.kind, JSON.stringify(event.tags), event.content, event.sig]);
  }

  async getEvents(filters: NostrFilter[], limit: number = 100): Promise<NostrEvent[]> {
    let query = 'SELECT * FROM events WHERE 1=1';
    const params: any[] = [];

    // Build dynamic query based on filters
    for (const filter of filters) {
      if (filter.ids && filter.ids.length > 0) {
        const placeholders = filter.ids.map(() => '?').join(',');
        query += ` AND id IN (${placeholders})`;
        params.push(...filter.ids);
      }
      
      if (filter.authors && filter.authors.length > 0) {
        const placeholders = filter.authors.map(() => '?').join(',');
        query += ` AND pubkey IN (${placeholders})`;
        params.push(...filter.authors);
      }
      
      if (filter.kinds && filter.kinds.length > 0) {
        const placeholders = filter.kinds.map(() => '?').join(',');
        query += ` AND kind IN (${placeholders})`;
        params.push(...filter.kinds);
      }
      
      if (filter.since) {
        query += ` AND created_at >= ?`;
        params.push(filter.since);
      }
      
      if (filter.until) {
        query += ` AND created_at <= ?`;
        params.push(filter.until);
      }
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = await this.dbAll(query, params);
    return rows.map(row => ({
      ...row,
      tags: JSON.parse(row.tags)
    }));
  }

  async saveResearchPaper(paper: Omit<ResearchPaper, 'id' | 'created_at'>): Promise<string> {
    const id = require('crypto').randomUUID();
    await this.dbRun(`
      INSERT INTO research_papers (id, event_id, title, authors, abstract, status, size_bytes, payment_hash, price_paid, file_path, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      paper.event_id,
      paper.title,
      JSON.stringify(paper.authors),
      paper.abstract,
      paper.status,
      paper.size_bytes,
      paper.payment_hash,
      paper.price_paid,
      `./storage/${paper.event_id}.md`,
      paper.published_at ? paper.published_at.toISOString() : null
    ]);
    
    return id;
  }

  async updatePaperStatus(eventId: string, status: ResearchPaper['status'], reviewerNotes?: string): Promise<void> {
    const publishedAt = status === 'published' ? new Date().toISOString() : null;
    await this.dbRun(`
      UPDATE research_papers 
      SET status = ?, reviewer_notes = ?, published_at = ?
      WHERE event_id = ?
    `, [status, reviewerNotes, publishedAt, eventId]);
  }

  async getResearchPapers(status?: string): Promise<ResearchPaper[]> {
    let query = 'SELECT * FROM research_papers';
    const params: any[] = [];
    
    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY created_at DESC';
    
    const rows = await this.dbAll(query, params);
    return rows.map(row => ({
      ...row,
      authors: JSON.parse(row.authors),
      created_at: new Date(row.created_at),
      published_at: row.published_at ? new Date(row.published_at) : undefined
    }));
  }

  async saveLightningInvoice(invoice: LightningInvoice): Promise<void> {
    await this.dbRun(`
      INSERT OR IGNORE INTO lightning_invoices (payment_hash, payment_request, amount_sats, description, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `, [invoice.payment_hash, invoice.payment_request, invoice.amount_sats, invoice.description, invoice.expires_at.toISOString()]);
  }

  async markInvoicePaid(paymentHash: string): Promise<void> {
    await this.dbRun(`
      UPDATE lightning_invoices 
      SET paid = TRUE, paid_at = CURRENT_TIMESTAMP
      WHERE payment_hash = ?
    `, [paymentHash]);
  }

  async getInvoice(paymentHash: string): Promise<LightningInvoice | null> {
    const row = await this.dbGet(
      'SELECT * FROM lightning_invoices WHERE payment_hash = ?',
      [paymentHash]
    );
    
    if (!row) return null;

    return {
      ...row,
      expires_at: new Date(row.expires_at),
      paid_at: row.paid_at ? new Date(row.paid_at) : undefined,
      created_at: row.created_at ? new Date(row.created_at) : undefined
    };
  }

  async getConfig(key: string): Promise<string | null> {
    const row = await this.dbGet(
      'SELECT value FROM relay_config WHERE key = ?',
      [key]
    );
    
    return row?.value || null;
  }

  async setConfig(key: string, value: string): Promise<void> {
    await this.dbRun(`
      INSERT OR REPLACE INTO relay_config (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `, [key, value]);
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}