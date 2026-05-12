import { GoogleAuth } from 'google-auth-library';
import { config, requireKey } from '../config.js';

/**
 * Shared Google Cloud auth + endpoint helpers for Vertex AI Model Garden
 * partner models (Mistral, AI21, xAI Grok, etc.).
 *
 * All three partner-model families on Vertex use:
 *   - the same service-account credentials (whatever GOOGLE_APPLICATION_CREDENTIALS
 *     points at, plus GOOGLE_CLOUD_PROJECT)
 *   - the rawPredict endpoint shape:
 *     `https://{loc}-aiplatform.googleapis.com/v1/projects/{p}/locations/{loc}/publishers/{pub}/models/{model}:rawPredict`
 *   - OpenAI-compatible request/response bodies (chat.completion shape)
 *
 * The service-account needs the IAM role `Vertex AI User` plus model-specific
 * acceptance: in the Google Cloud console, the project must have "Enable" clicked
 * on each partner model under Model Garden before its endpoint will respond.
 *
 * NOTE: partner-model regional availability varies. `global` works for most;
 * fall back to `us-central1` if a specific model errors with NOT_FOUND.
 */

let cachedAuth: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  if (cachedAuth) return cachedAuth;
  cachedAuth = new GoogleAuth({
    keyFilename: config.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  return cachedAuth;
}

/** Returns a short-lived OAuth access token derived from the service-account. */
export async function getVertexAccessToken(): Promise<string> {
  const auth = getAuth();
  const client = await auth.getClient();
  const tokenResp = await client.getAccessToken();
  if (!tokenResp.token) throw new Error('Failed to acquire Vertex AI access token');
  return tokenResp.token;
}

/** Build the rawPredict URL for a Vertex Model Garden partner model. */
export function buildVertexRawPredictUrl(publisher: string, model: string): string {
  const project = requireKey('GOOGLE_CLOUD_PROJECT', `vertex-${publisher}`);
  const location = config.GOOGLE_CLOUD_LOCATION;
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  const locPath = location === 'global' ? 'global' : location;
  return `https://${host}/v1/projects/${project}/locations/${locPath}/publishers/${publisher}/models/${model}:rawPredict`;
}

/** Common OpenAI-compatible chat-completion response shape. */
export interface OpenAICompatChatResponse {
  choices: Array<{
    message: { content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}
