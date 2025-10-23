import WebSocket from 'ws';
import { NostrEvent, NostrFilter, RelayMessage } from '../types/nostr';
import { SQLiteDatabase as Database } from '../db/sqlite';
import { validateEventSignature, calculateContentSize } from '../utils/crypto';
import { PricingService } from './pricing';
import { StorageService } from './storage';

export class NostrService {
  private db: Database;
  private pricing: PricingService;
  private storage: StorageService;
  private subscriptions: Map<string, { ws: WebSocket; filters: NostrFilter[] }> = new Map();

  constructor(db: Database, pricing: PricingService, storage: StorageService) {
    this.db = db;
    this.pricing = pricing;
    this.storage = storage;
  }

  async handleMessage(ws: WebSocket, message: string): Promise<void> {
    try {
      const parsed = JSON.parse(message);
      const [type, ...args] = parsed;

      switch (type) {
        case 'EVENT':
          await this.handleEvent(ws, args[0]);
          break;
        case 'REQ':
          await this.handleRequest(ws, args[0], ...args.slice(1));
          break;
        case 'CLOSE':
          this.handleClose(ws, args[0]);
          break;
        default:
          this.sendNotice(ws, `Unknown message type: ${type}`);
      }
    } catch (error) {
      console.error('Error handling message:', error);
      this.sendNotice(ws, 'Invalid message format');
    }
  }

  private async handleEvent(ws: WebSocket, event: NostrEvent): Promise<void> {
    try {
      // Validate event signature
      if (!validateEventSignature(event)) {
        this.sendOK(ws, event.id, false, 'Invalid signature');
        return;
      }

      // Check if it's a research paper (kind 30023)
      if (event.kind === 30023) {
        await this.handleResearchPaper(ws, event);
        return;
      }

      // Check if it's a highlight (kind 9802 - NIP-84)
      if (event.kind === 9802) {
        await this.handleHighlight(ws, event);
        return;
      }

      // Check if it's a comment reply (kind 1)
      if (event.kind === 1) {
        await this.handleCommentReply(ws, event);
        return;
      }

      // Check if it's a reaction (kind 7 - NIP-25)
      if (event.kind === 7) {
        await this.handleReaction(ws, event);
        return;
      }

      // Check if it's a comment (kind 1111 - legacy)
      if (event.kind === 1111) {
        await this.handleComment(ws, event);
        return;
      }

      // For other events, save directly
      await this.db.saveEvent(event);
      this.sendOK(ws, event.id, true);
      
      // Broadcast to subscribers
      await this.broadcastEvent(event);
    } catch (error) {
      console.error('Error handling event:', error);
      this.sendOK(ws, event.id, false, 'Server error');
    }
  }

  private async handleResearchPaper(ws: WebSocket, event: NostrEvent): Promise<void> {
    const contentSize = calculateContentSize(event.content);
    const maxSize = parseInt(await this.db.getConfig('max_content_size') || '52428800');

    if (contentSize > maxSize) {
      this.sendOK(ws, event.id, false, 'Content too large');
      return;
    }

    // Extract metadata from tags
    const title = this.getTagValue(event.tags, 'title') || 'Untitled';
    const summary = this.getTagValue(event.tags, 'summary') || '';
    const paymentHash = this.getTagValue(event.tags, 'payment_hash');
    
    // Calculate price
    const priceInfo = await this.pricing.calculatePrice(contentSize);
    
    // Check if payment is required (free for testing if price is 0)
    if (priceInfo.amount_sats > 0) {
      if (!paymentHash) {
        this.sendOK(ws, event.id, false, `Payment required: ${priceInfo.amount_sats} sats. Create invoice first.`);
        return;
      }

      // Verify payment
      const invoice = await this.db.getInvoice(paymentHash);
      if (!invoice) {
        this.sendOK(ws, event.id, false, 'Invalid payment hash');
        return;
      }

      if (!invoice.paid) {
        this.sendOK(ws, event.id, false, 'Payment not completed');
        return;
      }

      if (invoice.amount_sats < priceInfo.amount_sats) {
        this.sendOK(ws, event.id, false, 'Insufficient payment amount');
        return;
      }
    }
    
    // Payment verified or not required - save the paper
    await this.db.saveResearchPaper({
      event_id: event.id,
      title,
      authors: [event.pubkey],
      abstract: summary,
      status: 'published', // Auto-publish if payment is verified
      size_bytes: contentSize,
      payment_hash: paymentHash,
      price_paid: priceInfo.amount_sats,
      published_at: new Date(event.created_at * 1000)
    });

    // Save to organized storage with metadata
    const metadata = {
      title,
      authors: [event.pubkey],
      abstract: summary,
      status: 'published',
      published_at: new Date(event.created_at * 1000).toISOString(),
      payment_hash: paymentHash,
      price_paid: priceInfo.amount_sats
    };
    await this.storage.saveResearchPaper(event.id, event.content, metadata);

    // Save the actual Nostr event to events table
    await this.db.saveEvent(event);

    console.log(`📄 Saved research paper: ${event.id}.md`);
    this.sendOK(ws, event.id, true, 'Paper published successfully');
    
    // Broadcast to subscribers
    await this.broadcastEvent(event);
  }

  private async handleHighlight(ws: WebSocket, event: NostrEvent): Promise<void> {
    // NIP-84 highlights are free to encourage engagement
    await this.db.saveEvent(event);
    this.sendOK(ws, event.id, true);
    
    // Broadcast to subscribers
    await this.broadcastEvent(event);
    
    console.log(`📝 Highlight created: ${event.id.substring(0, 8)} - "${event.content}"`);
  }

  private async handleCommentReply(ws: WebSocket, event: NostrEvent): Promise<void> {
    // Kind 1 replies to highlights - charge for storage
    const contentSize = calculateContentSize(event.content);
    const commentPrice = await this.pricing.calculateCommentPrice(contentSize);

    // Save comment to organized storage
    const highlightEventTag = this.getTagValue(event.tags, 'e');
    const metadata = {
      highlightEvent: highlightEventTag,
      author: event.pubkey,
      type: 'highlight_comment'
    };
    await this.storage.saveComment(event.id, event.content, metadata);

    await this.db.saveEvent(event);
    this.sendOK(ws, event.id, true);
    
    // Broadcast to subscribers
    await this.broadcastEvent(event);
    
    this.sendMessage(ws, ['NOTICE', `Comment posted. Fee: ${commentPrice.amount_sats} sats.`]);
    console.log(`💬 Comment on highlight: ${event.id.substring(0, 8)}`);
  }

  private async handleReaction(ws: WebSocket, event: NostrEvent): Promise<void> {
    // NIP-25 reactions are free
    await this.db.saveEvent(event);
    this.sendOK(ws, event.id, true);
    
    // Broadcast to subscribers
    await this.broadcastEvent(event);
    
    console.log(`👍 Reaction: ${event.content} on ${this.getTagValue(event.tags, 'e')?.substring(0, 8)}`);
  }

  private async handleComment(ws: WebSocket, event: NostrEvent): Promise<void> {
    const contentSize = calculateContentSize(event.content);
    const commentPrice = await this.pricing.calculateCommentPrice(contentSize);

    // For comments, also require payment
    this.sendMessage(ws, ['NOTICE', `Comment price: ${commentPrice.amount_sats} sats. Use /get-comment-invoice endpoint to pay.`]);
    
    // Save comment to organized storage with metadata
    const rootEventTag = this.getTagValue(event.tags, 'E') || this.getTagValue(event.tags, 'e');
    const metadata = {
      rootEvent: rootEventTag,
      author: event.pubkey
    };
    await this.storage.saveComment(event.id, event.content, metadata);

    // Save event but mark as unpaid
    await this.db.saveEvent(event);
    this.sendOK(ws, event.id, true);
  }

  private async handleRequest(ws: WebSocket, subscriptionId: string, ...filters: NostrFilter[]): Promise<void> {
    try {
      // Store subscription
      this.subscriptions.set(subscriptionId, { ws, filters });

      // Get matching events
      const events = await this.db.getEvents(filters);

      // Send events
      for (const event of events) {
        this.sendMessage(ws, ['EVENT', subscriptionId, event]);
      }

      // Send EOSE
      this.sendMessage(ws, ['EOSE', subscriptionId]);
    } catch (error) {
      console.error('Error handling request:', error);
      this.sendNotice(ws, 'Error processing request');
    }
  }

  private handleClose(ws: WebSocket, subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId);
  }

  private async broadcastEvent(event: NostrEvent): Promise<void> {
    for (const [subId, { ws, filters }] of this.subscriptions) {
      if (this.eventMatchesFilters(event, filters)) {
        this.sendMessage(ws, ['EVENT', subId, event]);
      }
    }
  }

  private eventMatchesFilters(event: NostrEvent, filters: NostrFilter[]): boolean {
    return filters.some(filter => {
      if (filter.ids && !filter.ids.includes(event.id)) return false;
      if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
      if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
      if (filter.since && event.created_at < filter.since) return false;
      if (filter.until && event.created_at > filter.until) return false;
      return true;
    });
  }

  private getTagValue(tags: string[][], tagName: string): string | undefined {
    const tag = tags.find(tag => tag[0] === tagName);
    return tag ? tag[1] : undefined;
  }

  private sendMessage(ws: WebSocket, message: any[]): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendOK(ws: WebSocket, eventId: string, success: boolean, reason?: string): void {
    this.sendMessage(ws, ['OK', eventId, success, reason || '']);
  }

  private sendNotice(ws: WebSocket, message: string): void {
    this.sendMessage(ws, ['NOTICE', message]);
  }

  cleanup(ws: WebSocket): void {
    // Remove all subscriptions for this connection
    for (const [subId, subscription] of this.subscriptions) {
      if (subscription.ws === ws) {
        this.subscriptions.delete(subId);
      }
    }
  }
}