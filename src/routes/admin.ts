import express from 'express';
import { SQLiteDatabase as Database } from '../db/sqlite';
import { PricingService } from '../services/pricing';
import { LightningService } from '../services/lightning';
import { StorageService } from '../services/storage';

export function createAdminRoutes(
  db: Database,
  pricing: PricingService,
  lightning: LightningService,
  storage: StorageService
): express.Router {
  const router = express.Router();

  // Get all events (paginated)
  router.get('/events', async (req, res) => {
    try {
      const { page = 1, limit = 50, kind, author } = req.query;
      const offset = (Number(page) - 1) * Number(limit);
      
      let query = 'SELECT * FROM events WHERE 1=1';
      const params: any[] = [];
      
      if (kind) {
        query += ' AND kind = ?';
        params.push(Number(kind));
      }
      
      if (author) {
        query += ' AND pubkey = ?';
        params.push(author);
      }
      
      query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params.push(Number(limit), offset);
      
      const events = await db.dbAll(query, params);
      
      // Get total count
      let countQuery = 'SELECT COUNT(*) as total FROM events WHERE 1=1';
      const countParams: any[] = [];
      
      if (kind) {
        countQuery += ' AND kind = ?';
        countParams.push(Number(kind));
      }
      
      if (author) {
        countQuery += ' AND pubkey = ?';
        countParams.push(author);
      }
      
      const { total } = await db.dbGet(countQuery, countParams);
      
      res.json({
        events: events.map(event => ({
          ...event,
          tags: JSON.parse(event.tags),
          content_preview: event.content.substring(0, 200) + (event.content.length > 200 ? '...' : ''),
          content_size: Buffer.byteLength(event.content, 'utf8')
        })),
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      });
    } catch (error) {
      console.error('Error fetching events:', error);
      res.status(500).json({ error: 'Failed to fetch events' });
    }
  });

  // Get single event with full content
  router.get('/events/:id', async (req, res) => {
    try {
      const { id } = req.params;
      
      const event = await db.dbGet('SELECT * FROM events WHERE id = ?', [id]);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }
      
      res.json({
        ...event,
        tags: JSON.parse(event.tags),
        content_size: Buffer.byteLength(event.content, 'utf8')
      });
    } catch (error) {
      console.error('Error fetching event:', error);
      res.status(500).json({ error: 'Failed to fetch event' });
    }
  });

  // Delete event
  router.delete('/events/:id', async (req, res) => {
    try {
      const { id } = req.params;
      
      // Check if event exists
      const event = await db.dbGet('SELECT * FROM events WHERE id = ?', [id]);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }
      
      // Delete from database
      await db.dbRun('DELETE FROM events WHERE id = ?', [id]);
      
      // Delete associated research paper if exists
      await db.dbRun('DELETE FROM research_papers WHERE event_id = ?', [id]);
      
      // Delete content file if exists
      await storage.deleteContent(id);
      
      res.json({ success: true, message: 'Event deleted successfully' });
    } catch (error) {
      console.error('Error deleting event:', error);
      res.status(500).json({ error: 'Failed to delete event' });
    }
  });

  // Get relay statistics
  router.get('/stats', async (req, res) => {
    try {
      const stats = await Promise.all([
        db.dbGet('SELECT COUNT(*) as total FROM events'),
        db.dbGet('SELECT COUNT(*) as total FROM events WHERE kind = 30023'), // Research papers
        db.dbGet('SELECT COUNT(*) as total FROM events WHERE kind = 1111'), // Comments
        db.dbGet('SELECT COUNT(*) as total FROM research_papers WHERE status = "published"'),
        db.dbGet('SELECT COUNT(*) as total FROM research_papers WHERE status = "under_review"'),
        db.dbGet('SELECT COUNT(*) as total FROM lightning_invoices WHERE paid = 1'),
        db.dbGet('SELECT SUM(amount_sats) as total FROM lightning_invoices WHERE paid = 1'),
        storage.getStorageStats()
      ]);

      const [
        totalEvents,
        researchPapers,
        comments,
        publishedPapers,
        reviewPapers,
        paidInvoices,
        totalRevenue,
        storageStats
      ] = stats;

      res.json({
        events: {
          total: totalEvents.total,
          research_papers: researchPapers.total,
          comments: comments.total
        },
        papers: {
          published: publishedPapers.total,
          under_review: reviewPapers.total
        },
        revenue: {
          paid_invoices: paidInvoices.total,
          total_sats: totalRevenue.total || 0
        },
        storage: storageStats
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
      res.status(500).json({ error: 'Failed to fetch statistics' });
    }
  });

  // Get current pricing configuration
  router.get('/pricing', async (req, res) => {
    try {
      const pricingInfo = await pricing.getPricingInfo();
      res.json(pricingInfo);
    } catch (error) {
      console.error('Error fetching pricing:', error);
      res.status(500).json({ error: 'Failed to fetch pricing' });
    }
  });

  // Update pricing configuration
  router.put('/pricing', async (req, res) => {
    try {
      const { price_per_mb_year, price_per_comment_mb, max_content_size } = req.body;
      
      if (price_per_mb_year !== undefined) {
        await db.setConfig('price_per_mb_year', price_per_mb_year.toString());
      }
      
      if (price_per_comment_mb !== undefined) {
        await db.setConfig('price_per_comment_mb', price_per_comment_mb.toString());
      }
      
      if (max_content_size !== undefined) {
        await db.setConfig('max_content_size', max_content_size.toString());
      }
      
      const updatedPricing = await pricing.getPricingInfo();
      res.json({ success: true, pricing: updatedPricing });
    } catch (error) {
      console.error('Error updating pricing:', error);
      res.status(500).json({ error: 'Failed to update pricing' });
    }
  });

  // Get relay configuration
  router.get('/config', async (req, res) => {
    try {
      const config = await Promise.all([
        db.getConfig('relay_name'),
        db.getConfig('relay_description'),
        db.getConfig('price_per_mb_year'),
        db.getConfig('price_per_comment_mb'),
        db.getConfig('max_content_size')
      ]);

      const [name, description, pricePerMb, commentPrice, maxSize] = config;

      res.json({
        relay_name: name,
        relay_description: description,
        price_per_mb_year: parseInt(pricePerMb || '1000'),
        price_per_comment_mb: parseInt(commentPrice || '100'),
        max_content_size: parseInt(maxSize || '52428800')
      });
    } catch (error) {
      console.error('Error fetching config:', error);
      res.status(500).json({ error: 'Failed to fetch configuration' });
    }
  });

  // Update relay configuration
  router.put('/config', async (req, res) => {
    try {
      const { relay_name, relay_description } = req.body;
      
      if (relay_name !== undefined) {
        await db.setConfig('relay_name', relay_name);
      }
      
      if (relay_description !== undefined) {
        await db.setConfig('relay_description', relay_description);
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating config:', error);
      res.status(500).json({ error: 'Failed to update configuration' });
    }
  });

  // Get detailed storage information
  router.get('/storage', async (req, res) => {
    try {
      const storageInfo = await storage.getDetailedStorageInfo();
      const fileList = await storage.listFiles('all');
      
      res.json({
        ...storageInfo,
        files: fileList
      });
    } catch (error) {
      console.error('Error fetching storage info:', error);
      res.status(500).json({ error: 'Failed to fetch storage information' });
    }
  });

  // Get recent activity
  router.get('/activity', async (req, res) => {
    try {
      const recentEvents = await db.dbAll(`
        SELECT id, kind, pubkey, created_at, received_at,
               SUBSTR(content, 1, 100) as content_preview
        FROM events 
        ORDER BY received_at DESC 
        LIMIT 20
      `);

      const recentPapers = await db.dbAll(`
        SELECT id, event_id, title, status, created_at
        FROM research_papers 
        ORDER BY created_at DESC 
        LIMIT 10
      `);

      const recentInvoices = await db.dbAll(`
        SELECT payment_hash, amount_sats, description, paid, created_at
        FROM lightning_invoices 
        ORDER BY created_at DESC 
        LIMIT 10
      `);

      res.json({
        recent_events: recentEvents,
        recent_papers: recentPapers.map(paper => ({
          ...paper,
          authors: JSON.parse(paper.authors || '[]')
        })),
        recent_invoices: recentInvoices
      });
    } catch (error) {
      console.error('Error fetching activity:', error);
      res.status(500).json({ error: 'Failed to fetch recent activity' });
    }
  });

  return router;
}