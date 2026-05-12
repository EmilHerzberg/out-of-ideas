import axios, { AxiosInstance } from 'axios';
import { config, requireKey } from '../config.js';
import { costLogger } from '../cost-logger.js';
import type { ChatOptions, ChatProvider, ChatResult } from './types.js';

/**
 * Moonshot AI (Kimi family) chat provider.
 *
 * Default model: `kimi-k2.6` per the project's pinned env default. If the
 * configured model id is not recognised by Moonshot's API the provider just
 * surfaces the upstream error — the orchestrator records it as a parse
 * failure and rotates to the next provider, which is the same graceful
 * degradation Z.ai / OpenRouter use.
 *
 * Endpoint: international (`https://api.moonshot.ai/v1`) by default; set
 * `MOONSHOT_REGION=cn` for the China endpoint (`https://api.moonshot.cn/v1`).
 * Both expose an OpenAI-compatible chat-completions API.
 */

interface Pricing { input: number; cachedInput: number; output: number }

// USD per million tokens — verify at https://platform.moonshot.ai/pricing.
// Moonshot's K-series uses cache-aware pricing similar to Anthropic / DeepSeek.
const MOONSHOT_PRICING: Record<string, Pricing> = {
  'kimi-k2.6':         { input: 0.60, cachedInput: 0.15, output: 2.50 },
  'kimi-k2-instruct':  { input: 0.60, cachedInput: 0.15, output: 2.50 },
  'kimi-k2':           { input: 0.60, cachedInput: 0.15, output: 2.50 },
  'moonshot-v1-8k':    { input: 0.20, cachedInput: 0.05, output: 0.20 },
  'moonshot-v1-32k':   { input: 0.60, cachedInput: 0.15, output: 0.60 },
  'moonshot-v1-128k':  { input: 1.50, cachedInput: 0.40, output: 1.50 },
};
const MOONSHOT_DEFAULT_PRICING: Pricing = MOONSHOT_PRICING['kimi-k2.6'];

function priceFor(model: string): Pricing {
  if (MOONSHOT_PRICING[model]) return MOONSHOT_PRICING[model];
  if (/^kimi-?k2/i.test(model))       return MOONSHOT_PRICING['kimi-k2.6'];
  if (/moonshot-v1-128k/i.test(model)) return MOONSHOT_PRICING['moonshot-v1-128k'];
  if (/moonshot-v1-32k/i.test(model))  return MOONSHOT_PRICING['moonshot-v1-32k'];
  if (/moonshot-v1-8k/i.test(model))   return MOONSHOT_PRICING['moonshot-v1-8k'];
  return MOONSHOT_DEFAULT_PRICING;
}

/** The Kimi K2.x family is reasoning/thinking-class and only accepts the
 *  default temperature (the API responds 400 `invalid temperature: only 1
 *  is allowed for this model` to anything else). The older `moonshot-v1-*`
 *  models still accept a custom temperature. Same gotcha pattern as GPT-5
 *  / Anthropic Opus 4.7. */
function isFixedTemperatureModel(model: string): boolean {
  return /^kimi-?k2/i.test(model);
}

interface MoonshotResponse {
  choices: Array<{
    message: { content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number };
    cached_tokens?: number;
  };
}

export class MoonshotProvider implements ChatProvider {
  readonly name = 'moonshot' as const;
  private http: AxiosInstance;

  constructor() {
    const apiKey = requireKey('MOONSHOT_API_KEY', 'moonshot');
    const baseURL =
      config.MOONSHOT_REGION === 'cn'
        ? 'https://api.moonshot.cn/v1'
        : 'https://api.moonshot.ai/v1';
    this.http = axios.create({
      baseURL,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      // 240s, not 90s — kimi-k2.x is a thinking-class model and a single
      // generation call can spend 60-180s on internal reasoning before
      // emitting visible output. The other thinking-model providers we use
      // (OpenAI gpt-5, Anthropic Opus 4.7) don't expose a configurable
      // axios timeout, but their SDKs default to similarly long values.
      timeout: 240_000,
    });
  }

  async generate(
    systemPrompt: string,
    userPrompt: string,
    opts: ChatOptions = {},
  ): Promise<ChatResult> {
    const model = config.MOONSHOT_GENERATOR_MODEL;
    // Thinking-class kimi-k2 spends a substantial fraction of max_tokens on
    // internal reasoning before any visible output is emitted. At 4096 the
    // first smoke test exhausted the entire budget on thoughts (12288 output
    // tokens across 3 retries, 0 visible content). Bump headroom to 16k for
    // thinking models — non-thinking moonshot-v1 keeps the caller's value.
    const isThinking = isFixedTemperatureModel(model);
    const defaultMaxTokens = isThinking ? 16384 : 4096;
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: opts.maxTokens && opts.maxTokens > defaultMaxTokens ? opts.maxTokens : defaultMaxTokens,
      stream: false,
    };
    // Reasoning-class kimi-k2 models reject any non-default temperature;
    // the v1 models still take it.
    if (!isThinking) {
      body.temperature = opts.temperature ?? 0.7;
    }
    if (opts.jsonMode) body.response_format = { type: 'json_object' };

    let data: MoonshotResponse;
    try {
      const res = await this.http.post<MoonshotResponse>('/chat/completions', body);
      data = res.data;
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: unknown }; message?: string };
      const detail = e.response?.data ? JSON.stringify(e.response.data) : (e.message ?? 'unknown error');
      throw new Error(`Moonshot ${e.response?.status ?? '???'}: ${detail}`);
    }

    const cachedInputTokens =
      data.usage.prompt_tokens_details?.cached_tokens ?? data.usage.cached_tokens ?? 0;
    const inputTokens = data.usage.prompt_tokens - cachedInputTokens;
    const outputTokens = data.usage.completion_tokens;

    const pricing = priceFor(model);
    const costUsd =
      (inputTokens * pricing.input) / 1_000_000 +
      (cachedInputTokens * pricing.cachedInput) / 1_000_000 +
      (outputTokens * pricing.output) / 1_000_000;

    costLogger.record('moonshot', costUsd, {
      input: inputTokens,
      cachedInput: cachedInputTokens,
      output: outputTokens,
    });

    return {
      content: data.choices[0]?.message.content ?? '',
      provider: 'moonshot',
      model,
      costUsd,
      inputTokens,
      cachedInputTokens,
      outputTokens,
    };
  }
}
