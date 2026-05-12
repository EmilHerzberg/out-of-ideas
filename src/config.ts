import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from question-pipeline/ root (parent of src/)
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const ConfigSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_GENERATOR_MODEL: z.string().default('claude-opus-4-7'),
  DEEPSEEK_API_KEY: z.string().optional(),
  /** DeepSeek generator default upgraded to `deepseek-v4-pro` 2026-05-03. V4-Pro
   *  is DeepSeek's current flagship — Opus 4.7-class quality at ~3× v4-flash
   *  cost. The earlier "V4-Pro returns empty content" issue (logged 2026-04)
   *  appears resolved in the V4 GA release; if it recurs, fall back to
   *  `deepseek-v4-flash` (same alias as legacy `deepseek-chat`). */
  DEEPSEEK_GENERATOR_MODEL: z.string().default('deepseek-v4-pro'),
  /** Quality stage stays on `deepseek-chat` (== v4-flash non-thinking) for now.
   *  Quality assessment doesn't need V4-Pro-class judgment — flash is fast and
   *  cheap, and we already have a strong archetype-aware rubric carrying the
   *  load. Override here if we ever want V4-Pro for stricter rating. */
  DEEPSEEK_QUALITY_MODEL: z.string().default('deepseek-chat'),
  PERPLEXITY_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  /** Alibaba DashScope API key — used for Qwen chat (generator), Qwen-Max verifier, text-embedding-v4 embedder. */
  DASHSCOPE_API_KEY: z.string().optional(),
  DASHSCOPE_GENERATOR_MODEL: z.string().default('qwen-max'),
  DASHSCOPE_REGION: z.enum(['intl', 'cn']).default('intl'),
  /** OpenAI — used for the GPT-5 family on generation. */
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_GENERATOR_MODEL: z.string().default('gpt-5'),
  /** Z.ai (ZhipuAI / GLM) — Chinese frontier model family. */
  ZAI_API_KEY: z.string().optional(),
  ZAI_GENERATOR_MODEL: z.string().default('glm-5.1'),
  /** ZAI_REGION: intl | cn */
  ZAI_REGION: z.enum(['intl', 'cn']).default('intl'),
  /** Moonshot (Kimi) — Chinese long-context flagship. */
  MOONSHOT_API_KEY: z.string().optional(),
  MOONSHOT_GENERATOR_MODEL: z.string().default('kimi-k2.6'),
  /** MOONSHOT_REGION: intl | cn */
  MOONSHOT_REGION: z.enum(['intl', 'cn']).default('intl'),
  /** BytePlus — direct ByteDance / Volcano Engine access for Doubao Seed 2.0
   *  Pro (frontier; not yet routed via OpenRouter). When this key is set, the
   *  `openrouter-doubao` rotation slot auto-disables in favour of the direct
   *  provider — same shadowing pattern as DashScope vs openrouter-qwen. */
  BYTEPLUS_API_KEY: z.string().optional(),
  BYTEPLUS_GENERATOR_MODEL: z.string().default('doubao-seed-2-0-pro'),
  /** OpenRouter — single key, many providers. Used to access Chinese flagships
   *  (Qwen, MiniMax, Baidu ERNIE, ByteDance Seed/Doubao) without needing
   *  separate API keys for each. */
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_QWEN_MODEL:    z.string().default('qwen/qwen3.6-max-preview'),
  OPENROUTER_MINIMAX_MODEL: z.string().default('minimax/minimax-m2.7'),
  OPENROUTER_ERNIE_MODEL:   z.string().default('baidu/ernie-4.5-300b-a47b'),
  OPENROUTER_DOUBAO_MODEL:  z.string().default('bytedance-seed/seed-2.0-lite'),
  GOOGLE_CLOUD_PROJECT: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  GOOGLE_CLOUD_LOCATION: z.string().default('europe-west3'),
  /** AI Studio (Gemini API) direct key — alternative to Vertex AI service account.
   *  When set, GoogleChatProvider + GoogleVerifierProvider use the direct Gemini API
   *  instead of Vertex. Embedder still requires Vertex (text-multilingual-embedding-002
   *  is Vertex-only); switch PROVIDER_EMBEDDER to voyage/dashscope if you have no Vertex. */
  GOOGLE_API_KEY: z.string().optional(),
  GOOGLE_GENERATOR_MODEL: z.string().default('gemini-2.5-pro'),
  GOOGLE_VERIFIER_MODEL: z.string().default('gemini-2.5-flash'),
  /** Embedder model. Default `gemini-embedding-001` works in BOTH AI Studio
   *  (API key) and Vertex AI modes. Default output is 3072-d but the embedder
   *  requests 768-d via outputDimensionality for compatibility / storage.
   *  The older Vertex-only `text-multilingual-embedding-002` still works if
   *  you have Vertex access and want multilingual specialisation. */
  GOOGLE_EMBEDDER_MODEL: z.string().default('gemini-embedding-001'),
  /** Vertex AI Model Garden partner-model defaults (use the same Google service account). */
  VERTEX_MISTRAL_GENERATOR_MODEL: z.string().default('mistral-large-2411'),
  VERTEX_AI21_GENERATOR_MODEL: z.string().default('jamba-1.5-large'),
  VERTEX_GROK_GENERATOR_MODEL: z.string().default('grok-4-1-fast-non-reasoning'),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),
  PROVIDER_GENERATOR: z
    .enum(['anthropic', 'deepseek', 'google', 'openai', 'dashscope', 'vertex-mistral', 'vertex-ai21', 'vertex-grok', 'zai', 'moonshot', 'byteplus', 'openrouter-qwen', 'openrouter-minimax', 'openrouter-ernie', 'openrouter-doubao'])
    .default('anthropic'),
  PROVIDER_VERIFIER: z.enum(['perplexity', 'dashscope', 'google']).default('perplexity'),
  PROVIDER_EMBEDDER: z.enum(['voyage', 'dashscope', 'google']).default('voyage'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;

export const config: Config = ConfigSchema.parse({
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_GENERATOR_MODEL: process.env.ANTHROPIC_GENERATOR_MODEL,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  DEEPSEEK_GENERATOR_MODEL: process.env.DEEPSEEK_GENERATOR_MODEL,
  DEEPSEEK_QUALITY_MODEL: process.env.DEEPSEEK_QUALITY_MODEL,
  PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY,
  VOYAGE_API_KEY: process.env.VOYAGE_API_KEY,
  DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY,
  DASHSCOPE_GENERATOR_MODEL: process.env.DASHSCOPE_GENERATOR_MODEL,
  DASHSCOPE_REGION: process.env.DASHSCOPE_REGION,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_GENERATOR_MODEL: process.env.OPENAI_GENERATOR_MODEL,
  ZAI_API_KEY: process.env.ZAI_API_KEY,
  ZAI_GENERATOR_MODEL: process.env.ZAI_GENERATOR_MODEL,
  ZAI_REGION: process.env.ZAI_REGION,
  MOONSHOT_API_KEY: process.env.MOONSHOT_API_KEY,
  MOONSHOT_GENERATOR_MODEL: process.env.MOONSHOT_GENERATOR_MODEL,
  MOONSHOT_REGION: process.env.MOONSHOT_REGION,
  BYTEPLUS_API_KEY: process.env.BYTEPLUS_API_KEY,
  BYTEPLUS_GENERATOR_MODEL: process.env.BYTEPLUS_GENERATOR_MODEL,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_QWEN_MODEL: process.env.OPENROUTER_QWEN_MODEL,
  OPENROUTER_MINIMAX_MODEL: process.env.OPENROUTER_MINIMAX_MODEL,
  OPENROUTER_ERNIE_MODEL: process.env.OPENROUTER_ERNIE_MODEL,
  OPENROUTER_DOUBAO_MODEL: process.env.OPENROUTER_DOUBAO_MODEL,
  GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
  GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  GOOGLE_CLOUD_LOCATION: process.env.GOOGLE_CLOUD_LOCATION,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  GOOGLE_GENERATOR_MODEL: process.env.GOOGLE_GENERATOR_MODEL,
  GOOGLE_VERIFIER_MODEL: process.env.GOOGLE_VERIFIER_MODEL,
  GOOGLE_EMBEDDER_MODEL: process.env.GOOGLE_EMBEDDER_MODEL,
  VERTEX_MISTRAL_GENERATOR_MODEL: process.env.VERTEX_MISTRAL_GENERATOR_MODEL,
  VERTEX_AI21_GENERATOR_MODEL: process.env.VERTEX_AI21_GENERATOR_MODEL,
  VERTEX_GROK_GENERATOR_MODEL: process.env.VERTEX_GROK_GENERATOR_MODEL,
  FIREBASE_SERVICE_ACCOUNT_PATH: process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
  PROVIDER_GENERATOR: process.env.PROVIDER_GENERATOR,
  PROVIDER_VERIFIER: process.env.PROVIDER_VERIFIER,
  PROVIDER_EMBEDDER: process.env.PROVIDER_EMBEDDER,
  LOG_LEVEL: process.env.LOG_LEVEL,
});

/**
 * Throw a clear error if a required API key is missing for a given provider.
 */
export function requireKey(
  key:
    | 'ANTHROPIC_API_KEY'
    | 'DEEPSEEK_API_KEY'
    | 'PERPLEXITY_API_KEY'
    | 'VOYAGE_API_KEY'
    | 'DASHSCOPE_API_KEY'
    | 'OPENAI_API_KEY'
    | 'ZAI_API_KEY'
    | 'MOONSHOT_API_KEY'
    | 'BYTEPLUS_API_KEY'
    | 'OPENROUTER_API_KEY'
    | 'GOOGLE_CLOUD_PROJECT'
    | 'FIREBASE_SERVICE_ACCOUNT_PATH',
  providerName: string,
): string {
  const val = config[key];
  if (!val) {
    throw new Error(
      `Missing ${key} in .env — required for ${providerName}. ` +
        `Copy .env.example to .env and fill in the key.`,
    );
  }
  return val;
}

export const PROJECT_ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const PROMPTS_DIR = path.resolve(PROJECT_ROOT, 'src', 'prompts');
