import path from 'node:path';
import pLimit from 'p-limit';
import ora from 'ora';
import { DATA_DIR } from './config.js';
import { JsonlWriter, readJsonl, todayStamp } from './utils/jsonl.js';
import { getVerifierProvider } from './providers/factory.js';
import type { Question } from './schema.js';
import type { VerifierProviderName } from './providers/types.js';

export interface VerifyOptions {
  inputPath: string;
  outputPath?: string;
  reviewQueuePath?: string;
  provider?: VerifierProviderName;
}

const LETTER_TO_INDEX: Record<'A' | 'B' | 'C' | 'D', 0 | 1 | 2 | 3> = {
  A: 0,
  B: 1,
  C: 2,
  D: 3,
};

/** Patterns that indicate a transport-class hiccup worth retrying. Anything
 *  else (auth, schema, model logic) we do NOT retry — that's a real failure
 *  the human should see. */
const TRANSIENT_RE = /(fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|getaddrinfo|503|504|UND_ERR_CONNECT)/i;

async function verifyWithRetry(
  provider: ReturnType<typeof getVerifierProvider>,
  question: string,
  options: readonly [string, string, string, string],
): Promise<Awaited<ReturnType<typeof provider.verify>>> {
  try {
    return await provider.verify(question, options);
  } catch (err) {
    const msg = (err as Error).message || '';
    if (!TRANSIENT_RE.test(msg)) throw err;
    // Single retry after a small jittered backoff.
    await new Promise((r) => setTimeout(r, 800 + Math.floor(Math.random() * 600)));
    return await provider.verify(question, options);
  }
}

export async function verifyQuestions(opts: VerifyOptions): Promise<{
  passed: number;
  failed: number;
  outputPath: string;
}> {
  const provider = getVerifierProvider(opts.provider);
  const outputPath =
    opts.outputPath ?? path.join(DATA_DIR, `verified-${todayStamp()}.jsonl`);
  const reviewQueuePath =
    opts.reviewQueuePath ?? path.join(DATA_DIR, 'review-queue.jsonl');

  const writer = await JsonlWriter.open(outputPath);
  const reviewWriter = await JsonlWriter.open(reviewQueuePath);

  const spinner = ora(
    `Verifying questions via ${provider.name}${provider.webGrounded ? ' (web-grounded)' : ' (reasoning-only)'}...`,
  ).start();

  let passed = 0;
  let failed = 0;
  const limit = pLimit(5);

  const tasks: Promise<void>[] = [];
  for await (const q of readJsonl<Question>(opts.inputPath)) {
    tasks.push(
      limit(async () => {
        try {
          // schema.ts QuestionSchema enforces .length(4), but TS sees string[].
          const tuple = q.answers as unknown as readonly [string, string, string, string];
          // One retry on transient network errors (smoke test 18:56 surfaced
          // 2x `fetch failed` mid-run that would have passed on retry). Only
          // retries on transport-class errors — a real verification failure
          // still falls through to the catch and is flagged.
          const result = await verifyWithRetry(provider, q.question, tuple);
          const verifierIndex = LETTER_TO_INDEX[result.chosenLetter];
          const matchesGenerator = verifierIndex === q.correctIndex;
          const passes = matchesGenerator && result.confidence !== 'low';

          const enriched: Question = {
            ...q,
            verificationProvider: result.provider,
            verificationStatus: passes ? 'passed' : 'failed',
            sourceLink: result.citation || q.sourceLink,
          };

          await writer.write(enriched);
          if (passes) {
            passed += 1;
          } else {
            failed += 1;
            await reviewWriter.write({
              ...enriched,
              verifierChosenLetter: result.chosenLetter,
              verifierConfidence: result.confidence,
              verifierRawResponse: result.rawResponse,
              flagReason: matchesGenerator ? 'low-confidence' : 'mismatch',
            });
          }
          spinner.text = `Verified ${passed + failed} (passed ${passed}, failed ${failed})`;
        } catch (err) {
          failed += 1;
          await writer.write({
            ...q,
            verificationProvider: provider.name,
            verificationStatus: 'failed',
          });
          process.stderr.write(`\n[verify ${q.id}] error: ${(err as Error).message}\n`);
        }
      }),
    );
  }

  await Promise.all(tasks);
  await writer.close();
  await reviewWriter.close();

  spinner.succeed(
    `Verification complete. Passed ${passed}, failed ${failed} → ${outputPath} (failed flagged in ${reviewQueuePath})`,
  );

  return { passed, failed, outputPath };
}
