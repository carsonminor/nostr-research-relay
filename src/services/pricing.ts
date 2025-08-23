import { SQLiteDatabase as Database } from '../db/sqlite';
import { PricingInfo } from '../types/nostr';

export interface PriceCalculation {
  amount_sats: number;
  size_mb: number;
  duration_years: number;
  description: string;
}

export class PricingService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async calculatePrice(sizeBytes: number, durationYears: number = 1): Promise<PriceCalculation> {
    const pricePerMbYear = parseInt(await this.db.getConfig('price_per_mb_year') || '1000');
    const sizeMb = sizeBytes / (1024 * 1024);
    const amountSats = Math.ceil(sizeMb * pricePerMbYear * durationYears);

    return {
      amount_sats: amountSats,
      size_mb: sizeMb,
      duration_years: durationYears,
      description: `Storage for ${sizeMb.toFixed(2)}MB for ${durationYears} year(s)`
    };
  }

  async calculateCommentPrice(sizeBytes: number): Promise<PriceCalculation> {
    const pricePerMb = parseInt(await this.db.getConfig('price_per_comment_mb') || '100');
    const sizeMb = sizeBytes / (1024 * 1024);
    const amountSats = Math.ceil(sizeMb * pricePerMb);

    return {
      amount_sats: Math.max(amountSats, 1), // Minimum 1 sat
      size_mb: sizeMb,
      duration_years: 1,
      description: `Comment storage for ${sizeMb.toFixed(4)}MB`
    };
  }

  async getPricingInfo(): Promise<PricingInfo> {
    const [pricePerMbYear, pricePerCommentMb, maxContentSize] = await Promise.all([
      this.db.getConfig('price_per_mb_year'),
      this.db.getConfig('price_per_comment_mb'),
      this.db.getConfig('max_content_size')
    ]);

    // Calculate available storage (mock for now)
    const storageAvailableMb = await this.calculateAvailableStorage();

    return {
      price_per_mb_year: parseInt(pricePerMbYear || '1000'),
      price_per_comment_mb: parseInt(pricePerCommentMb || '100'),
      max_content_size: parseInt(maxContentSize || '52428800'),
      storage_available_mb: storageAvailableMb
    };
  }

  async updatePricing(pricePerMbYear?: number, pricePerCommentMb?: number): Promise<void> {
    if (pricePerMbYear !== undefined) {
      await this.db.setConfig('price_per_mb_year', pricePerMbYear.toString());
    }
    
    if (pricePerCommentMb !== undefined) {
      await this.db.setConfig('price_per_comment_mb', pricePerCommentMb.toString());
    }
  }

  private async calculateAvailableStorage(): Promise<number> {
    // TODO: Implement actual storage calculation
    // For now, return a mock value (10GB)
    return 10240;
  }

  async validatePayment(eventId: string, paymentHash: string, amountPaid: number): Promise<boolean> {
    // Get the original price calculation for this content
    const papers = await this.db.getResearchPapers();
    const paper = papers.find(p => p.event_id === eventId);
    
    if (!paper) {
      return false;
    }

    const expectedPrice = await this.calculatePrice(paper.size_bytes);
    
    // Allow for small rounding differences
    return amountPaid >= expectedPrice.amount_sats * 0.95;
  }
}