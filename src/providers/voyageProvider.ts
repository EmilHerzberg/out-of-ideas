import axios, { AxiosInstance } from 'axios';
import { requireKey } from '../config.js';
import { costLogger } from '../cost-logger.js';
import type { EmbedResult, EmbeddingProvider } from './types.js';

/**
 * Voyage AI — voyage-3-large. 1024-dim embeddings.
 *
 * We use the REST API directly (rather than depending on the voyageai npm
 * package's surface area, which has shifted across versions). Endpoint:
 * https://api.voyageai.com/v1/embeddings
 */

const MODEL = 'voyage-3-large';
const DIMENSION = 1024;
// $0.06 per million tokens. Verify at https://docs.voyageai.com/docs/pricing
const PRICE_PER_MTOK = 0.06;

interface VoyageResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage: { total_tokens: number };
}

export class VoyageProvider implements EmbeddingProvider {
  readonly name = 'voyage' as const;
  readonly dimension = DIMENSION;
  private http: AxiosInstance;

  constructor() {
    const apiKey = requireKey('VOYAGE_API_KEY', 'voyage');
    this.http = axios.create({
      baseURL: 'https://api.voyageai.com/v1',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60_000,
    });
  }

  async embed(text: string): Promise<EmbedResult> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<EmbedResult[]> {
    if (texts.length === 0) return [];
    // Voyage allows up to 128 inputs per request.
    if (texts.length > 128) {
      throw new Error(
        `embedBatch supports up to 128 inputs at a time; got ${texts.length}. Chunk before calling.`,
      );
    }

    const { data } = await this.http.post<VoyageResponse>('/embeddings', {
      model: MODEL,
      input: texts,
      input_type: 'document',
    });

    const totalTokens = data.usage.total_tokens;
    const totalCost = (totalTokens * PRICE_PER_MTOK) / 1_000_000;
    // Approximate per-input cost by spreading total cost evenly.
    const perInputCost = totalCost / texts.length;

    costLogger.record('voyage', totalCost, { input: totalTokens });

    // Voyage returns results possibly out of order; sort by index.
    const sorted = [...data.data].sort((a, b) => a.index - b.index);

    return sorted.map((r) => {
      if (r.embedding.length !== DIMENSION) {
        throw new Error(
          `Voyage returned ${r.embedding.length}-dim embedding; expected ${DIMENSION}.`,
        );
      }
      return {
        vector: r.embedding,
        provider: 'voyage' as const,
        costUsd: perInputCost,
      };
    });
  }
}
