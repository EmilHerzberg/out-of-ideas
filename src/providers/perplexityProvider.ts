import axios, { AxiosInstance } from 'axios';
import { requireKey } from '../config.js';
import { costLogger } from '../cost-logger.js';
import { VerifierOutputSchema } from '../schema.js';
import type { VerifierProvider, VerifyResult } from './types.js';

/**
 * Perplexity Sonar Pro — web-grounded verifier. Returns native citations.
 *
 * The verifier prompt asks the model to answer the multiple-choice question
 * independently and return JSON with the chosen letter, confidence, and a citation.
 */

const MODEL = 'sonar-pro';

// Pricing varies — verify at https://docs.perplexity.ai/guides/pricing
const PRICE_PER_MTOK_INPUT = 3.0;
const PRICE_PER_MTOK_OUTPUT = 15.0;

const VERIFY_SYSTEM_PROMPT = `You are an independent fact-checker for a multiple-choice quiz question.
Use web sources to determine the correct answer. Reason it through carefully.

Respond ONLY in JSON, no extra text:
{
  "chosenLetter": "A" | "B" | "C" | "D",
  "confidence": "high" | "medium" | "low",
  "citation": "<URL of best source>"
}

If you are not confident in any answer, set confidence to "low".`;

interface PerplexityResponse {
  choices: Array<{
    message: { content: string };
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

export class PerplexityProvider implements VerifierProvider {
  readonly name = 'perplexity' as const;
  readonly webGrounded = true;
  private http: AxiosInstance;

  constructor() {
    const apiKey = requireKey('PERPLEXITY_API_KEY', 'perplexity');
    this.http = axios.create({
      baseURL: 'https://api.perplexity.ai',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60_000,
    });
  }

  async verify(
    question: string,
    options: readonly [string, string, string, string],
  ): Promise<VerifyResult> {
    const userPrompt = buildVerifyUserPrompt(question, options);
    const { data } = await this.http.post<PerplexityResponse>('/chat/completions', {
      model: MODEL,
      messages: [
        { role: 'system', content: VERIFY_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 512,
      temperature: 0.0,
    });

    const inputTokens = data.usage.prompt_tokens;
    const outputTokens = data.usage.completion_tokens;
    const costUsd =
      (inputTokens * PRICE_PER_MTOK_INPUT) / 1_000_000 +
      (outputTokens * PRICE_PER_MTOK_OUTPUT) / 1_000_000;

    costLogger.record('perplexity', costUsd, {
      input: inputTokens,
      output: outputTokens,
    });

    const raw = data.choices[0]?.message.content ?? '';
    const parsed = parseVerifierJson(raw);

    return {
      chosenLetter: parsed.chosenLetter,
      confidence: parsed.confidence,
      citation: parsed.citation,
      rawResponse: raw,
      provider: 'perplexity',
      webGrounded: true,
      costUsd,
    };
  }
}

export function buildVerifyUserPrompt(
  question: string,
  options: readonly [string, string, string, string],
): string {
  return [
    `Question: ${question}`,
    `Options:`,
    `  A) ${options[0]}`,
    `  B) ${options[1]}`,
    `  C) ${options[2]}`,
    `  D) ${options[3]}`,
    ``,
    `Which option is correct? Respond in JSON only.`,
  ].join('\n');
}

/**
 * Best-effort JSON parser — strips markdown fences if present, tolerates extra text.
 * Falls back to confidence=low on parse failure.
 */
export function parseVerifierJson(raw: string): {
  chosenLetter: 'A' | 'B' | 'C' | 'D';
  confidence: 'high' | 'medium' | 'low';
  citation: string;
} {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  // Find the first JSON object in the response.
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) {
    return { chosenLetter: 'A', confidence: 'low', citation: '' };
  }
  try {
    const obj = JSON.parse(match[0]);
    const validated = VerifierOutputSchema.parse(obj);
    return {
      chosenLetter: validated.chosenLetter,
      confidence: validated.confidence,
      citation: validated.citation,
    };
  } catch {
    return { chosenLetter: 'A', confidence: 'low', citation: '' };
  }
}
