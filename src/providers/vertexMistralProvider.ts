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
 * Mistral AI on Vertex AI (Model-as-a-Service).
 * Uses Google service-account credentials — no Mistral API key needed.
 *
 * Default model: `mistral-large-2411` (top-tier multilingual).
 * Override via `VERTEX_MISTRAL_GENERATOR_MODEL`.
 */

interface Pricing { input: number; output: number }
const MISTRAL_PRICING: Record<string, Pricing> = {
  'mistral-large-2411':  { input: 2.0, output: 6.0 },
  'mistral-medium-3':    { input: 0.40, output: 2.0 },
  'mistral-small-3.1':   { input: 0.10, output: 0.30 },
  'codestral-2':         { input: 0.30, output: 0.90 },
};
const MISTRAL_DEFAULT_PRICING: Pricing = MISTRAL_PRICING['mistral-large-2411'];

function priceFor(model: string): Pricing {
  if (MISTRAL_PRICING[model]) return MISTRAL_PRICING[model];
  if (/large/i.test(model))  return { input: 2.0,  output: 6.0 };
  if (/medium/i.test(model)) return { input: 0.40, output: 2.0 };
  if (/small/i.test(model))  return { input: 0.10, output: 0.30 };
  return MISTRAL_DEFAULT_PRICING;
}

export class VertexMistralProvider implements ChatProvider {
  readonly name = 'vertex-mistral' as const;

  async generate(systemPrompt: string, userPrompt: string, opts: ChatOptions = {}): Promise<ChatResult> {
    const model = config.VERTEX_MISTRAL_GENERATOR_MODEL;
    const url = buildVertexRawPredictUrl('mistralai', model);
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
      throw new Error(`Vertex Mistral ${e.response?.status ?? '???'}: ${detail}`);
    }

    const inputTokens = data.usage.prompt_tokens;
    const outputTokens = data.usage.completion_tokens;
    const pricing = priceFor(model);
    const costUsd =
      (inputTokens * pricing.input) / 1_000_000 +
      (outputTokens * pricing.output) / 1_000_000;
    costLogger.record('vertex-mistral', costUsd, { input: inputTokens, output: outputTokens });

    return {
      content: data.choices[0]?.message.content ?? '',
      provider: 'vertex-mistral',
      model,
      costUsd,
      inputTokens,
      cachedInputTokens: 0,
      outputTokens,
    };
  }
}
