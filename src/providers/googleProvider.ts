import { GoogleGenAI } from '@google/genai';
import { requireKey, config } from '../config.js';
import { costLogger } from '../cost-logger.js';
import type {
  ChatOptions,
  ChatProvider,
  ChatResult,
  VerifierProvider,
  VerifyResult,
  EmbeddingProvider,
  EmbedResult,
} from './types.js';

const PROJECT = config.GOOGLE_CLOUD_PROJECT || '';
const LOCATION = config.GOOGLE_CLOUD_LOCATION || 'europe-west3';

// Per-model pricing (per million tokens). Verify at https://cloud.google.com/vertex-ai/generative-ai/pricing.
// Pro tier ≈ 4× the cost of Flash tier on output; ~5× on input.
interface GooglePricing { input: number; output: number }
const GOOGLE_PRICING: Record<string, GooglePricing> = {
  // Pro tier (top-tier reasoning + multimodal)
  'gemini-3.1-pro-preview': { input: 1.25, output: 5.0 },
  'gemini-2.5-pro':         { input: 1.25, output: 5.0 },
  'gemini-1.5-pro':         { input: 1.25, output: 5.0 },
  // Flash tier (fast, cheap)
  'gemini-3-flash-preview': { input: 0.30, output: 2.50 },
  'gemini-2.5-flash':       { input: 0.30, output: 2.50 },
  'gemini-1.5-flash':       { input: 0.30, output: 2.50 },
};
const GOOGLE_DEFAULT_PRICING: GooglePricing = { input: 1.25, output: 5.0 };

function priceForGoogleModel(model: string): GooglePricing {
  if (GOOGLE_PRICING[model]) return GOOGLE_PRICING[model];
  // Heuristic fallback: anything with "flash" in the name uses Flash pricing.
  if (/flash/i.test(model)) return { input: 0.30, output: 2.50 };
  return GOOGLE_DEFAULT_PRICING;
}

let googleClient: GoogleGenAI | null = null;
let googleClientMode: 'apikey' | 'vertex' | null = null;

/**
 * Resolve a Google GenAI client. Prefers direct Gemini API (AI Studio) when
 * GOOGLE_API_KEY is set; falls back to Vertex AI when GOOGLE_CLOUD_PROJECT is
 * configured. Cached after first call.
 *
 * Chat + verifier work in both modes. The embedder still requires Vertex
 * because text-multilingual-embedding-002 is Vertex-only — embed-time checks
 * for this and gives a clear error if only API-key mode is available.
 */
function getGoogleClient() {
  if (googleClient) return googleClient;

  if (config.GOOGLE_API_KEY) {
    googleClient = new GoogleGenAI({ apiKey: config.GOOGLE_API_KEY });
    googleClientMode = 'apikey';
    return googleClient;
  }
  if (PROJECT) {
    googleClient = new GoogleGenAI({ project: PROJECT, location: LOCATION, vertexai: true });
    googleClientMode = 'vertex';
    return googleClient;
  }
  throw new Error(
    'Google provider requires either GOOGLE_API_KEY (AI Studio direct mode) ' +
    'or GOOGLE_CLOUD_PROJECT + GOOGLE_APPLICATION_CREDENTIALS (Vertex AI mode). ' +
    'Set one in .env.',
  );
}

function isApiKeyMode(): boolean {
  if (googleClientMode === null) getGoogleClient();
  return googleClientMode === 'apikey';
}

// Module-level throttle state for embed-call pacing (AI Studio free tier
// caps embedding at ~100 RPM globally per key — must be SHARED across all
// concurrent embedBatch instances, not per-instance, hence module-level).
let __lastEmbedCallEndedAt = 0;
async function __throttleEmbedCall(delayMs: number): Promise<void> {
  if (delayMs <= 0) return;
  const elapsed = Date.now() - __lastEmbedCallEndedAt;
  if (elapsed < delayMs) {
    await new Promise((r) => setTimeout(r, delayMs - elapsed));
  }
  __lastEmbedCallEndedAt = Date.now();
}

// ---------------------------------------------------------------------------
// Long-running retry-with-backoff for Google API calls
// ---------------------------------------------------------------------------
//
// The Gemini / AI Studio / Vertex APIs return transient errors much more
// often than feels reasonable (429 rate-limit, 500/502/503/504 capacity).
// "This model is currently experiencing high demand" can persist for
// 5-30 minutes during morning spikes. To prevent orchestrator runs from
// aborting mid-batch every time Google has a hiccup, every Google API
// call goes through this retry budget:
//
//   - Up to 60 min total retry window (configurable)
//   - Per-sleep cap of 2 min (so we don't sleep an absurd 17-min between attempts)
//   - Exponential backoff with jitter: 1s, 2s, 4s, 8s, 16s, 32s, 64s, 120s, 120s, ...
//   - Stops immediately on 4xx auth errors (invalid key, billing) — no point retrying
//
// If 60 min isn't enough, the underlying issue is bigger than a hiccup and
// operator intervention is needed. The orchestrator's own auto-disable
// kicks in after consecutive failures (separate from this retry).

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const FATAL_STATUSES = new Set([400, 401, 403, 404]);
const DEFAULT_MAX_TOTAL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_MAX_SLEEP_MS = 2 * 60 * 1000;  // 2 min per sleep cap

async function googleCallWithRetry<T>(
  callName: string,
  call: () => Promise<T>,
  opts: { maxTotalMs?: number; maxSleepMs?: number } = {},
): Promise<T> {
  const maxTotalMs = opts.maxTotalMs ?? DEFAULT_MAX_TOTAL_MS;
  const maxSleepMs = opts.maxSleepMs ?? DEFAULT_MAX_SLEEP_MS;
  const startTime = Date.now();
  let attempt = 0;
  let lastErr: unknown = null;

  while (Date.now() - startTime < maxTotalMs) {
    try {
      return await call();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      // Fatal: auth/permission/model-not-found — retrying won't help.
      if (status !== undefined && FATAL_STATUSES.has(status)) throw err;
      // If it's not in our known-retryable set, also fail fast.
      if (status !== undefined && !RETRYABLE_STATUSES.has(status)) throw err;
      const elapsed = Date.now() - startTime;
      const remaining = maxTotalMs - elapsed;
      if (remaining <= 0) break;
      const baseDelay = Math.min(maxSleepMs, 2 ** Math.min(attempt, 30) * 1000);
      const jitter = Math.floor(Math.random() * 500);
      const delay = Math.min(baseDelay + jitter, remaining);
      const msg = (err as { message?: string }).message ?? String(err);
      const elapsedMin = (elapsed / 60000).toFixed(1);
      process.stderr.write(
        `[google:${callName}] retry ${attempt + 1} after ${(delay / 1000).toFixed(1)}s ` +
        `(elapsed ${elapsedMin}min, status ${status ?? '?'}, "${msg.slice(0, 80)}")\n`,
      );
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
  const totalMin = ((Date.now() - startTime) / 60000).toFixed(1);
  throw new Error(
    `Google API ${callName} failed after ${attempt} retries over ${totalMin} min. ` +
    `Last error: ${(lastErr as { message?: string })?.message ?? lastErr}`,
  );
}

export class GoogleChatProvider implements ChatProvider {
  readonly name = 'google' as const;

  async generate(
    systemPrompt: string,
    userPrompt: string,
    opts: ChatOptions = {},
  ): Promise<ChatResult> {
    const ai = getGoogleClient();

    const response = await googleCallWithRetry('generateContent', () =>
      ai.models.generateContent({
        model: config.GOOGLE_GENERATOR_MODEL,
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          maxOutputTokens: opts.maxTokens ?? 2048,
          temperature: opts.temperature ?? 0.7,
          ...(opts.jsonMode ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    );

    const result = response;

    const inputTokens = result.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = result.usageMetadata?.candidatesTokenCount ?? 0;
    const cachedInputTokens = result.usageMetadata?.cachedContentTokenCount ?? 0;

    const pricing = priceForGoogleModel(config.GOOGLE_GENERATOR_MODEL);
    const costUsd =
      (inputTokens * pricing.input) / 1_000_000 +
      (outputTokens * pricing.output) / 1_000_000;

    costLogger.record('google', costUsd, {
      input: inputTokens,
      cachedInput: cachedInputTokens,
      output: outputTokens,
    });

    const content = result.text ?? '';

    // Surface non-STOP finish reasons so truncation/safety blocks don't fail
    // silently downstream as malformed JSON. Pre-fix this provider returned
    // ~36 tokens of half-written JSON whenever Gemini's thinking budget ate
    // the maxOutputTokens before the visible response could complete.
    const finishReason = result.candidates?.[0]?.finishReason;
    const thoughtsTokens = (result.usageMetadata as { thoughtsTokenCount?: number } | undefined)?.thoughtsTokenCount ?? 0;
    if (finishReason && finishReason !== 'STOP') {
      const detail =
        finishReason === 'MAX_TOKENS'
          ? `hit maxOutputTokens=${opts.maxTokens ?? 2048} (visible=${outputTokens}, thoughts=${thoughtsTokens}). Bump maxTokens or disable JSON mode.`
          : finishReason === 'SAFETY' || finishReason === 'RECITATION' || finishReason === 'PROHIBITED_CONTENT'
          ? `blocked by ${finishReason} filter — prompt rephrase needed.`
          : `unexpected finishReason ${finishReason}.`;
      throw new Error(`Gemini finished early: ${detail}`);
    }

    return {
      content,
      provider: 'google',
      model: config.GOOGLE_GENERATOR_MODEL,
      costUsd,
      inputTokens,
      cachedInputTokens,
      outputTokens,
    };
  }
}

export class GoogleVerifierProvider implements VerifierProvider {
  readonly name = 'google' as const;
  readonly webGrounded = true;

  async verify(
    question: string,
    options: readonly [string, string, string, string],
  ): Promise<VerifyResult> {
    const ai = getGoogleClient();

    // Verifier prompt: split into system instruction (the contract) and user
    // input (the question). Thinking-class models (Gemini 3.x in particular)
    // behave differently between "everything in user content" and proper
    // system+user separation — splitting reduces the risk that thinking
    // budget is consumed before the JSON renders.
    const systemInstruction = `You are a strict fact checker for a multiple-choice quiz pipeline. Your single job: independently verify which of the 4 provided options is the correct answer to the question.

WORKFLOW
1. Spend your search budget on FINDING the answer. Do not enumerate the options in your reasoning trace — just find the answer and pick the matching option.
2. Then return JSON. Do NOT include reasoning text in the visible output.

CONFIDENCE CALIBRATION
- "high"   — your search returned a clear, consensus answer that exactly matches one option.
- "medium" — your search returned a defensible answer, but the question has ambiguity (e.g., the answer depends on how you measure / which year / which region) OR the question is a Fermi-style estimate where the correct option's value is within 2x of one or more other options.
- "low"    — you could not confirm the answer through search. Use this sparingly — for estimation/Fermi questions where multiple options are defensible, prefer "medium" over "low".

ESTIMATION-AWARE BEHAVIOR
If the question begins with "Roughly" / "About" / "How many" / asks for a percentage or order-of-magnitude estimate, do NOT downgrade to "low" just because no source exactly matches. Pick the option closest to a defensible computed value and return "medium". The pipeline's downstream stages handle Fermi tolerance.

OUTPUT
Return ONLY a JSON object — no markdown fences, no commentary, no reasoning trace:
{
  "chosenLetter": "A" | "B" | "C" | "D",
  "confidence": "high" | "medium" | "low",
  "citation": "1 short sentence summarizing the source you found, no URL"
}`;

    const userPrompt = `Question: ${question}
A) ${options[0]}
B) ${options[1]}
C) ${options[2]}
D) ${options[3]}`;

    // AI Studio mode rejects `responseMimeType: 'application/json'` when
    // combined with `tools: [{ googleSearch: {} }]` (400 INVALID_ARGUMENT:
    // "Tool use with a response mime type: 'application/json' is
    // unsupported"). Vertex AI accepted the combination, but AI Studio does
    // not. We drop the mime type and rely on the system-prompt's "Return
    // ONLY a JSON object — no markdown fences" instruction, plus a robust
    // parser below that handles fence-wrapping defensively.
    const response = await googleCallWithRetry('verifyContent', () =>
      ai.models.generateContent({
        model: config.GOOGLE_VERIFIER_MODEL,
        contents: userPrompt,
        config: {
          systemInstruction,
          temperature: 0.1,
          tools: [{ googleSearch: {} }],
        },
      }),
    );

    const result = response;
    const rawResponse = result.text ?? '{}';

    const inputTokens = result.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = result.usageMetadata?.candidatesTokenCount ?? 0;
    const pricing = priceForGoogleModel(config.GOOGLE_VERIFIER_MODEL);
    const costUsd =
      (inputTokens * pricing.input) / 1_000_000 +
      (outputTokens * pricing.output) / 1_000_000;

    costLogger.record('google', costUsd, { input: inputTokens, output: outputTokens });

    // Robust JSON extraction. Without responseMimeType the model may wrap
    // its output in markdown fences (```json ... ```) or add a stray line
    // of commentary despite the system-prompt instruction. Strategy:
    //   1. Try parsing the raw response directly (works if model obeyed).
    //   2. Strip ```json / ``` fences if present.
    //   3. Fall back to extracting the first `{...}` block via regex.
    let parsed: any;
    try {
      parsed = JSON.parse(rawResponse);
    } catch {
      try {
        const stripped = rawResponse
          .replace(/^[\s\S]*?```(?:json)?\s*/, '')
          .replace(/\s*```[\s\S]*$/, '')
          .trim();
        parsed = JSON.parse(stripped);
      } catch {
        try {
          const match = rawResponse.match(/\{[\s\S]*\}/);
          parsed = match ? JSON.parse(match[0]) : null;
        } catch {
          parsed = null;
        }
      }
    }
    if (!parsed || typeof parsed !== 'object') {
      parsed = { chosenLetter: 'A', confidence: 'low', citation: 'Failed to parse JSON.' };
    }

    return {
      chosenLetter: parsed.chosenLetter as any,
      confidence: parsed.confidence as any,
      citation: parsed.citation || '',
      rawResponse,
      provider: 'google',
      webGrounded: true,
      costUsd,
    };
  }
}

export class GoogleEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'google' as const;
  readonly dimension = 768;

  async embed(text: string): Promise<EmbedResult> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<EmbedResult[]> {
    const ai = getGoogleClient();

    // Pick a model based on auth mode:
    //   - Vertex AI mode: configured GOOGLE_EMBEDDER_MODEL works as-is.
    //   - API-key mode (AI Studio): `text-multilingual-embedding-002` is
    //     NOT reachable via the Gemini API endpoint; auto-fallback to
    //     `gemini-embedding-001` (default 3072-d, here we request 768-d
    //     via outputDimensionality for storage parity with the existing pool).
    //
    // WARNING: different models = different vector spaces. Mixing them in
    // the same pool breaks dedup. If you switch auth modes, run
    // `re-embed-pool.mjs` once to re-embed the full pool with the new model
    // before continuing generation.
    let model = config.GOOGLE_EMBEDDER_MODEL;
    if (isApiKeyMode() && model === 'text-multilingual-embedding-002') {
      model = 'gemini-embedding-001';
    }

    // For gemini-embedding-001 we explicitly request 768-d output. Otherwise
    // the model defaults to 3072-d which would 4× our pool storage size.
    const embedConfig: { outputDimensionality?: number } | undefined =
      model.startsWith('gemini-embedding') ? { outputDimensionality: 768 } : undefined;

    const results: EmbedResult[] = [];

    // Throttle between calls when in API-key mode — AI Studio free tier
    // caps embedding requests at ~100 RPM globally. 700ms spacing keeps us
    // under that with margin. Shared via module-level state so concurrent
    // embedBatch instances (driven by pLimit upstream) coordinate timing.
    const throttleMs = isApiKeyMode() ? 700 : 0;

    // Process in batches if necessary, but simple loop for now
    for (const text of texts) {
      await __throttleEmbedCall(throttleMs);
      const response = await googleCallWithRetry('embedContent', () =>
        ai.models.embedContent({
          model,
          contents: text,
          ...(embedConfig ? { config: embedConfig } : {}),
        }),
      );

      // Approximate cost (very cheap, roughly $0.025 / 1M chars)
      const costUsd = (text.length * 0.025) / 1_000_000;
      costLogger.record('google', costUsd);

      results.push({
        vector: response.embeddings?.[0]?.values || [],
        provider: 'google',
        costUsd
      });
    }

    return results;
  }
}
