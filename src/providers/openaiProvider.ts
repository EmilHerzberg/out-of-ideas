import axios, { AxiosInstance } from 'axios';
import { config, requireKey } from '../config.js';
import { costLogger } from '../cost-logger.js';
import type { ChatOptions, ChatProvider, ChatResult } from './types.js';

/**
 * OpenAI (default model: GPT-5 — top-tier).
 *
 * Model is configurable via `OPENAI_GENERATOR_MODEL` env var.
 * Uses the standard OpenAI Chat Completions API.
 *
 * Prompt caching is automatic on OpenAI's side for prefixes ≥1024 tokens — no
 * markers needed. The same system prompt across calls produces cache hits
 * transparently and shows up in `prompt_tokens_details.cached_tokens`.
 */

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

// Per-model pricing (per million tokens). Verify at https://openai.com/api/pricing.
// Cached input runs ~90% off across the board.
interface OpenAIPricing { input: number; cachedInput: number; output: number }
const OPENAI_PRICING: Record<string, OpenAIPricing> = {
  'gpt-5':       { input: 1.25,  cachedInput: 0.125, output: 10.0 },
  'gpt-5-mini':  { input: 0.25,  cachedInput: 0.025, output: 2.0 },
  'gpt-5-nano':  { input: 0.05,  cachedInput: 0.005, output: 0.40 },
  'gpt-4o':      { input: 2.50,  cachedInput: 1.25,  output: 10.0 },
  'gpt-4o-mini': { input: 0.15,  cachedInput: 0.075, output: 0.60 },
  'o1':          { input: 15.0,  cachedInput: 7.50,  output: 60.0 },
  'o3':          { input: 20.0,  cachedInput: 5.0,   output: 80.0 },
  'o3-mini':     { input: 1.10,  cachedInput: 0.55,  output: 4.40 },
};
const OPENAI_DEFAULT_PRICING: OpenAIPricing = OPENAI_PRICING['gpt-5'];

function priceForOpenAIModel(model: string): OpenAIPricing {
  if (OPENAI_PRICING[model]) return OPENAI_PRICING[model];
  // Heuristic fallback: match the closest known prefix. Lets dated snapshots
  // ("gpt-5-2025-XX-XX") reuse their family's pricing.
  for (const key of Object.keys(OPENAI_PRICING)) {
    if (model.startsWith(key)) return OPENAI_PRICING[key];
  }
  return OPENAI_DEFAULT_PRICING;
}

/** GPT-5 and the o-series only accept the default temperature (1). Sending
 *  any other value returns 400 `unsupported_value`. Detect by model id prefix. */
function isFixedTemperatureModel(model: string): boolean {
  return /^(gpt-5|o1|o3|o4)/i.test(model);
}

interface OpenAIResponse {
  choices: Array<{
    message: { content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
  };
}

export class OpenAIProvider implements ChatProvider {
  readonly name = 'openai' as const;
  private http: AxiosInstance;

  constructor() {
    const apiKey = requireKey('OPENAI_API_KEY', 'openai');
    this.http = axios.create({
      baseURL: 'https://api.openai.com/v1',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 90_000,
    });
  }

  async generate(
    systemPrompt: string,
    userPrompt: string,
    opts: ChatOptions = {},
  ): Promise<ChatResult> {
    const model = config.OPENAI_GENERATOR_MODEL;
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_completion_tokens: opts.maxTokens ?? 4096,
    };
    // GPT-5 and o-series reasoning models reject any non-default temperature.
    // Only send `temperature` when targeting older families that accept it.
    if (!isFixedTemperatureModel(model)) {
      body.temperature = opts.temperature ?? 0.7;
    }
    if (opts.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    let data: OpenAIResponse;
    try {
      const res = await this.http.post<OpenAIResponse>(ENDPOINT, body);
      data = res.data;
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: unknown }; message?: string };
      const detail = e.response?.data ? JSON.stringify(e.response.data) : (e.message ?? 'unknown error');
      throw new Error(`OpenAI ${e.response?.status ?? '???'}: ${detail}`);
    }

    const cachedInputTokens = data.usage.prompt_tokens_details?.cached_tokens ?? 0;
    const inputTokens = data.usage.prompt_tokens - cachedInputTokens;
    const outputTokens = data.usage.completion_tokens;

    const pricing = priceForOpenAIModel(model);
    const costUsd =
      (inputTokens * pricing.input) / 1_000_000 +
      (cachedInputTokens * pricing.cachedInput) / 1_000_000 +
      (outputTokens * pricing.output) / 1_000_000;

    costLogger.record('openai', costUsd, {
      input: inputTokens,
      cachedInput: cachedInputTokens,
      output: outputTokens,
    });

    const content = data.choices[0]?.message.content ?? '';

    return {
      content,
      provider: 'openai',
      model,
      costUsd,
      inputTokens,
      cachedInputTokens,
      outputTokens,
    };
  }
}
