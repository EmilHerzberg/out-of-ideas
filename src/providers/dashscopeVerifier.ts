import axios, { AxiosInstance } from 'axios';
import { requireKey } from '../config.js';
import { costLogger } from '../cost-logger.js';
import type { VerifierProvider, VerifyResult } from './types.js';
import { buildVerifyUserPrompt, parseVerifierJson } from './perplexityProvider.js';

/**
 * DashScope Qwen3-Max with web search (`enable_search: true`) — Chinese-side
 * web-grounded verifier alternative to Perplexity.
 *
 * Quality: Qwen3-Max + web search returns citations natively, so this is a
 * proper Perplexity equivalent (unlike the DeepSeek-R1-only path which had
 * no web access). Operator can A/B-compare for question quality.
 */

const MODEL = 'qwen3-max';

// DashScope native API endpoint (supports enable_search). The OpenAI-compatible
// /compatible-mode/v1 endpoint does not always pass through DashScope-specific
// parameters, so we use the native endpoint here.
const ENDPOINT = '/services/aigc/text-generation/generation';

// Pricing — verify at https://www.alibabacloud.com/help/en/model-studio/billing-overview
// qwen3-max approximate input $1.20/M, output $6.00/M (verify at impl time).
const PRICE_PER_MTOK_INPUT = 1.2;
const PRICE_PER_MTOK_OUTPUT = 6.0;

const VERIFY_SYSTEM_PROMPT = `You are an independent fact-checker for a multiple-choice quiz question.
Use web search results to determine the correct answer. Reason it through carefully and cite a source.

Respond ONLY in JSON, no extra text outside the JSON object:
{
  "chosenLetter": "A" | "B" | "C" | "D",
  "confidence": "high" | "medium" | "low",
  "citation": "<URL of best source>"
}

If the search results are inconclusive or contradictory, set confidence to "low".`;

interface DashScopeResponse {
  output: {
    text?: string;
    choices?: Array<{ message: { content: string } }>;
    finish_reason?: string;
    search_info?: {
      search_results?: Array<{ url?: string; title?: string }>;
    };
  };
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens?: number;
  };
}

export class DashScopeVerifierProvider implements VerifierProvider {
  readonly name = 'dashscope' as const;
  readonly webGrounded = true;
  private http: AxiosInstance;

  constructor() {
    const apiKey = requireKey('DASHSCOPE_API_KEY', 'dashscope (verifier)');
    this.http = axios.create({
      baseURL: 'https://dashscope.aliyuncs.com/api/v1',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 90_000,
    });
  }

  async verify(
    question: string,
    options: readonly [string, string, string, string],
  ): Promise<VerifyResult> {
    const userPrompt = buildVerifyUserPrompt(question, options);

    const { data } = await this.http.post<DashScopeResponse>(ENDPOINT, {
      model: MODEL,
      input: {
        messages: [
          { role: 'system', content: VERIFY_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      },
      parameters: {
        result_format: 'message',
        enable_search: true,
        max_tokens: 1024,
        temperature: 0.0,
      },
    });

    const inputTokens = data.usage.input_tokens;
    const outputTokens = data.usage.output_tokens;
    const costUsd =
      (inputTokens * PRICE_PER_MTOK_INPUT) / 1_000_000 +
      (outputTokens * PRICE_PER_MTOK_OUTPUT) / 1_000_000;

    costLogger.record('dashscope', costUsd, {
      input: inputTokens,
      output: outputTokens,
    });

    // result_format: 'message' returns choices[0].message.content; older format
    // returns output.text. Support both for forward compat.
    const raw =
      data.output.choices?.[0]?.message.content ??
      data.output.text ??
      '';

    const parsed = parseVerifierJson(raw);

    // Prefer parsed citation; fallback to first search result URL if available.
    const fallbackCitation = data.output.search_info?.search_results?.[0]?.url ?? '';
    const citation = parsed.citation || fallbackCitation;

    return {
      chosenLetter: parsed.chosenLetter,
      confidence: parsed.confidence,
      citation,
      rawResponse: raw,
      provider: 'dashscope',
      webGrounded: true,
      costUsd,
    };
  }
}
