import axios, { AxiosInstance } from 'axios';
import { config, requireKey } from '../config.js';
import { costLogger } from '../cost-logger.js';
import type { ChatOptions, ChatProvider, ChatResult } from './types.js';

/**
 * BytePlus (international Volcano Engine ModelArk) chat provider.
 *
 * Direct access to ByteDance's Doubao Seed 2.0 family — including the
 * `doubao-seed-2-0-pro` flagship that is NOT yet routed via OpenRouter.
 * Pro is the actual frontier ByteDance model: 98.3 AIME 2025, 3020
 * Codeforces, 88.9 GPQA Diamond, 76.5 SWE-Bench Verified — comparable to
 * GPT-5.2 and Claude Opus 4.5 at ~5–10× lower cost.
 *
 * When BYTEPLUS_API_KEY is set, the orchestrator auto-disables the
 * `openrouter-doubao` rotation slot (which can only reach Lite via the
 * gateway) — same shadowing pattern as DashScope vs openrouter-qwen.
 *
 * Endpoint: international ModelArk (`ark.ap-southeast.bytepluses.com`).
 * The China endpoint `ark.cn-beijing.volces.com` requires a separate
 * Volcano Engine account; not currently region-switched here because
 * BYTEPLUS_API_KEY belongs to the international platform by definition.
 *
 * OpenAI-compatible chat-completions request/response shape.
 */

interface Pricing { input: number; output: number }
// BytePlus's actual model ID format (per the console's curl examples) is
// `seed-2-0-{tier}-{YYMMDD}` — no "doubao-" prefix, hyphens, with a date
// suffix. The public marketing docs that mention `doubao-seed-2-0-pro` were
// misleading; that ID returns 404 on the API. Listing the dated IDs we know
// about; the regex fallback below covers any future date suffix.
const BYTEPLUS_PRICING: Record<string, Pricing> = {
  // USD per million tokens — verify at https://www.byteplus.com/en/product/Models
  'seed-2-0-pro-260328':   { input: 0.47, output: 2.37 }, // frontier (Mar 28 2026 build)
  'seed-2-0-lite-260328':  { input: 0.25, output: 2.00 },
  'seed-2-0-mini-260226':  { input: 0.10, output: 0.40 },
  'seed-2-0-code-260328':  { input: 0.30, output: 1.50 },
  // Marketing-name aliases — keep in case BytePlus adds undated aliases later.
  'doubao-seed-2-0-pro':   { input: 0.47, output: 2.37 },
  'doubao-seed-2-0-lite':  { input: 0.25, output: 2.00 },
  'doubao-seed-2-0-mini':  { input: 0.10, output: 0.40 },
  'doubao-seed-2-0-code':  { input: 0.30, output: 1.50 },
};
const BYTEPLUS_DEFAULT_PRICING: Pricing = BYTEPLUS_PRICING['seed-2-0-pro-260328'];

function priceFor(model: string): Pricing {
  if (BYTEPLUS_PRICING[model]) return BYTEPLUS_PRICING[model];
  // Regex fallback covers future-dated builds: `seed-2-0-pro-260507` etc.
  if (/pro/i.test(model))  return BYTEPLUS_PRICING['seed-2-0-pro-260328'];
  if (/lite/i.test(model)) return BYTEPLUS_PRICING['seed-2-0-lite-260328'];
  if (/mini/i.test(model)) return BYTEPLUS_PRICING['seed-2-0-mini-260226'];
  if (/code/i.test(model)) return BYTEPLUS_PRICING['seed-2-0-code-260328'];
  return BYTEPLUS_DEFAULT_PRICING;
}

interface BytePlusResponse {
  choices: Array<{
    message: { content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

export class BytePlusProvider implements ChatProvider {
  readonly name = 'byteplus' as const;
  private http: AxiosInstance;

  constructor() {
    const apiKey = requireKey('BYTEPLUS_API_KEY', 'byteplus');
    this.http = axios.create({
      baseURL: 'https://ark.ap-southeast.bytepluses.com/api/v3',
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
    const model = opts.modelOverride ?? config.BYTEPLUS_GENERATOR_MODEL;
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
    // Note: Seed 2.0 Pro rejects `response_format: json_object` with
    // 400 InvalidParameter. The generator prompt already enforces JSON output
    // textually, and our response parser tolerates ```json``` fences and
    // surrounding prose — skip the API-level flag and trust the prompt.
    // (If a future Doubao variant DOES support json_object, gate by model id.)
    void opts.jsonMode;

    let data: BytePlusResponse;
    try {
      const res = await this.http.post<BytePlusResponse>('/chat/completions', body);
      data = res.data;
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: unknown }; message?: string };
      const detail = e.response?.data ? JSON.stringify(e.response.data) : (e.message ?? 'unknown error');
      throw new Error(`BytePlus ${e.response?.status ?? '???'}: ${detail}`);
    }

    const cachedInputTokens = data.usage.prompt_tokens_details?.cached_tokens ?? 0;
    const inputTokens = data.usage.prompt_tokens - cachedInputTokens;
    const outputTokens = data.usage.completion_tokens;

    const pricing = priceFor(model);
    // BytePlus doesn't publish a separate cached-input rate; treat cached
    // tokens as standard input until we see different numbers in practice.
    const costUsd =
      (inputTokens * pricing.input) / 1_000_000 +
      (cachedInputTokens * pricing.input) / 1_000_000 +
      (outputTokens * pricing.output) / 1_000_000;

    costLogger.record('byteplus', costUsd, {
      input: inputTokens,
      cachedInput: cachedInputTokens,
      output: outputTokens,
    });

    return {
      content: data.choices[0]?.message.content ?? '',
      provider: 'byteplus',
      model,
      costUsd,
      inputTokens,
      cachedInputTokens,
      outputTokens,
    };
  }
}
