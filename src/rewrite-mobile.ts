import path from 'node:path';
import { readFile, writeFile, copyFile, mkdir, appendFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import ora from 'ora';
import pLimit from 'p-limit';
import { DATA_DIR } from './config.js';
import { JsonlWriter, readJsonl, todayStamp } from './utils/jsonl.js';
import { GeneratedQuestionSchema, QuestionSchema, type Question, type GeneratedQuestion } from './schema.js';
import { getChatProvider } from './providers/factory.js';
import { checkQuality } from './quality.js';
import { verifyQuestions } from './verifier.js';
import { embedQuestions } from './embedder.js';
import { costLogger } from './cost-logger.js';
import type { ChatProviderName } from './providers/types.js';

/**
 * Mobile-UI rewrite pipeline.
 *
 * Pool entries with `question.length > Q_MAX` or `max(answers).length > A_MAX`
 * are sent through a full rewrite → quality → verify → embed loop. Successful
 * rewrites REPLACE the original in `data/finalized-pool.jsonl`. Rewrites that
 * fail any pipeline stage cause BOTH the original and the failed rewrite to
 * be dropped from the pool (the user's spec: "if the question fails, then both
 * the too-long one and the new one are removed").
 *
 * Dedup is intentionally skipped — the rewrite is replacing an already-
 * accepted pool entry, so dedup would always reject (it would match its own
 * original). All other stages run as normal.
 *
 * Atomicity: pool is backed up to `.bak` before write; new pool is written
 * to a temp file and renamed in one step.
 */

export interface RewriteMobileOptions {
  /** Path to the default-repertoire pool. Default: data/finalized-pool.jsonl */
  poolPath?: string;
  /** Question text hard cap. Default 150. */
  qMax?: number;
  /** Per-answer hard cap. Default 60. */
  aMax?: number;
  /** Provider for the AI rewrite step. Default 'deepseek' (v4-pro). */
  provider?: ChatProviderName;
  /** Optional limit — only process the first N offenders. Useful for smoke tests. */
  limit?: number;
  /** Output directory for the pipeline's intermediate files. Auto-created. */
  workDir?: string;
  /** Skip the actual pool replacement (dry-run). Default false. */
  dryRun?: boolean;
}

export interface RewriteMobileResult {
  totalOffenders: number;
  /** Rewrites that passed every pipeline stage and replaced their original. */
  rewritten: number;
  /** Offenders whose rewrite failed at some stage — both original and failed rewrite dropped. */
  dropped: number;
  /** Mid-stage failure breakdown for the report. */
  failuresByStage: { rewriteSchema: number; quality: number; verify: number; embed: number };
  workDir: string;
  poolBefore: number;
  poolAfter: number;
  costUsd: number;
}

const SYSTEM_PROMPT = `You are compressing a multiple-choice quiz question to fit a mobile-UI character budget while preserving the puzzle, the correct answer's meaning, and the educational explanation.

HARD CAPS (the schema rejects anything over):
- Question text: ≤150 characters total. Aim for ≤120.
- Each answer: ≤60 characters total. Aim for ≤45.
- Explanation: ≤300 characters.

PRESERVATION RULES:
- The correct answer must remain SEMANTICALLY identical — same fact, same surprise, same mechanism. Just expressed concisely.
- All four answers must remain plausible and grammatically parallel.
- The archetype's puzzle structure must survive (cause_effect: still asks why; misconception: still surfaces a popular myth; strategy: still poses a strategic dilemma; etc.).
- Drop scenario padding, vivid context, and explanatory hedges. Keep the essential mechanism.

CANON GUARDRAIL:
- If the natural compression of this question lands on a universal AI-trivia stem (e.g., "Why does popcorn pop?" / "Why is the sky blue?" / "Where does mortgage come from?" / "10% of the brain" / etc.), the question is structurally default-repertoire and should be DROPPED rather than compressed. Output an obviously-invalid JSON ({"question": "DROP_CANONICAL", ...}) so the schema rejects it; the pipeline will then drop the original from the pool. Do not rewrite a default-repertoire question into a slightly different default-repertoire phrasing — the pool dedup catches the symptom but the input was already saturated.

OUTPUT JSON SCHEMA (and ONLY this JSON, no markdown fences, no commentary):
{
  "question": "<≤150 chars>",
  "answers": ["<≤60>", "<≤60>", "<≤60>", "<≤60>"],
  "correctIndex": <0|1|2|3>,
  "explanation": "<≤300 chars>"
}

The "correctIndex" you return identifies which of YOUR rewritten answers is the correct one. If you reorder, update the index accordingly — the only invariant is that the answer at correctIndex must be semantically the same as the original correct answer.`;

interface OffenderRewrite {
  /** Pool id of the original — used to match back when replacing. */
  id: string;
  rewrite: GeneratedQuestion | null;
  /** If the rewrite failed schema validation across retries, this is the reason. */
  rewriteError?: string;
}

function isOffender(q: Question, qMax: number, aMax: number): boolean {
  if (q.question.length > qMax) return true;
  for (const a of q.answers) if (a.length > aMax) return true;
  return false;
}

function buildUserPrompt(q: Question): string {
  return [
    `Category: ${q.category}`,
    `Archetype: ${q.archetype}`,
    q.subcategory ? `Subcategory: ${q.subcategory}` : '',
    `Difficulty: ${q.difficulty}`,
    '',
    `ORIGINAL question (${q.question.length} chars): ${q.question}`,
    `ORIGINAL answers (correctIndex=${q.correctIndex}):`,
    `  A) ${q.answers[0]}`,
    `  B) ${q.answers[1]}`,
    `  C) ${q.answers[2]}`,
    `  D) ${q.answers[3]}`,
    `ORIGINAL explanation: ${q.explanation}`,
    '',
    'Compress per the system prompt rules. Output ONLY the JSON object.',
  ].filter(Boolean).join('\n');
}

const REWRITE_RETRIES = 3;

async function rewriteOne(
  orig: Question,
  provider: ChatProviderName,
): Promise<OffenderRewrite> {
  const chat = getChatProvider(provider);
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt < REWRITE_RETRIES; attempt += 1) {
    try {
      const result = await chat.generate(SYSTEM_PROMPT, buildUserPrompt(orig), {
        maxTokens: 4096,
        temperature: 0.3,
        jsonMode: true,
      });
      // Tolerate ```json fences and surrounding prose.
      const stripped = result.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      const m = stripped.match(/\{[\s\S]*\}/);
      if (!m) throw new Error(`No JSON object in rewrite response: ${result.content.slice(0, 200)}`);
      const raw = JSON.parse(m[0]);
      const merged = {
        // Carry through original fixed metadata from the pool entry —
        // the AI only owns question/answers/correctIndex/explanation.
        category: orig.category,
        subcategory: orig.subcategory,
        archetype: orig.archetype,
        difficulty: orig.difficulty,
        tags: orig.tags,
        ...raw,
      };
      const parsed = GeneratedQuestionSchema.parse(merged);
      return { id: orig.id, rewrite: parsed };
    } catch (err) {
      lastErr = err as Error;
    }
  }
  return { id: orig.id, rewrite: null, rewriteError: lastErr?.message ?? 'unknown' };
}

/**
 * Construct a Question record from a successful GeneratedQuestion rewrite,
 * carrying through all of the original pool entry's metadata except the
 * AI-owned text fields. The result is what gets fed into quality + verify +
 * embed and ultimately written back into the pool.
 */
function applyRewrite(orig: Question, rewrite: GeneratedQuestion, model: string, providerName: ChatProviderName): Question {
  return QuestionSchema.parse({
    ...orig,
    question: rewrite.question,
    answers: rewrite.answers,
    correctIndex: rewrite.correctIndex,
    explanation: rewrite.explanation,
    // Provider stamps reflect the REWRITE, not the original generation.
    generationProvider: providerName,
    generationModel: model,
    generatedAt: new Date().toISOString(),
    // Wipe pipeline-stage stamps — the rewrite goes through them fresh.
    qualityProvider: undefined,
    qualityAssessment: undefined,
    qualityStatus: undefined,
    verificationProvider: undefined,
    verificationStatus: undefined,
    sourceLink: undefined,
    embedding: undefined,
    embeddingProvider: undefined,
  });
}

export async function rewriteMobile(opts: RewriteMobileOptions = {}): Promise<RewriteMobileResult> {
  const poolPath = opts.poolPath ?? path.join(DATA_DIR, 'finalized-pool.jsonl');
  const qMax = opts.qMax ?? 150;
  const aMax = opts.aMax ?? 60;
  const provider = opts.provider ?? 'deepseek';
  const ts = todayStamp() + '-' + new Date().toISOString().slice(11, 19).replace(/:/g, '-');
  const workDir = opts.workDir ?? path.join(DATA_DIR, 'rewrite-mobile', ts);
  await mkdir(workDir, { recursive: true });

  const logPath = path.join(workDir, 'rewrite-log.jsonl');
  const startCost = costLogger.total();

  // ----- 1. Load pool, identify offenders -----
  const spinner = ora(`Scanning ${poolPath} for offenders (Q>${qMax} OR any A>${aMax})...`).start();
  const allEntries: Question[] = [];
  let parseFailures = 0;
  for await (const q of readJsonl<Question>(poolPath)) {
    try {
      allEntries.push(QuestionSchema.parse(q));
    } catch {
      // Existing pool may have entries that don't strictly parse; pass them
      // through as-is (we never modify those).
      allEntries.push(q);
      parseFailures += 1;
    }
  }
  const offenders = allEntries.filter((q) => isOffender(q, qMax, aMax));
  const limited = opts.limit != null ? offenders.slice(0, opts.limit) : offenders;
  spinner.succeed(
    `Pool: ${allEntries.length} entries. Offenders: ${offenders.length}. Processing ${limited.length}` +
      (parseFailures ? ` (${parseFailures} pool entries failed strict parse but kept as-is)` : ''),
  );

  if (limited.length === 0) {
    return {
      totalOffenders: 0,
      rewritten: 0,
      dropped: 0,
      failuresByStage: { rewriteSchema: 0, quality: 0, verify: 0, embed: 0 },
      workDir,
      poolBefore: allEntries.length,
      poolAfter: allEntries.length,
      costUsd: 0,
    };
  }

  await writeFile(path.join(workDir, 'offenders.jsonl'), limited.map((q) => JSON.stringify(q)).join('\n') + '\n', 'utf8');

  // ----- 2. AI rewrite (concurrency-capped) -----
  spinner.start(`Rewriting ${limited.length} offenders via ${provider}...`);
  const rewriteLimit = pLimit(4);
  const rewriteResults: OffenderRewrite[] = await Promise.all(
    limited.map((q) => rewriteLimit(() => rewriteOne(q, provider))),
  );
  const rewriteSchemaFails = rewriteResults.filter((r) => r.rewrite === null).length;
  spinner.succeed(`Rewrite stage: ${rewriteResults.length - rewriteSchemaFails} succeeded, ${rewriteSchemaFails} failed schema across retries`);

  // Log per-offender outcome so far.
  for (const r of rewriteResults) {
    await appendFile(logPath, JSON.stringify({
      ts: new Date().toISOString(),
      stage: 'rewrite',
      offenderId: r.id,
      success: r.rewrite !== null,
      error: r.rewriteError,
    }) + '\n', 'utf8');
  }

  // Materialize the successful rewrites as full Question records (carrying
  // metadata from originals) into rewrites.jsonl.
  const origById = new Map(limited.map((q) => [q.id, q]));
  const chatModel = getChatProvider(provider);
  // The provider's model name is a function — call it to capture for stamps.
  const providerEntry = (await import('./providers/factory.js')).getChatProviderEntry(provider);
  const modelId = providerEntry?.configuredModel?.() ?? 'unknown';
  void chatModel; // referenced for side effect of pricing setup

  const candidatesPath = path.join(workDir, 'rewrites.jsonl');
  const candWriter = await JsonlWriter.open(candidatesPath);
  const candidateIds: string[] = [];
  for (const r of rewriteResults) {
    if (!r.rewrite) continue;
    const orig = origById.get(r.id)!;
    const candidate = applyRewrite(orig, r.rewrite, modelId, provider);
    await candWriter.write(candidate);
    candidateIds.push(candidate.id);
  }
  await candWriter.close();

  if (candidateIds.length === 0) {
    spinner.warn('No rewrites passed schema. Dropping all offenders.');
    // Apply pool update: drop all offender ids
    return await applyPoolUpdate(allEntries, new Set(limited.map((q) => q.id)), new Map(), poolPath, workDir, {
      totalOffenders: limited.length,
      rewritten: 0,
      dropped: limited.length,
      failuresByStage: { rewriteSchema: rewriteSchemaFails, quality: 0, verify: 0, embed: 0 },
      workDir,
      poolBefore: allEntries.length,
      poolAfter: 0, // filled in below
      costUsd: 0, // filled in below
    }, opts.dryRun);
  }

  // ----- 3. Quality stage -----
  const qualityKeepPath = path.join(workDir, 'quality-keep.jsonl');
  spinner.start(`Quality-checking ${candidateIds.length} rewrites...`);
  const qualityResult = await checkQuality({
    inputPath: candidatesPath,
    outputPath: path.join(workDir, 'quality.jsonl'),
    keepPath: qualityKeepPath,
    reviewPath: path.join(workDir, 'quality-review.jsonl'),
    rejectPath: path.join(workDir, 'quality-reject.jsonl'),
  });
  spinner.succeed(`Quality: keep ${qualityResult.decisionCounts.keep}, review ${qualityResult.decisionCounts.review}, reject ${qualityResult.decisionCounts.reject}`);

  // ----- 4. Verify stage -----
  spinner.start(`Verifying ${qualityResult.decisionCounts.keep} quality-passed rewrites...`);
  const verifiedPath = path.join(workDir, 'verified.jsonl');
  if (qualityResult.decisionCounts.keep > 0) {
    await verifyQuestions({
      inputPath: qualityKeepPath,
      outputPath: verifiedPath,
      reviewQueuePath: path.join(workDir, 'verify-failed.jsonl'),
    });
  } else {
    // Empty file so downstream code doesn't blow up.
    await writeFile(verifiedPath, '', 'utf8');
  }
  // Filter to only verify-passed
  const verifyPassedPath = path.join(workDir, 'verify-passed.jsonl');
  const vw = await JsonlWriter.open(verifyPassedPath);
  let verifyPassedCount = 0;
  let verifyFailedCount = 0;
  if (existsSync(verifiedPath)) {
    for await (const q of readJsonl<Question>(verifiedPath)) {
      if (q.verificationStatus === 'passed') {
        await vw.write(q);
        verifyPassedCount += 1;
      } else {
        verifyFailedCount += 1;
      }
    }
  }
  await vw.close();
  spinner.succeed(`Verify: passed ${verifyPassedCount}, failed ${verifyFailedCount}`);

  // ----- 5. Embed stage -----
  let embedPath = path.join(workDir, 'embedded.jsonl');
  let embeddedCount = 0;
  if (verifyPassedCount > 0) {
    spinner.start(`Embedding ${verifyPassedCount} verify-passed rewrites...`);
    const er = await embedQuestions({ inputPath: verifyPassedPath, outputPath: embedPath });
    embeddedCount = er.embedded;
    spinner.succeed(`Embed: ${embeddedCount} embedded`);
  } else {
    await writeFile(embedPath, '', 'utf8');
  }

  // ----- 6. Build successful-rewrite map -----
  const successByOffenderId = new Map<string, Question>();
  if (existsSync(embedPath)) {
    for await (const q of readJsonl<Question>(embedPath)) {
      successByOffenderId.set(q.id, q);
    }
  }

  const offenderIds = new Set(limited.map((q) => q.id));
  const failuresByStage = {
    rewriteSchema: rewriteSchemaFails,
    quality: qualityResult.decisionCounts.reject + qualityResult.decisionCounts.review,
    verify: verifyFailedCount,
    embed: verifyPassedCount - embeddedCount,
  };
  const droppedCount = offenderIds.size - successByOffenderId.size;

  const endCost = costLogger.total();
  return await applyPoolUpdate(
    allEntries,
    offenderIds,
    successByOffenderId,
    poolPath,
    workDir,
    {
      totalOffenders: limited.length,
      rewritten: successByOffenderId.size,
      dropped: droppedCount,
      failuresByStage,
      workDir,
      poolBefore: allEntries.length,
      poolAfter: 0,
      costUsd: endCost - startCost,
    },
    opts.dryRun,
  );
}

async function applyPoolUpdate(
  allEntries: Question[],
  offenderIds: Set<string>,
  successByOffenderId: Map<string, Question>,
  poolPath: string,
  workDir: string,
  partial: RewriteMobileResult,
  dryRun?: boolean,
): Promise<RewriteMobileResult> {
  // Build the new pool: replace offenders that have a successful rewrite,
  // drop offenders that don't, keep everything else as-is.
  const newPool: Question[] = [];
  for (const q of allEntries) {
    if (!offenderIds.has(q.id)) {
      newPool.push(q);
      continue;
    }
    const success = successByOffenderId.get(q.id);
    if (success) newPool.push(success);
    // else: dropped — neither original nor failed rewrite goes into new pool
  }

  const result: RewriteMobileResult = { ...partial, poolAfter: newPool.length };

  if (dryRun) {
    await writeFile(
      path.join(workDir, 'pool-after-DRY-RUN.jsonl'),
      newPool.map((q) => JSON.stringify(q)).join('\n') + '\n',
      'utf8',
    );
    return result;
  }

  // Atomic update with .bak backup.
  const bakPath = poolPath + '.bak';
  await copyFile(poolPath, bakPath);
  const tmpPath = poolPath + '.tmp';
  await writeFile(tmpPath, newPool.map((q) => JSON.stringify(q)).join('\n') + '\n', 'utf8');
  await rename(tmpPath, poolPath);

  return result;
}
