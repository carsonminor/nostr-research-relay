import { createHash } from 'crypto';
import { NostrEvent } from '../types/nostr';

export function getEventHash(event: Omit<NostrEvent, 'id' | 'sig'>): string {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content
  ]);
  
  return createHash('sha256').update(serialized).digest('hex');
}

export function validateEventSignature(event: NostrEvent): boolean {
  const expectedId = getEventHash(event);
  return event.id === expectedId;
}

export function calculateContentSize(content: string): number {
  return Buffer.byteLength(content, 'utf8');
}

export function generatePaymentHash(): string {
  return createHash('sha256').update(Math.random().toString()).digest('hex');
}