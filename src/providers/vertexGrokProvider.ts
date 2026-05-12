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
 * xAI Grok on Vertex AI (Model-as-a-Service).
 * Different training data lineage from Anthropic / Google / OpenAI / Meta —
 * particularly useful for diversifying away from the universal default-repertoire
 * fixations (mortgage, panic, twinkle) we've seen in the other 4.
 *
 * Default: `grok-4-1-fast-non-reasoning` (fast non-reasoning variant — 10×
 * cheaper than the reasoning variants and our orchestrator already gets
 * "thinking" via the multi-stage pipeline).
 */

interface Pricing { input: number; output: number }
const GROK_PRICING: Record<string, Pricing> = {
  'grok-4-20':                       { input: 5.0, output: 15.0 },
  'grok-4-20-reasoning':             { input: 5.0, output: 25.0 },
  'grok-4-1-fast':                   { input: 0.20, output: 0.50 },
  'grok-4-1-fast-non-reasoning':     { input: 0.20, output: 0.50 },
  'grok-4-1-fast-reasoning':         { input: 0.20, output: 1.50 },
};
const GROK_DEFAULT_PRICING: Pricing = GROK_PRICING['grok-4-1-fast-non-reasoning'];

function priceFor(model: string): Pricing {
  if (GROK_PRICING[model]) return GROK_PRICING[model];
  if (/4-20/.test(model))            return GROK_PRICING['grok-4-20'];
  if (/fast/i.test(model))           return GROK_PRICING['grok-4-1-fast-non-reasoning'];
  return GROK_DEFAULT_PRICING;
}

export class VertexGrokProvider implements ChatProvider {
  readonly name = 'vertex-grok' as const;

  async generate(systemPrompt: string, userPrompt: string, opts: ChatOptions = {}): Promise<ChatResult> {
    const model = config.VERTEX_GROK_GENERATOR_MODEL;
    const url = buildVertexRawPredictUrl('xai', model);
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
      throw new Error(`Vertex Grok ${e.response?.status ?? '???'}: ${detail}`);
    }

    const inputTokens = data.usage.prompt_tokens;
    const outputTokens = data.usage.completion_tokens;
    const pricing = priceFor(model);
    const costUsd =
      (inputTokens * pricing.input) / 1_000_000 +
      (outputTokens * pricing.output) / 1_000_000;
    costLogger.record('vertex-grok', costUsd, { input: inputTokens, output: outputTokens });

    return {
      content: data.choices[0]?.message.content ?? '',
      provider: 'vertex-grok',
      model,
      costUsd,
      inputTokens,
      cachedInputTokens: 0,
      outputTokens,
    };
  }
}
