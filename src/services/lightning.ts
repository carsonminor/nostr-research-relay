import axios from 'axios';
import * as fs from 'fs';
import { LightningInvoice } from '../types/nostr';
import { generatePaymentHash } from '../utils/crypto';

export interface LNDConfig {
  host: string;
  macaroonPath: string;
  tlsCertPath: string;
}

export class LightningService {
  private config: LNDConfig;
  private macaroon: string;

  constructor(config: LNDConfig) {
    this.config = config;
    this.macaroon = '';
  }

  async initialize(): Promise<void> {
    try {
      if (this.config.macaroonPath === '/dev/null') {
        throw new Error('Mock mode');
      }
      // Read macaroon file and convert to hex
      const macaroonBuffer = await fs.promises.readFile(this.config.macaroonPath);
      this.macaroon = macaroonBuffer.toString('hex');
      console.log('Lightning service initialized with LND connection');
    } catch (error) {
      console.warn('Lightning service not configured - running in mock mode');
      this.macaroon = 'mock';
    }
  }

  async createInvoice(amountSats: number, description: string, expiry: number = 3600): Promise<LightningInvoice> {
    if (this.macaroon === 'mock') {
      return this.createMockInvoice(amountSats, description, expiry);
    }

    try {
      const response = await axios.post(
        `https://${this.config.host}/v1/invoices`,
        {
          value: amountSats,
          memo: description,
          expiry: expiry
        },
        {
          headers: {
            'Grpc-Metadata-macaroon': this.macaroon,
            'Content-Type': 'application/json'
          },
          httpsAgent: new (require('https').Agent)({
            ca: await fs.promises.readFile(this.config.tlsCertPath)
          })
        }
      );

      return {
        payment_request: response.data.payment_request,
        payment_hash: response.data.r_hash,
        amount_sats: amountSats,
        description,
        expires_at: new Date(Date.now() + expiry * 1000)
      };
    } catch (error) {
      console.error('Error creating Lightning invoice:', error);
      throw new Error('Failed to create Lightning invoice');
    }
  }

  async checkInvoice(paymentHash: string): Promise<{ paid: boolean; settled_at?: Date }> {
    if (this.macaroon === 'mock') {
      return this.checkMockInvoice(paymentHash);
    }

    try {
      const response = await axios.get(
        `https://${this.config.host}/v1/invoice/${paymentHash}`,
        {
          headers: {
            'Grpc-Metadata-macaroon': this.macaroon
          },
          httpsAgent: new (require('https').Agent)({
            ca: await fs.promises.readFile(this.config.tlsCertPath)
          })
        }
      );

      const invoice = response.data;
      return {
        paid: invoice.settled,
        settled_at: invoice.settle_date ? new Date(parseInt(invoice.settle_date) * 1000) : undefined
      };
    } catch (error) {
      console.error('Error checking Lightning invoice:', error);
      return { paid: false };
    }
  }

  async getBalance(): Promise<{ confirmed: number; unconfirmed: number }> {
    if (this.macaroon === 'mock') {
      return { confirmed: 1000000, unconfirmed: 0 }; // 1M sats
    }

    try {
      const response = await axios.get(
        `https://${this.config.host}/v1/balance/blockchain`,
        {
          headers: {
            'Grpc-Metadata-macaroon': this.macaroon
          },
          httpsAgent: new (require('https').Agent)({
            ca: await fs.promises.readFile(this.config.tlsCertPath)
          })
        }
      );

      return {
        confirmed: parseInt(response.data.confirmed_balance),
        unconfirmed: parseInt(response.data.unconfirmed_balance)
      };
    } catch (error) {
      console.error('Error getting Lightning balance:', error);
      return { confirmed: 0, unconfirmed: 0 };
    }
  }

  private createMockInvoice(amountSats: number, description: string, expiry: number): LightningInvoice {
    const paymentHash = generatePaymentHash();
    const paymentRequest = `lnbc${amountSats}u1p${paymentHash.substring(0, 10)}mock`;
    
    return {
      payment_request: paymentRequest,
      payment_hash: paymentHash,
      amount_sats: amountSats,
      description,
      expires_at: new Date(Date.now() + expiry * 1000)
    };
  }

  private checkMockInvoice(paymentHash: string): { paid: boolean; settled_at?: Date } {
    // In mock mode, randomly return paid status for testing
    const paid = Math.random() > 0.5;
    return {
      paid,
      settled_at: paid ? new Date() : undefined
    };
  }
}