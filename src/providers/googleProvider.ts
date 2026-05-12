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

let vertexAiClient: GoogleGenAI | null = null;

function getVertexClient() {
  if (!vertexAiClient) {
    if (!PROJECT) {
      throw new Error('GOOGLE_CLOUD_PROJECT is required for Google provider.');
    }
    // Setup using Vertex AI backend
    vertexAiClient = new GoogleGenAI({ project: PROJECT, location: LOCATION, vertexai: true });
  }
  return vertexAiClient;
}

export class GoogleChatProvider implements ChatProvider {
  readonly name = 'google' as const;

  async generate(
    systemPrompt: string,
    userPrompt: string,
    opts: ChatOptions = {},
  ): Promise<ChatResult> {
    const ai = getVertexClient();

    const response = await ai.models.generateContent({
      model: config.GOOGLE_GENERATOR_MODEL,
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        maxOutputTokens: opts.maxTokens ?? 2048,
        temperature: opts.temperature ?? 0.7,
        ...(opts.jsonMode ? { responseMimeType: 'application/json' } : {}),
      }
    });

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
    const ai = getVertexClient();

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

    const response = await ai.models.generateContent({
      model: config.GOOGLE_VERIFIER_MODEL,
      contents: userPrompt,
      config: {
        systemInstruction,
        temperature: 0.1,
        responseMimeType: 'application/json',
        tools: [{ googleSearch: {} }]
      }
    });

    const result = response;
    const rawResponse = result.text ?? '{}';

    const inputTokens = result.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = result.usageMetadata?.candidatesTokenCount ?? 0;
    const pricing = priceForGoogleModel(config.GOOGLE_VERIFIER_MODEL);
    const costUsd =
      (inputTokens * pricing.input) / 1_000_000 +
      (outputTokens * pricing.output) / 1_000_000;

    costLogger.record('google', costUsd, { input: inputTokens, output: outputTokens });

    let parsed: any;
    try {
      parsed = JSON.parse(rawResponse);
    } catch {
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
    const ai = getVertexClient();

    const results: EmbedResult[] = [];

    // Process in batches if necessary, but simple loop for now
    for (const text of texts) {
      const response = await ai.models.embedContent({
        model: config.GOOGLE_EMBEDDER_MODEL,
        contents: text,
      });

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
