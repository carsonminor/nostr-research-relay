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

      // Check if it's a comment (kind 1111)
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
    
    // Calculate price and create invoice
    const priceInfo = await this.pricing.calculatePrice(contentSize);
    
    // For now, mark as submitted - will require payment before acceptance
    await this.db.saveResearchPaper({
      event_id: event.id,
      title,
      authors: [event.pubkey],
      abstract: summary,
      status: 'submitted',
      size_bytes: contentSize,
      payment_hash: undefined,
      price_paid: undefined
    });

    // Save to organized storage with metadata
    const metadata = {
      title,
      authors: [event.pubkey],
      abstract: summary,
      status: 'submitted'
    };
    await this.storage.saveResearchPaper(event.id, event.content, metadata);

    // Send pricing info back to client
    this.sendMessage(ws, ['NOTICE', `Paper submitted. Price: ${priceInfo.amount_sats} sats. Use /get-invoice endpoint to pay.`]);
    this.sendOK(ws, event.id, true);
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