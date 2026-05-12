import axios, { AxiosInstance } from 'axios';
import { config, requireKey } from '../config.js';
import { costLogger } from '../cost-logger.js';
import type { ChatOptions, ChatProvider, ChatResult } from './types.js';

/**
 * DashScope (Alibaba) chat provider — used for Qwen models.
 *
 * Default model: `qwen-max` (top-tier Qwen). Configurable via
 * `DASHSCOPE_GENERATOR_MODEL`. Uses the OpenAI-compatible endpoint so the
 * shape of the request/response is the same as OpenAI's chat completions.
 *
 * International endpoint by default; set `DASHSCOPE_REGION=cn` to switch to
 * the China endpoint.
 */

interface DashScopePricing { input: number; cachedInput: number; output: number }
const DASHSCOPE_PRICING: Record<string, DashScopePricing> = {
  // Approximate USD per million tokens — verify at the DashScope console.
  'qwen-max':       { input: 1.60, cachedInput: 0.40, output: 6.40 },
  'qwen-max-latest':{ input: 1.60, cachedInput: 0.40, output: 6.40 },
  'qwen-plus':      { input: 0.40, cachedInput: 0.10, output: 1.20 },
  'qwen-turbo':     { input: 0.05, cachedInput: 0.01, output: 0.20 },
  'qwen3-max':      { input: 1.60, cachedInput: 0.40, output: 6.40 },
};
const DASHSCOPE_DEFAULT_PRICING: DashScopePricing = DASHSCOPE_PRICING['qwen-max'];

function priceForDashScopeModel(model: string): DashScopePricing {
  if (DASHSCOPE_PRICING[model]) return DASHSCOPE_PRICING[model];
  if (/^qwen-?max/i.test(model))    return DASHSCOPE_PRICING['qwen-max'];
  if (/^qwen-?plus/i.test(model))   return DASHSCOPE_PRICING['qwen-plus'];
  if (/^qwen-?turbo/i.test(model))  return DASHSCOPE_PRICING['qwen-turbo'];
  return DASHSCOPE_DEFAULT_PRICING;
}

interface DashScopeResponse {
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

export class DashScopeChatProvider implements ChatProvider {
  readonly name = 'dashscope' as const;
  private http: AxiosInstance;

  constructor() {
    const apiKey = requireKey('DASHSCOPE_API_KEY', 'dashscope');
    const baseURL =
      config.DASHSCOPE_REGION === 'cn'
        ? 'https://dashscope.aliyuncs.com/compatible-mode/v1'
        : 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
    this.http = axios.create({
      baseURL,
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
    const model = config.DASHSCOPE_GENERATOR_MODEL;
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.7,
    };
    if (opts.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    let data: DashScopeResponse;
    try {
      const res = await this.http.post<DashScopeResponse>('/chat/completions', body);
      data = res.data;
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: unknown }; message?: string };
      const detail = e.response?.data ? JSON.stringify(e.response.data) : (e.message ?? 'unknown error');
      throw new Error(`DashScope ${e.response?.status ?? '???'}: ${detail}`);
    }

    const cachedInputTokens = data.usage.prompt_tokens_details?.cached_tokens ?? 0;
    const inputTokens = data.usage.prompt_tokens - cachedInputTokens;
    const outputTokens = data.usage.completion_tokens;

    const pricing = priceForDashScopeModel(model);
    const costUsd =
      (inputTokens * pricing.input) / 1_000_000 +
      (cachedInputTokens * pricing.cachedInput) / 1_000_000 +
      (outputTokens * pricing.output) / 1_000_000;

    costLogger.record('dashscope', costUsd, {
      input: inputTokens,
      cachedInput: cachedInputTokens,
      output: outputTokens,
    });

    const content = data.choices[0]?.message.content ?? '';

    return {
      content,
      provider: 'dashscope',
      model,
      costUsd,
      inputTokens,
      cachedInputTokens,
      outputTokens,
    };
  }
}
