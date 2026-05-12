import axios, { AxiosInstance } from 'axios';
import { config, requireKey } from '../config.js';
import { costLogger } from '../cost-logger.js';
import type { ChatOptions, ChatProvider, ChatProviderName, ChatResult } from './types.js';

/**
 * OpenRouter — one API gateway, 300+ models.
 *
 * Each routed provider (qwen / minimax / ernie / doubao) is registered as a
 * SEPARATE chat-provider entry in factory.ts so the orchestrator can rotate
 * between them just like it does with first-party providers. They all share
 * the same OPENROUTER_API_KEY but pick different upstream models.
 *
 * OpenRouter is OpenAI-compatible at /api/v1/chat/completions. The response
 * includes `usage.cost` (actual USD charged) — we use that for exact accounting
 * and fall back to a per-model estimate if it's missing.
 *
 * The class is parameterised by `name` (the ChatProviderName we register it
 * as) and `modelGetter` (so each instance reads from its own env var).
 */

interface Pricing { input: number; output: number }

// Approximate USD per million tokens for the Chinese flagships we route to.
// Real cost is read from `usage.cost` when OpenRouter returns it; this table
// is the fallback if the field is absent. Pricing verified at openrouter.ai
// catalog pages on 2026-05-03.
const PRICING: Record<string, Pricing> = {
  // Qwen (Alibaba)
  'qwen/qwen3.6-max-preview':         { input: 1.04, output: 6.24 },
  'qwen/qwen3-max':                   { input: 0.78, output: 3.90 },
  'qwen/qwen3.6-plus':                { input: 0.33, output: 1.95 },
  // MiniMax — all M2.x variants share $0.30/$1.20 on OpenRouter
  'minimax/minimax-m2.7':             { input: 0.30, output: 1.20 },
  'minimax/minimax-m2.7-20260318':    { input: 0.30, output: 1.20 }, // legacy date pin
  'minimax/minimax-m2.5':             { input: 0.30, output: 1.20 },
  'minimax/minimax-m2.1':             { input: 0.30, output: 1.20 },
  'minimax/minimax-m2-her':           { input: 0.30, output: 1.20 },
  'minimax/minimax-m2':               { input: 0.255, output: 1.02 },
  'minimax/minimax-m1':               { input: 0.40, output: 2.20 },
  // Baidu ERNIE — 21B-A3B-Thinking is the newest text model on OpenRouter
  // (Oct 2025); ERNIE 5.0 is not yet routed via OpenRouter.
  'baidu/ernie-4.5-21b-a3b-thinking': { input: 0.07, output: 0.28 },
  'baidu/ernie-4.5-21b-a3b':          { input: 0.07, output: 0.28 },
  'baidu/ernie-4.5-vl-28b-a3b':       { input: 0.14, output: 0.56 },
  'baidu/ernie-4.5-300b-a47b':        { input: 0.28, output: 1.10 },
  'baidu/ernie-4.5-vl-424b-a47b':     { input: 0.42, output: 1.25 },
  // ByteDance Seed (Doubao family) — Seed 2.0 Lite is the newest text
  // model on OpenRouter (Mar 2026); Seed 2.0 Pro is Volcano-only.
  'bytedance-seed/seed-2.0-lite':     { input: 0.25, output: 2.00 },
  'bytedance-seed/seed-2.0-mini':     { input: 0.10, output: 0.40 },
  'bytedance-seed/seed-1.6':          { input: 0.25, output: 2.00 },
  'bytedance-seed/seed-1.6-flash':    { input: 0.075, output: 0.30 },
};

function priceFor(model: string): Pricing {
  if (PRICING[model]) return PRICING[model];
  // Heuristic fallback — match by family prefix.
  for (const key of Object.keys(PRICING)) {
    if (model.startsWith(key.split('/')[0] + '/')) return PRICING[key];
  }
  return { input: 1.0, output: 4.0 }; // generic mid-tier fallback
}

interface OpenRouterResponse {
  choices: Array<{
    message: { content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens?: number;
    /** OpenRouter-specific: actual USD cost charged for this request. */
    cost?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

let cachedHttp: AxiosInstance | null = null;
function getHttp(): AxiosInstance {
  if (cachedHttp) return cachedHttp;
  const apiKey = requireKey('OPENROUTER_API_KEY', 'openrouter');
  cachedHttp = axios.create({
    baseURL: 'https://openrouter.ai/api/v1',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // OpenRouter likes attribution headers — optional but polite.
      'HTTP-Referer': 'https://github.com/EmilHerzberg/out-of-ideas',
      'X-Title': 'out-of-ideas',
    },
    timeout: 90_000,
  });
  return cachedHttp;
}

/**
 * Factory for an OpenRouter-routed chat provider. Used at registration time
 * by factory.ts to wire up one entry per Chinese model family.
 */
export function makeOpenRouterProvider(
  providerName: ChatProviderName,
  costLoggerName: 'openrouter-qwen' | 'openrouter-minimax' | 'openrouter-ernie' | 'openrouter-doubao',
  modelGetter: () => string,
): ChatProvider {
  return {
    name: providerName,
    async generate(systemPrompt: string, userPrompt: string, opts: ChatOptions = {}): Promise<ChatResult> {
      const model = modelGetter();
      const http = getHttp();
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
      // Ask OpenRouter to include usage.cost in the response.
      body.usage = { include: true };

      let data: OpenRouterResponse;
      try {
        const res = await http.post<OpenRouterResponse>('/chat/completions', body);
        data = res.data;
      } catch (err: unknown) {
        const e = err as { response?: { status?: number; data?: unknown }; message?: string };
        const detail = e.response?.data ? JSON.stringify(e.response.data) : (e.message ?? 'unknown error');
        throw new Error(`OpenRouter [${model}] ${e.response?.status ?? '???'}: ${detail}`);
      }

      const cachedInputTokens = data.usage.prompt_tokens_details?.cached_tokens ?? 0;
      const inputTokens = data.usage.prompt_tokens - cachedInputTokens;
      const outputTokens = data.usage.completion_tokens;

      // Prefer OpenRouter's reported cost; fall back to estimate.
      let costUsd: number;
      if (typeof data.usage.cost === 'number') {
        costUsd = data.usage.cost;
      } else {
        const pricing = priceFor(model);
        costUsd =
          (inputTokens * pricing.input) / 1_000_000 +
          (outputTokens * pricing.output) / 1_000_000;
      }

      costLogger.record(costLoggerName, costUsd, {
        input: inputTokens,
        cachedInput: cachedInputTokens,
        output: outputTokens,
      });

      return {
        content: data.choices[0]?.message.content ?? '',
        provider: providerName,
        model,
        costUsd,
        inputTokens,
        cachedInputTokens,
        outputTokens,
      };
    },
  };
}
