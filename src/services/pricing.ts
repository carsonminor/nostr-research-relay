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
    // Flat rate pricing for testing - always 1 sat
    const flatRate = parseInt(await this.db.getConfig('flat_rate_sats') || '1');
    const sizeMb = sizeBytes / (1024 * 1024);

    return {
      amount_sats: flatRate,
      size_mb: sizeMb,
      duration_years: durationYears,
      description: `Research paper publication fee (flat rate)`
    };
  }

  async calculateCommentPrice(sizeBytes: number): Promise<PriceCalculation> {
    // Flat rate for comments too - always 1 sat
    const flatRate = parseInt(await this.db.getConfig('flat_rate_sats') || '1');
    const sizeMb = sizeBytes / (1024 * 1024);

    return {
      amount_sats: flatRate,
      size_mb: sizeMb,
      duration_years: 1,
      description: `Comment publication fee (flat rate)`
    };
  }

  async getPricingInfo(): Promise<PricingInfo> {
    const [flatRate, maxContentSize] = await Promise.all([
      this.db.getConfig('flat_rate_sats'),
      this.db.getConfig('max_content_size')
    ]);

    // Calculate available storage (mock for now)
    const storageAvailableMb = await this.calculateAvailableStorage();

    return {
      price_per_mb_year: parseInt(flatRate || '1'), // Show flat rate as the price
      price_per_comment_mb: parseInt(flatRate || '1'),
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