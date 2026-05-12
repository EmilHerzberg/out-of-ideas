import { config } from '../config.js';
import { AnthropicProvider } from './anthropicProvider.js';
import { DeepSeekProvider } from './deepseekProvider.js';
import { OpenAIProvider } from './openaiProvider.js';
import { DashScopeChatProvider } from './dashscopeChatProvider.js';
import { VertexMistralProvider } from './vertexMistralProvider.js';
import { VertexAI21Provider } from './vertexAI21Provider.js';
import { VertexGrokProvider } from './vertexGrokProvider.js';
import { ZaiProvider } from './zaiProvider.js';
import { MoonshotProvider } from './moonshotProvider.js';
import { BytePlusProvider } from './byteplusProvider.js';
import { makeOpenRouterProvider } from './openrouterProvider.js';
import { DashScopeVerifierProvider } from './dashscopeVerifier.js';
import { DashScopeEmbeddingProvider } from './dashscopeEmbedder.js';
import { PerplexityProvider } from './perplexityProvider.js';
import { VoyageProvider } from './voyageProvider.js';
import { GoogleChatProvider, GoogleVerifierProvider, GoogleEmbeddingProvider } from './googleProvider.js';
import {
  registerChatProvider,
  getChatProviderEntry,
  getActiveChatProviders,
  getRegisteredChatProviders,
} from './registry.js';
import type {
  ChatProvider,
  ChatProviderName,
  EmbeddingProvider,
  EmbeddingProviderName,
  VerifierProvider,
  VerifierProviderName,
} from './types.js';

/**
 * Factory entry points + chat-provider registry.
 *
 * To add a new chat provider: implement `ChatProvider`, then add ONE
 * `registerChatProvider({...})` call below. The orchestrator and
 * `--provider` CLI flag pick it up automatically once registered.
 */

// ---------------------------------------------------------------------------
// Chat provider self-registration
// ---------------------------------------------------------------------------

registerChatProvider({
  name: 'anthropic',
  defaultModel: 'claude-opus-4-7',
  configuredModel: () => config.ANTHROPIC_GENERATOR_MODEL,
  factory: () => new AnthropicProvider(),
  isAvailable: () => Boolean(config.ANTHROPIC_API_KEY),
});

registerChatProvider({
  name: 'deepseek',
  defaultModel: 'deepseek-chat',
  configuredModel: () => config.DEEPSEEK_GENERATOR_MODEL,
  factory: () => new DeepSeekProvider(),
  isAvailable: () => Boolean(config.DEEPSEEK_API_KEY),
});

registerChatProvider({
  name: 'google',
  defaultModel: 'gemini-3.1-pro-preview',
  configuredModel: () => config.GOOGLE_GENERATOR_MODEL,
  factory: () => new GoogleChatProvider(),
  isAvailable: () => Boolean(config.GOOGLE_CLOUD_PROJECT),
});

registerChatProvider({
  name: 'openai',
  defaultModel: 'gpt-5',
  configuredModel: () => config.OPENAI_GENERATOR_MODEL,
  factory: () => new OpenAIProvider(),
  isAvailable: () => Boolean(config.OPENAI_API_KEY),
});

registerChatProvider({
  name: 'dashscope',
  defaultModel: 'qwen-max',
  configuredModel: () => config.DASHSCOPE_GENERATOR_MODEL,
  factory: () => new DashScopeChatProvider(),
  isAvailable: () => Boolean(config.DASHSCOPE_API_KEY),
});

// --- Vertex AI Model Garden partner models (use same GOOGLE_CLOUD_PROJECT) ---
registerChatProvider({
  name: 'vertex-mistral',
  defaultModel: 'mistral-large-2411',
  configuredModel: () => config.VERTEX_MISTRAL_GENERATOR_MODEL,
  factory: () => new VertexMistralProvider(),
  isAvailable: () => Boolean(config.GOOGLE_CLOUD_PROJECT),
});

registerChatProvider({
  name: 'vertex-ai21',
  defaultModel: 'jamba-1.5-large',
  configuredModel: () => config.VERTEX_AI21_GENERATOR_MODEL,
  factory: () => new VertexAI21Provider(),
  isAvailable: () => Boolean(config.GOOGLE_CLOUD_PROJECT),
});

registerChatProvider({
  name: 'vertex-grok',
  defaultModel: 'grok-4-1-fast-non-reasoning',
  configuredModel: () => config.VERTEX_GROK_GENERATOR_MODEL,
  factory: () => new VertexGrokProvider(),
  isAvailable: () => Boolean(config.GOOGLE_CLOUD_PROJECT),
});

registerChatProvider({
  name: 'zai',
  defaultModel: 'glm-5.1',
  configuredModel: () => config.ZAI_GENERATOR_MODEL,
  factory: () => new ZaiProvider(),
  isAvailable: () => Boolean(config.ZAI_API_KEY),
});

registerChatProvider({
  name: 'moonshot',
  defaultModel: 'kimi-k2.6',
  configuredModel: () => config.MOONSHOT_GENERATOR_MODEL,
  factory: () => new MoonshotProvider(),
  isAvailable: () => Boolean(config.MOONSHOT_API_KEY),
});

// BytePlus (international ModelArk) — direct access to Doubao Seed 2.0 Pro
// frontier. Pro is not yet routed via OpenRouter, so this slot picks up the
// real frontier instead of the Lite variant the gateway exposes.
registerChatProvider({
  name: 'byteplus',
  defaultModel: 'doubao-seed-2-0-pro',
  configuredModel: () => config.BYTEPLUS_GENERATOR_MODEL,
  factory: () => new BytePlusProvider(),
  isAvailable: () => Boolean(config.BYTEPLUS_API_KEY),
});

// --- OpenRouter-routed Chinese flagships (single OPENROUTER_API_KEY) -------
// Each is a SEPARATE chat-provider entry so the orchestrator's rotation
// can give each its own slot — important because each Chinese model has
// distinct training-data fixations and we want maximum diversity.
//
// Routing preference: if a direct vendor key is also configured, the direct
// provider wins and the OpenRouter route is hidden from the rotation. Today
// only Qwen has a direct alternative (DashScope); Baidu / ByteDance / MiniMax
// remain OpenRouter-only.
registerChatProvider({
  name: 'openrouter-qwen',
  defaultModel: 'qwen/qwen3.6-max-preview',
  configuredModel: () => config.OPENROUTER_QWEN_MODEL,
  factory: () => makeOpenRouterProvider('openrouter-qwen', 'openrouter-qwen', () => config.OPENROUTER_QWEN_MODEL),
  isAvailable: () => Boolean(config.OPENROUTER_API_KEY) && !config.DASHSCOPE_API_KEY,
});

registerChatProvider({
  name: 'openrouter-minimax',
  defaultModel: 'minimax/minimax-m2.7',
  configuredModel: () => config.OPENROUTER_MINIMAX_MODEL,
  factory: () => makeOpenRouterProvider('openrouter-minimax', 'openrouter-minimax', () => config.OPENROUTER_MINIMAX_MODEL),
  isAvailable: () => Boolean(config.OPENROUTER_API_KEY),
});

registerChatProvider({
  // ERNIE on OpenRouter — the 4.5 family ranges from 21B-A3B (smallest, has
  // thinking variants) to 300B-A47B (largest non-thinking) up to 424B-VL.
  // We default to the 300B non-thinking flagship because the newer "thinking"
  // variants are routed through Novita and Novita rejects `response_format:
  // json_object` with `does not support feature: structured-outputs` (every
  // call 400s in the 2026-05-03 18:27 run). The 300B model accepts JSON
  // mode and was confirmed working through Run 13. ERNIE 5.0 is the actual
  // current frontier but it's Qianfan-only and Qianfan international
  // requires a HK phone number — separate blocker tracked in TESTING.md.
  name: 'openrouter-ernie',
  defaultModel: 'baidu/ernie-4.5-300b-a47b',
  configuredModel: () => config.OPENROUTER_ERNIE_MODEL,
  factory: () => makeOpenRouterProvider('openrouter-ernie', 'openrouter-ernie', () => config.OPENROUTER_ERNIE_MODEL),
  isAvailable: () => Boolean(config.OPENROUTER_API_KEY),
});

registerChatProvider({
  name: 'openrouter-doubao',
  defaultModel: 'bytedance-seed/seed-2.0-lite',
  configuredModel: () => config.OPENROUTER_DOUBAO_MODEL,
  factory: () => makeOpenRouterProvider('openrouter-doubao', 'openrouter-doubao', () => config.OPENROUTER_DOUBAO_MODEL),
  // Direct-beats-OpenRouter rule: when BYTEPLUS_API_KEY is set, the direct
  // BytePlus provider wins (it can reach Seed 2.0 Pro; OpenRouter only routes
  // Lite). Mirrors the DashScope vs openrouter-qwen shadowing pattern.
  isAvailable: () => Boolean(config.OPENROUTER_API_KEY) && !config.BYTEPLUS_API_KEY,
});

// ---------------------------------------------------------------------------
// Public factory functions
// ---------------------------------------------------------------------------

export function getChatProvider(name?: ChatProviderName): ChatProvider {
  const resolved = name ?? config.PROVIDER_GENERATOR;
  const entry = getChatProviderEntry(resolved);
  if (!entry) throw new Error(`Unknown chat provider: ${resolved}`);
  return entry.factory();
}

export { getActiveChatProviders, getRegisteredChatProviders, getChatProviderEntry };

export function getVerifierProvider(name?: VerifierProviderName): VerifierProvider {
  const resolved = name ?? config.PROVIDER_VERIFIER;
  switch (resolved) {
    case 'perplexity':
      return new PerplexityProvider();
    case 'dashscope':
      return new DashScopeVerifierProvider();
    case 'google':
      return new GoogleVerifierProvider();
    default: {
      const _exhaustive: never = resolved;
      throw new Error(`Unknown verifier provider: ${String(_exhaustive)}`);
    }
  }
}

export function getEmbeddingProvider(name?: EmbeddingProviderName): EmbeddingProvider {
  const resolved = name ?? config.PROVIDER_EMBEDDER;
  switch (resolved) {
    case 'voyage':
      return new VoyageProvider();
    case 'dashscope':
      return new DashScopeEmbeddingProvider();
    case 'google':
      return new GoogleEmbeddingProvider();
    default: {
      const _exhaustive: never = resolved;
      throw new Error(`Unknown embedding provider: ${String(_exhaustive)}`);
    }
  }
}
