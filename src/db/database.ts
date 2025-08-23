import { Pool, PoolClient } from 'pg';
import { NostrEvent, NostrFilter, ResearchPaper, LightningInvoice } from '../types/nostr';

export class Database {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      // Check if tables exist, create if not
      const result = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'events'
        );
      `);
      
      if (!result.rows[0].exists) {
        console.log('Creating database schema...');
        // Read and execute schema.sql
        const fs = require('fs');
        const path = require('path');
        const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
        await client.query(schema);
        console.log('Database schema created successfully');
      }
    } finally {
      client.release();
    }
  }

  async saveEvent(event: NostrEvent): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        INSERT INTO events (id, pubkey, created_at, kind, tags, content, sig)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO NOTHING
      `, [event.id, event.pubkey, event.created_at, event.kind, JSON.stringify(event.tags), event.content, event.sig]);
    } finally {
      client.release();
    }
  }

  async getEvents(filters: NostrFilter[], limit: number = 100): Promise<NostrEvent[]> {
    const client = await this.pool.connect();
    try {
      let query = 'SELECT * FROM events WHERE 1=1';
      const params: any[] = [];
      let paramCount = 0;

      // Build dynamic query based on filters
      for (const filter of filters) {
        if (filter.ids && filter.ids.length > 0) {
          paramCount++;
          query += ` AND id = ANY($${paramCount})`;
          params.push(filter.ids);
        }
        
        if (filter.authors && filter.authors.length > 0) {
          paramCount++;
          query += ` AND pubkey = ANY($${paramCount})`;
          params.push(filter.authors);
        }
        
        if (filter.kinds && filter.kinds.length > 0) {
          paramCount++;
          query += ` AND kind = ANY($${paramCount})`;
          params.push(filter.kinds);
        }
        
        if (filter.since) {
          paramCount++;
          query += ` AND created_at >= $${paramCount}`;
          params.push(filter.since);
        }
        
        if (filter.until) {
          paramCount++;
          query += ` AND created_at <= $${paramCount}`;
          params.push(filter.until);
        }
      }

      query += ' ORDER BY created_at DESC';
      
      if (limit) {
        paramCount++;
        query += ` LIMIT $${paramCount}`;
        params.push(limit);
      }

      const result = await client.query(query, params);
      return result.rows.map(row => ({
        ...row,
        tags: JSON.parse(row.tags)
      }));
    } finally {
      client.release();
    }
  }

  async saveResearchPaper(paper: Omit<ResearchPaper, 'id' | 'created_at'>): Promise<string> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        INSERT INTO research_papers (event_id, title, authors, abstract, status, size_bytes, payment_hash, price_paid, file_path)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `, [
        paper.event_id,
        paper.title,
        JSON.stringify(paper.authors),
        paper.abstract,
        paper.status,
        paper.size_bytes,
        paper.payment_hash,
        paper.price_paid,
        `./storage/${paper.event_id}.md`
      ]);
      
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async updatePaperStatus(eventId: string, status: ResearchPaper['status'], reviewerNotes?: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      const publishedAt = status === 'published' ? new Date() : null;
      await client.query(`
        UPDATE research_papers 
        SET status = $1, reviewer_notes = $2, published_at = $3
        WHERE event_id = $4
      `, [status, reviewerNotes, publishedAt, eventId]);
    } finally {
      client.release();
    }
  }

  async getResearchPapers(status?: string): Promise<ResearchPaper[]> {
    const client = await this.pool.connect();
    try {
      let query = 'SELECT * FROM research_papers';
      const params: any[] = [];
      
      if (status) {
        query += ' WHERE status = $1';
        params.push(status);
      }
      
      query += ' ORDER BY created_at DESC';
      
      const result = await client.query(query, params);
      return result.rows.map(row => ({
        ...row,
        authors: JSON.parse(row.authors)
      }));
    } finally {
      client.release();
    }
  }

  async saveLightningInvoice(invoice: LightningInvoice): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        INSERT INTO lightning_invoices (payment_hash, payment_request, amount_sats, description, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (payment_hash) DO NOTHING
      `, [invoice.payment_hash, invoice.payment_request, invoice.amount_sats, invoice.description, invoice.expires_at]);
    } finally {
      client.release();
    }
  }

  async markInvoicePaid(paymentHash: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        UPDATE lightning_invoices 
        SET paid = TRUE, paid_at = CURRENT_TIMESTAMP
        WHERE payment_hash = $1
      `, [paymentHash]);
    } finally {
      client.release();
    }
  }

  async getInvoice(paymentHash: string): Promise<LightningInvoice | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM lightning_invoices WHERE payment_hash = $1',
        [paymentHash]
      );
      
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  async getConfig(key: string): Promise<string | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT value FROM relay_config WHERE key = $1',
        [key]
      );
      
      return result.rows[0]?.value || null;
    } finally {
      client.release();
    }
  }

  async setConfig(key: string, value: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        INSERT INTO relay_config (key, value, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = CURRENT_TIMESTAMP
      `, [key, value]);
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}