import express from 'express';
import { SQLiteDatabase as Database } from '../db/sqlite';
import { PricingService } from '../services/pricing';
import { LightningService } from '../services/lightning';
import { StorageService } from '../services/storage';

export function createApiRoutes(
  db: Database,
  pricing: PricingService,
  lightning: LightningService,
  storage: StorageService
): express.Router {
  const router = express.Router();

  // Get relay information
  router.get('/info', async (req, res) => {
    try {
      const [name, description, pricingInfo, storageStats, balance] = await Promise.all([
        db.getConfig('relay_name'),
        db.getConfig('relay_description'),
        pricing.getPricingInfo(),
        storage.getStorageStats(),
        lightning.getBalance()
      ]);

      res.json({
        name: name || 'Research Journal Relay',
        description: description || 'Academic research papers on Nostr',
        supported_nips: [1, 22, 23],
        software: 'nostr-research-relay',
        version: '1.0.0',
        pricing: pricingInfo,
        storage: storageStats,
        lightning_balance: balance
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get relay info' });
    }
  });

  // Get pricing for content
  router.post('/pricing', async (req, res) => {
    try {
      const { size_bytes, duration_years = 1 } = req.body;
      
      if (!size_bytes || size_bytes <= 0) {
        return res.status(400).json({ error: 'Invalid size_bytes' });
      }

      const price = await pricing.calculatePrice(size_bytes, duration_years);
      res.json(price);
    } catch (error) {
      res.status(500).json({ error: 'Failed to calculate pricing' });
    }
  });

  // Create Lightning invoice for research paper
  router.post('/invoice', async (req, res) => {
    try {
      const { event_id, size_bytes, duration_years = 1 } = req.body;
      
      if (!event_id || !size_bytes) {
        return res.status(400).json({ error: 'Missing event_id or size_bytes' });
      }

      const price = await pricing.calculatePrice(size_bytes, duration_years);
      const invoice = await lightning.createInvoice(
        price.amount_sats,
        `Research paper storage: ${event_id}`,
        3600 // 1 hour expiry
      );

      await db.saveLightningInvoice(invoice);

      res.json({
        payment_request: invoice.payment_request,
        payment_hash: invoice.payment_hash,
        amount_sats: invoice.amount_sats,
        expires_at: invoice.expires_at,
        description: invoice.description
      });
    } catch (error) {
      console.error('Error creating invoice:', error);
      res.status(500).json({ error: 'Failed to create invoice' });
    }
  });

  // Create Lightning invoice for comment
  router.post('/comment-invoice', async (req, res) => {
    try {
      const { event_id, size_bytes } = req.body;
      
      if (!event_id || !size_bytes) {
        return res.status(400).json({ error: 'Missing event_id or size_bytes' });
      }

      const price = await pricing.calculateCommentPrice(size_bytes);
      const invoice = await lightning.createInvoice(
        price.amount_sats,
        `Comment storage: ${event_id}`,
        3600
      );

      await db.saveLightningInvoice(invoice);

      res.json({
        payment_request: invoice.payment_request,
        payment_hash: invoice.payment_hash,
        amount_sats: invoice.amount_sats,
        expires_at: invoice.expires_at,
        description: invoice.description
      });
    } catch (error) {
      console.error('Error creating comment invoice:', error);
      res.status(500).json({ error: 'Failed to create comment invoice' });
    }
  });

  // Check payment status
  router.get('/payment/:payment_hash', async (req, res) => {
    try {
      const { payment_hash } = req.params;
      const invoice = await db.getInvoice(payment_hash);
      
      if (!invoice) {
        return res.status(404).json({ error: 'Invoice not found' });
      }

      const status = await lightning.checkInvoice(payment_hash);
      
      if (status.paid && !invoice.paid) {
        await db.markInvoicePaid(payment_hash);
      }

      res.json({
        paid: status.paid,
        settled_at: status.settled_at,
        amount_sats: invoice.amount_sats,
        expires_at: invoice.expires_at
      });
    } catch (error) {
      console.error('Error checking payment:', error);
      res.status(500).json({ error: 'Failed to check payment' });
    }
  });

  // Get research papers
  router.get('/papers', async (req, res) => {
    try {
      const { status, limit = 50 } = req.query;
      const papers = await db.getResearchPapers(status as string);
      
      // Only return published papers unless admin
      const filteredPapers = papers
        .filter(paper => !status || paper.status === 'published')
        .slice(0, parseInt(limit as string))
        .map(paper => ({
          id: paper.id,
          event_id: paper.event_id,
          title: paper.title,
          authors: paper.authors,
          abstract: paper.abstract,
          status: paper.status,
          created_at: paper.created_at,
          published_at: paper.published_at,
          size_bytes: paper.size_bytes
        }));

      res.json(filteredPapers);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get papers' });
    }
  });

  // Get paper content
  router.get('/papers/:event_id/content', async (req, res) => {
    try {
      const { event_id } = req.params;
      const papers = await db.getResearchPapers();
      const paper = papers.find(p => p.event_id === event_id);
      
      if (!paper) {
        return res.status(404).json({ error: 'Paper not found' });
      }

      // For testing, allow any status (not just published)
      const content = await storage.getContent(event_id, 'paper');
      if (!content) {
        return res.status(404).json({ error: 'Content not found' });
      }

      res.json({
        event_id,
        title: paper.title,
        authors: paper.authors,
        abstract: paper.abstract,
        content,
        published_at: paper.published_at,
        size_bytes: paper.size_bytes
      });
    } catch (error) {
      console.error('Error getting paper content:', error);
      res.status(500).json({ error: 'Failed to get paper content' });
    }
  });

  // Get highlights and comments for a paper
  router.get('/papers/:event_id/highlights', async (req, res) => {
    try {
      const { event_id } = req.params;
      console.log('Getting highlights for paper:', event_id);
      
      // Get all highlights for this paper (kind 9802)
      const highlights = await db.dbAll(`
        SELECT * FROM events 
        WHERE kind = 9802 
        AND tags LIKE '%["e","' || ? || '"]%'
        ORDER BY created_at DESC
      `, [event_id]);
      
      console.log('Found highlights:', highlights.length);
      console.log('Sample highlight tags:', highlights[0]?.tags);

      // Get all comments on highlights (kind 1)
      const highlightIds = highlights.map(h => h.id);
      const comments = await db.dbAll(`
        SELECT * FROM events 
        WHERE kind = 1 
        AND tags LIKE '%"e"%'
        ORDER BY created_at DESC
      `);

      // Get reactions (kind 7)
      const reactions = await db.dbAll(`
        SELECT * FROM events 
        WHERE kind = 7 
        ORDER BY created_at DESC
      `);

      // Group comments by highlight
      const highlightsWithComments = highlights.map(highlight => {
        const highlightComments = comments.filter(comment => {
          const tags = JSON.parse(comment.tags);
          return tags.some((tag: string[]) => tag[0] === 'e' && tag[1] === highlight.id);
        });

        const commentsWithReactions = highlightComments.map(comment => {
          const commentReactions = reactions.filter(reaction => {
            const tags = JSON.parse(reaction.tags);
            return tags.some((tag: string[]) => tag[0] === 'e' && tag[1] === comment.id);
          });

          return {
            ...comment,
            tags: JSON.parse(comment.tags),
            reactions: commentReactions.map(r => ({
              ...r,
              tags: JSON.parse(r.tags)
            }))
          };
        });

        return {
          ...highlight,
          tags: JSON.parse(highlight.tags),
          comments: commentsWithReactions
        };
      });

      res.json(highlightsWithComments);
    } catch (error) {
      console.error('Error getting highlights:', error);
      res.status(500).json({ error: 'Failed to get highlights' });
    }
  });

  // Admin routes (should be protected in production)
  router.put('/admin/papers/:event_id/status', async (req, res) => {
    try {
      const { event_id } = req.params;
      const { status, reviewer_notes } = req.body;
      
      if (!['submitted', 'under_review', 'accepted', 'rejected', 'published'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      await db.updatePaperStatus(event_id, status, reviewer_notes);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update paper status' });
    }
  });

  router.get('/admin/papers', async (req, res) => {
    try {
      const papers = await db.getResearchPapers();
      res.json(papers);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get admin papers' });
    }
  });

  router.put('/admin/pricing', async (req, res) => {
    try {
      const { price_per_mb_year, price_per_comment_mb } = req.body;
      await pricing.updatePricing(price_per_mb_year, price_per_comment_mb);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update pricing' });
    }
  });

  return router;
}