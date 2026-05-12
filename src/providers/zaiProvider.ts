import axios, { AxiosInstance } from 'axios';
import { config, requireKey } from '../config.js';
import { costLogger } from '../cost-logger.js';
import type { ChatOptions, ChatProvider, ChatResult } from './types.js';

/**
 * Z.ai (ZhipuAI / GLM family) chat provider.
 *
 * Default model: `glm-5.1` — current open-source flagship released April 2026,
 * leads SWE-Bench Pro at 58.4 (ahead of GPT-5.4, Claude Opus 4.6, Gemini 3.1 Pro).
 * Override via `ZAI_GENERATOR_MODEL`. Uses the OpenAI-compatible endpoint
 * so request / response shapes mirror OpenAI's chat completions.
 *
 * International endpoint by default; set `ZAI_REGION=cn` for the China
 * endpoint.
 *
 * NOTE: peak-hours quota multiplier (3× during 14:00-18:00 Beijing) is NOT
 * modeled in the cost table — consider it operational overhead, not strict
 * accounting.
 */

interface Pricing { input: number; cachedInput: number; output: number }
const ZAI_PRICING: Record<string, Pricing> = {
  // USD per million tokens — verify at https://docs.z.ai
  'glm-5.1':       { input: 1.40, cachedInput: 0.26, output: 4.40 },  // Apr 2026 flagship
  'glm-5-turbo':   { input: 0.60, cachedInput: 0.12, output: 2.20 },  // fast inference companion
  'glm-4.6':       { input: 0.60, cachedInput: 0.11, output: 2.20 },
  'glm-4.5':       { input: 0.50, cachedInput: 0.10, output: 2.00 },
  'glm-4.5-air':   { input: 0.20, cachedInput: 0.04, output: 1.10 },
  'glm-4.5-flash': { input: 0.05, cachedInput: 0.01, output: 0.30 },
};
const ZAI_DEFAULT_PRICING: Pricing = ZAI_PRICING['glm-5.1'];

function priceFor(model: string): Pricing {
  if (ZAI_PRICING[model]) return ZAI_PRICING[model];
  if (/5\.1/.test(model))    return ZAI_PRICING['glm-5.1'];
  if (/5-turbo|5\.0-turbo/i.test(model)) return ZAI_PRICING['glm-5-turbo'];
  if (/4\.6/.test(model))    return ZAI_PRICING['glm-4.6'];
  if (/air/i.test(model))    return ZAI_PRICING['glm-4.5-air'];
  if (/flash/i.test(model))  return ZAI_PRICING['glm-4.5-flash'];
  if (/4\.5/.test(model))    return ZAI_PRICING['glm-4.5'];
  return ZAI_DEFAULT_PRICING;
}

interface ZaiResponse {
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

export class ZaiProvider implements ChatProvider {
  readonly name = 'zai' as const;
  private http: AxiosInstance;

  constructor() {
    const apiKey = requireKey('ZAI_API_KEY', 'zai');
    const baseURL =
      config.ZAI_REGION === 'cn'
        ? 'https://open.bigmodel.cn/api/paas/v4'
        : 'https://api.z.ai/api/paas/v4';
    this.http = axios.create({
      baseURL,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      // 240s, not 90s — GLM-5.1 is a thinking model and individual calls
      // can spend 60-180s on internal reasoning before emitting visible
      // output. Matches the Moonshot timeout for the same reason. Smoke
      // test 2026-05-05 had 4 of 6 zai calls time out at 90s on a complex
      // batch.
      timeout: 240_000,
    });
  }

  async generate(
    systemPrompt: string,
    userPrompt: string,
    opts: ChatOptions = {},
  ): Promise<ChatResult> {
    const model = config.ZAI_GENERATOR_MODEL;
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

    let data: ZaiResponse;
    try {
      const res = await this.http.post<ZaiResponse>('/chat/completions', body);
      data = res.data;
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: unknown }; message?: string };
      const detail = e.response?.data ? JSON.stringify(e.response.data) : (e.message ?? 'unknown error');
      throw new Error(`Z.ai ${e.response?.status ?? '???'}: ${detail}`);
    }

    const cachedInputTokens = data.usage.prompt_tokens_details?.cached_tokens ?? 0;
    const inputTokens = data.usage.prompt_tokens - cachedInputTokens;
    const outputTokens = data.usage.completion_tokens;

    const pricing = priceFor(model);
    const costUsd =
      (inputTokens * pricing.input) / 1_000_000 +
      (cachedInputTokens * pricing.cachedInput) / 1_000_000 +
      (outputTokens * pricing.output) / 1_000_000;

    costLogger.record('zai', costUsd, {
      input: inputTokens,
      cachedInput: cachedInputTokens,
      output: outputTokens,
    });

    return {
      content: data.choices[0]?.message.content ?? '',
      provider: 'zai',
      model,
      costUsd,
      inputTokens,
      cachedInputTokens,
      outputTokens,
    };
  }
}
