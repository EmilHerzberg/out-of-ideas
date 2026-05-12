import axios from 'axios';
import { config } from '../config.js';
import { costLogger } from '../cost-logger.js';
import {
  getVertexAccessToken,
  buildVertexRawPredictUrl,
  OpenAICompatChatResponse,
} from './vertexAuth.js';
import type { ChatOptions, ChatProvider, ChatResult } from './types.js';

/**
 * AI21 Labs Jamba on Vertex AI (Model-as-a-Service).
 * Hybrid SSM-Transformer architecture — different inductive biases than the
 * decoder-only mainstream, so worth including for diversity.
 *
 * Default model: `jamba-1.5-large`.
 */

interface Pricing { input: number; output: number }
const AI21_PRICING: Record<string, Pricing> = {
  'jamba-1.5-large': { input: 2.0, output: 8.0 },
  'jamba-1.5-mini':  { input: 0.20, output: 0.40 },
};
const AI21_DEFAULT_PRICING: Pricing = AI21_PRICING['jamba-1.5-large'];

function priceFor(model: string): Pricing {
  if (AI21_PRICING[model]) return AI21_PRICING[model];
  if (/mini/i.test(model)) return AI21_PRICING['jamba-1.5-mini'];
  return AI21_DEFAULT_PRICING;
}

export class VertexAI21Provider implements ChatProvider {
  readonly name = 'vertex-ai21' as const;

  async generate(systemPrompt: string, userPrompt: string, opts: ChatOptions = {}): Promise<ChatResult> {
    const model = config.VERTEX_AI21_GENERATOR_MODEL;
    const url = buildVertexRawPredictUrl('ai21', model);
    const token = await getVertexAccessToken();

    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.7,
      stream: false,
    };
    if (opts.jsonMode) body.response_format = { type: 'json_object' };

    let data: OpenAICompatChatResponse;
    try {
      const res = await axios.post<OpenAICompatChatResponse>(url, body, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 90_000,
      });
      data = res.data;
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: unknown }; message?: string };
      const detail = e.response?.data ? JSON.stringify(e.response.data) : (e.message ?? 'unknown error');
      throw new Error(`Vertex AI21 ${e.response?.status ?? '???'}: ${detail}`);
    }

    const inputTokens = data.usage.prompt_tokens;
    const outputTokens = data.usage.completion_tokens;
    const pricing = priceFor(model);
    const costUsd =
      (inputTokens * pricing.input) / 1_000_000 +
      (outputTokens * pricing.output) / 1_000_000;
    costLogger.record('vertex-ai21', costUsd, { input: inputTokens, output: outputTokens });

    return {
      content: data.choices[0]?.message.content ?? '',
      provider: 'vertex-ai21',
      model,
      costUsd,
      inputTokens,
      cachedInputTokens: 0,
      outputTokens,
    };
  }
}
