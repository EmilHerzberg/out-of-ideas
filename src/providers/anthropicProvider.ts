import Anthropic from '@anthropic-ai/sdk';
import { config, requireKey } from '../config.js';
import { costLogger } from '../cost-logger.js';
import type { ChatOptions, ChatProvider, ChatResult } from './types.js';

/**
 * Anthropic Claude (default: Opus 4.7 — top-tier).
 * Model is configurable via `ANTHROPIC_GENERATOR_MODEL` env var.
 * Uses prompt caching on the system message — cuts cost ~10x for repeated calls
 * with the same system prompt.
 */

// Per-model pricing (per million tokens, verify at https://www.anthropic.com/pricing).
// Cached reads ~10% of input cost; cache writes ~125% of input cost.
interface AnthropicPricing { input: number; cachedInput: number; cacheWrite: number; output: number }
const ANTHROPIC_PRICING: Record<string, AnthropicPricing> = {
  'claude-opus-4-7':   { input: 15.0, cachedInput: 1.50, cacheWrite: 18.75, output: 75.0 },
  'claude-opus-4-5':   { input: 15.0, cachedInput: 1.50, cacheWrite: 18.75, output: 75.0 },
  'claude-sonnet-4-6': { input: 3.0,  cachedInput: 0.30, cacheWrite: 3.75,  output: 15.0 },
  'claude-sonnet-4-5': { input: 3.0,  cachedInput: 0.30, cacheWrite: 3.75,  output: 15.0 },
  'claude-haiku-4-5':  { input: 1.0,  cachedInput: 0.10, cacheWrite: 1.25,  output: 5.0 },
};
const ANTHROPIC_DEFAULT_PRICING: AnthropicPricing = ANTHROPIC_PRICING['claude-opus-4-7'];

function priceForAnthropicModel(model: string): AnthropicPricing {
  if (ANTHROPIC_PRICING[model]) return ANTHROPIC_PRICING[model];
  // Heuristic fallback by family.
  if (/^claude-opus/.test(model))    return ANTHROPIC_PRICING['claude-opus-4-7'];
  if (/^claude-sonnet/.test(model))  return ANTHROPIC_PRICING['claude-sonnet-4-6'];
  if (/^claude-haiku/.test(model))   return ANTHROPIC_PRICING['claude-haiku-4-5'];
  return ANTHROPIC_DEFAULT_PRICING;
}

/** Claude Opus 4.7 (and any successor labeled with version ≥4.7 or the
 *  upcoming claude-5 line) deprecates `temperature`. Match by id prefix. */
function isFixedTemperatureClaude(model: string): boolean {
  return /^claude-(opus-4-7|opus-4-8|opus-5|sonnet-5|haiku-5)/i.test(model);
}

export class AnthropicProvider implements ChatProvider {
  readonly name = 'anthropic' as const;
  private client: Anthropic;

  constructor() {
    const apiKey = requireKey('ANTHROPIC_API_KEY', 'anthropic');
    this.client = new Anthropic({ apiKey });
  }

  async generate(
    systemPrompt: string,
    userPrompt: string,
    opts: ChatOptions = {},
  ): Promise<ChatResult> {
    // The SDK type for system blocks doesn't always declare cache_control,
    // even though the API supports it. Build the params with `as any` only on
    // the system field to keep prompt caching while the rest stays typed.
    const model = config.ANTHROPIC_GENERATOR_MODEL;
    // Claude Opus 4.7+ deprecates `temperature`; sending it returns 400.
    // Older Sonnet / Haiku models still accept it.
    const sendTemperature = !isFixedTemperatureClaude(model);
    const params = {
      model,
      max_tokens: opts.maxTokens ?? 2048,
      ...(sendTemperature ? { temperature: opts.temperature ?? 0.7 } : {}),
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ] as unknown as Parameters<typeof this.client.messages.create>[0]['system'],
      messages: [{ role: 'user' as const, content: userPrompt }],
    };
    const response = await this.client.messages.create(params);

    // Cast the usage object — cache_* fields are returned at runtime but may
    // not appear in the SDK Usage type for older versions.
    const usage = response.usage as unknown as {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    const inputTokens = usage.input_tokens ?? 0;
    const cachedInputTokens = usage.cache_read_input_tokens ?? 0;
    const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;

    const pricing = priceForAnthropicModel(model);
    const costUsd =
      (inputTokens * pricing.input) / 1_000_000 +
      (cachedInputTokens * pricing.cachedInput) / 1_000_000 +
      (cacheWriteTokens * pricing.cacheWrite) / 1_000_000 +
      (outputTokens * pricing.output) / 1_000_000;

    costLogger.record('anthropic', costUsd, {
      input: inputTokens + cacheWriteTokens,
      cachedInput: cachedInputTokens,
      output: outputTokens,
    });

    // Anthropic returns content as an array of content blocks; extract the text.
    const textBlock = response.content.find((b) => b.type === 'text');
    const content = textBlock && textBlock.type === 'text' ? textBlock.text : '';

    return {
      content,
      provider: 'anthropic',
      model,
      costUsd,
      inputTokens: inputTokens + cacheWriteTokens,
      cachedInputTokens,
      outputTokens,
    };
  }
}
