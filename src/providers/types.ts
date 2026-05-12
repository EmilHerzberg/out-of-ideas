/**
 * Provider interfaces. Each AI-calling step uses an abstraction so US/Chinese
 * backends can be swapped per-run via env var or `--provider` CLI flag.
 *
 * Generator + enricher both use ChatProvider.
 * Verifier uses VerifierProvider (web-grounded vs reasoning-only).
 * Embedder uses EmbeddingProvider (Voyage only for v1).
 */

export type ChatProviderName =
  | 'anthropic'
  | 'deepseek'
  | 'google'
  | 'openai'
  | 'dashscope'
  | 'vertex-mistral'
  | 'vertex-ai21'
  | 'vertex-grok'
  | 'zai'
  | 'moonshot'
  | 'byteplus'
  | 'openrouter-qwen'
  | 'openrouter-minimax'
  | 'openrouter-ernie'
  | 'openrouter-doubao';
export type VerifierProviderName = 'perplexity' | 'dashscope' | 'google';
export type EmbeddingProviderName = 'voyage' | 'dashscope' | 'google';

// ---------------------------------------------------------------------------
// Chat (generator + enricher)
// ---------------------------------------------------------------------------

export interface ChatOptions {
  /** Model max output tokens. Default 2048. */
  maxTokens?: number;
  /** 0–1. Default 0.7 for generation, 0.3 for enrichment / structured output. */
  temperature?: number;
  /** Hint to the provider that we want JSON output. Provider implementations
   *  attach response_format / tool-use hints as appropriate. */
  jsonMode?: boolean;
  /** Override the provider's default model for THIS call only. Lets the
   *  same provider be used for two different stages with different models —
   *  e.g. DeepSeek-V4-Flash for generation but DeepSeek-V4-Pro for quality
   *  rating. If unset, the provider uses its configured default. */
  modelOverride?: string;
}

export interface ChatResult {
  /** The assistant message text content. For JSON mode, may need to be parsed. */
  content: string;
  provider: ChatProviderName;
  /** Specific model id used for this call (e.g. "claude-opus-4-7", "gpt-5",
   *  "gemini-3.1-pro-preview"). Stamped onto the question record so per-model
   *  performance can be compared even within one provider. */
  model: string;
  /** Computed cost for this single call in USD. */
  costUsd: number;
  inputTokens: number;
  /** Tokens served from prompt cache (Anthropic) or DeepSeek's context cache. */
  cachedInputTokens: number;
  outputTokens: number;
}

export interface ChatProvider {
  readonly name: ChatProviderName;
  generate(
    systemPrompt: string,
    userPrompt: string,
    opts?: ChatOptions,
  ): Promise<ChatResult>;
}

// ---------------------------------------------------------------------------
// Verifier
// ---------------------------------------------------------------------------

export interface VerifyResult {
  chosenLetter: 'A' | 'B' | 'C' | 'D';
  confidence: 'high' | 'medium' | 'low';
  citation: string;
  rawResponse: string;
  provider: VerifierProviderName;
  /** True only for Perplexity (web-grounded). DeepSeek-R1 verification has no live citations. */
  webGrounded: boolean;
  costUsd: number;
}

export interface VerifierProvider {
  readonly name: VerifierProviderName;
  readonly webGrounded: boolean;
  verify(
    question: string,
    options: readonly [string, string, string, string],
  ): Promise<VerifyResult>;
}

// ---------------------------------------------------------------------------
// Embedder
// ---------------------------------------------------------------------------

export interface EmbedResult {
  vector: number[];
  provider: EmbeddingProviderName;
  costUsd: number;
}

export interface EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  readonly dimension: number;
  embed(text: string): Promise<EmbedResult>;
  embedBatch(texts: string[]): Promise<EmbedResult[]>;
}
