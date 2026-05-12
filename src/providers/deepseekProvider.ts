import axios, { AxiosInstance } from 'axios';
import { config, requireKey } from '../config.js';
import { costLogger } from '../cost-logger.js';
import type { ChatOptions, ChatProvider, ChatResult } from './types.js';

/**
 * DeepSeek (Chinese alternative). OpenAI-compatible REST API.
 *
 * Two models used:
 * - deepseek-chat (V3) — general chat, used for generation + enrichment
 * - deepseek-reasoner (R1) — reasoning model, used for verification (see VerifierProvider)
 *
 * Prompt caching is automatic prefix-based on DeepSeek's side — no markers needed.
 * Same system prompt across calls produces cache hits transparently.
 */

const ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';

/**
 * DeepSeek pricing per million tokens (verify at https://api-docs.deepseek.com/quick_start/pricing).
 * V4 family launched April 2026 — supersedes V3.2 + R1.
 *  - deepseek-v4-pro: $0.435 in / $0.003625 cached / $0.87 out (75% discount window
 *    extended through 2026-05-31; reverts to ~$1.74 / $0.0145 / $3.48 thereafter)
 *  - deepseek-v4-flash: $0.14 in / $0.0028 cached / $0.28 out
 *  - deepseek-chat: legacy alias for v4-flash non-thinking mode (deprecates 2026-07-24)
 *  - deepseek-reasoner: legacy alias for v4-flash thinking mode (deprecates 2026-07-24)
 */
interface Pricing { input: number; cachedInput: number; output: number }
const DEEPSEEK_PRICING: Record<string, Pricing> = {
  'deepseek-v4-pro':    { input: 0.435, cachedInput: 0.003625, output: 0.87 },
  'deepseek-v4-flash':  { input: 0.14,  cachedInput: 0.0028,   output: 0.28 },
  'deepseek-chat':      { input: 0.14,  cachedInput: 0.0028,   output: 0.28 }, // = v4-flash non-thinking
  'deepseek-reasoner':  { input: 0.14,  cachedInput: 0.0028,   output: 0.28 }, // = v4-flash thinking
};
const DEEPSEEK_DEFAULT_PRICING: Pricing = DEEPSEEK_PRICING['deepseek-v4-pro'];

function priceFor(model: string): Pricing {
  if (DEEPSEEK_PRICING[model]) return DEEPSEEK_PRICING[model];
  if (/v4-pro/i.test(model))   return DEEPSEEK_PRICING['deepseek-v4-pro'];
  if (/v4-flash/i.test(model)) return DEEPSEEK_PRICING['deepseek-v4-flash'];
  if (/reasoner/i.test(model)) return DEEPSEEK_PRICING['deepseek-reasoner'];
  return DEEPSEEK_DEFAULT_PRICING;
}


interface DeepSeekResponse {
  choices: Array<{
    message: { content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    /** DeepSeek-specific: tokens served from automatic context cache. */
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
}

export class DeepSeekProvider implements ChatProvider {
  readonly name = 'deepseek' as const;
  private http: AxiosInstance;

  constructor() {
    const apiKey = requireKey('DEEPSEEK_API_KEY', 'deepseek');
    this.http = axios.create({
      baseURL: 'https://api.deepseek.com/v1',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60_000,
    });
  }

  async generate(
    systemPrompt: string,
    userPrompt: string,
    opts: ChatOptions = {},
  ): Promise<ChatResult> {
    // modelOverride lets one stage (e.g. quality) use a different DeepSeek
    // model than another (e.g. generation) — useful for V4-Flash on bulk
    // generation but V4-Pro on rating where judgment quality matters more.
    const model = opts.modelOverride ?? config.DEEPSEEK_GENERATOR_MODEL;
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.7,
    };
    if (opts.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const { data } = await this.http.post<DeepSeekResponse>(ENDPOINT, body);

    const cacheHit = data.usage.prompt_cache_hit_tokens ?? 0;
    const cacheMiss =
      data.usage.prompt_cache_miss_tokens ??
      data.usage.prompt_tokens - cacheHit;
    const inputTokens = cacheMiss;
    const cachedInputTokens = cacheHit;
    const outputTokens = data.usage.completion_tokens;

    const pricing = priceFor(model);
    const costUsd =
      (inputTokens * pricing.input) / 1_000_000 +
      (cachedInputTokens * pricing.cachedInput) / 1_000_000 +
      (outputTokens * pricing.output) / 1_000_000;

    costLogger.record('deepseek', costUsd, {
      input: inputTokens,
      cachedInput: cachedInputTokens,
      output: outputTokens,
    });

    const content = data.choices[0]?.message.content ?? '';

    return {
      content,
      provider: 'deepseek',
      model,
      costUsd,
      inputTokens,
      cachedInputTokens,
      outputTokens,
    };
  }
}
