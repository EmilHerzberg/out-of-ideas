import axios, { AxiosInstance } from 'axios';
import { requireKey } from '../config.js';
import { costLogger } from '../cost-logger.js';
import type { EmbedResult, EmbeddingProvider } from './types.js';

/**
 * DashScope text-embedding-v4 (Qwen3-Embedding family) — Chinese-side
 * embedding alternative to Voyage-3-large.
 *
 * 1024 dim by default (matches Voyage so dedup thresholds stay comparable).
 * Note: vector-space lock-in still applies — re-embedding the entire corpus
 * is required to switch from one provider to the other.
 */

const MODEL = 'text-embedding-v4';
const DIMENSION = 1024;

// Pricing — verify at https://www.alibabacloud.com/help/en/model-studio/billing-overview
// text-embedding-v4 approximate $0.07/M tokens (verify at impl time).
const PRICE_PER_MTOK = 0.07;

interface DashScopeEmbedResponse {
  output: {
    embeddings: Array<{ embedding: number[]; text_index: number }>;
  };
  usage: {
    total_tokens: number;
  };
}

export class DashScopeEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'dashscope' as const;
  readonly dimension = DIMENSION;
  private http: AxiosInstance;

  constructor() {
    const apiKey = requireKey('DASHSCOPE_API_KEY', 'dashscope (embedder)');
    this.http = axios.create({
      baseURL: 'https://dashscope.aliyuncs.com/api/v1',
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
    if (texts.length > 25) {
      // DashScope text-embedding-v4 caps at 25 inputs per request.
      throw new Error(
        `embedBatch supports up to 25 inputs at a time for DashScope; got ${texts.length}.`,
      );
    }

    const { data } = await this.http.post<DashScopeEmbedResponse>(
      '/services/embeddings/text-embedding/text-embedding',
      {
        model: MODEL,
        input: { texts },
        parameters: {
          text_type: 'document',
          dimension: DIMENSION,
        },
      },
    );

    const totalTokens = data.usage.total_tokens;
    const totalCost = (totalTokens * PRICE_PER_MTOK) / 1_000_000;
    const perInputCost = totalCost / texts.length;

    costLogger.record('dashscope', totalCost, { input: totalTokens });

    // Sort by text_index to match input order.
    const sorted = [...data.output.embeddings].sort(
      (a, b) => a.text_index - b.text_index,
    );

    return sorted.map((r) => {
      if (r.embedding.length !== DIMENSION) {
        throw new Error(
          `DashScope returned ${r.embedding.length}-dim embedding; expected ${DIMENSION}.`,
        );
      }
      return {
        vector: r.embedding,
        provider: 'dashscope' as const,
        costUsd: perInputCost,
      };
    });
  }
}
