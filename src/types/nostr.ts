export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface NostrFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  '#e'?: string[];
  '#p'?: string[];
  '#a'?: string[];
  '#d'?: string[];
}

export interface RelayMessage {
  type: 'EVENT' | 'REQ' | 'CLOSE' | 'NOTICE' | 'EOSE' | 'OK' | 'AUTH' | 'COUNT';
  subscriptionId?: string;
  event?: NostrEvent;
  filters?: NostrFilter[];
  message?: string;
  eventId?: string;
  success?: boolean;
  reason?: string;
}

export interface ResearchPaper {
  id: string;
  event_id: string;
  title: string;
  authors: string[];
  abstract: string;
  content?: string;
  status: 'submitted' | 'under_review' | 'accepted' | 'rejected' | 'published';
  created_at: Date;
  published_at?: Date;
  size_bytes: number;
  payment_hash?: string;
  price_paid?: number;
  reviewer_notes?: string;
}

export interface PricingInfo {
  price_per_mb_year: number;
  price_per_comment_mb: number;
  max_content_size: number;
  storage_available_mb: number;
}

export interface LightningInvoice {
  payment_request: string;
  payment_hash: string;
  amount_sats: number;
  expires_at: Date;
  description: string;
  paid?: boolean;
  paid_at?: Date;
  created_at?: Date;
}