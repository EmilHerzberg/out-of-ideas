import path from 'node:path';
import { existsSync } from 'node:fs';
import { copyFile, readFile, writeFile, mkdir } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { DATA_DIR, PROJECT_ROOT } from '../config.js';
import { readJsonlAll, todayStamp } from '../utils/jsonl.js';
import type { Question } from '../schema.js';

const execAsync = promisify(exec);

/**
 * IQY-44: Open the local HTML review tool, prepopulated with the enriched
 * + dedup data. Reviewer marks decisions in the browser; decisions persist in
 * localStorage and can be exported as JSON, which this CLI then merges into
 * the final approved JSONL.
 *
 * Two subcommands:
 *   review --input <enriched.jsonl> [--clusters <clusters.json>]
 *     -> generates web/review-data.json from the inputs and opens review.html
 *
 *   review-finalize --input <enriched.jsonl> --decisions <decisions.json>
 *     -> reads the decisions exported from the browser, applies them to the
 *        enriched JSONL, writes questions-final-{date}.jsonl
 */

export interface ReviewPrepareOptions {
  enrichedPath: string;
  clustersPath?: string;
  outputDataPath?: string;
  open?: boolean;
}

export async function prepareReview(opts: ReviewPrepareOptions): Promise<{
  dataPath: string;
  htmlPath: string;
}> {
  const enriched = await readJsonlAll<Question>(opts.enrichedPath);
  let clusters: { records: Array<{ questionId: string; decision: string; matches: any[] }> } | undefined;
  if (opts.clustersPath && existsSync(opts.clustersPath)) {
    clusters = JSON.parse(await readFile(opts.clustersPath, 'utf8'));
  }

  const webDir = path.join(PROJECT_ROOT, 'web');
  await mkdir(webDir, { recursive: true });
  const dataPath = opts.outputDataPath ?? path.join(webDir, 'review-data.json');
  const htmlPath = path.join(webDir, 'review.html');

  // 10% random sample (deterministic seed: 42)
  const sampleSize = Math.max(50, Math.floor(enriched.length * 0.1));
  const rng = mulberry32(42);
  const shuffled = [...enriched].sort(() => rng() - 0.5);
  const sample = shuffled.slice(0, sampleSize).map((q) => q.id);

  // All flagged dedup pairs (≥0.85) and all 'broken' or 'unsalvageable' from enrichment.
  const flaggedFromDedup = new Set<string>(
    (clusters?.records ?? [])
      .filter((r) => r.decision === 'auto_reject' || r.decision === 'reject_log' || r.decision === 'flag_review')
      .map((r) => r.questionId),
  );
  const flaggedFromQuality = enriched
    .filter((q) => q.qualityRating === 'broken' || q.archetype === 'unsalvageable')
    .map((q) => q.id);

  const reviewIds = new Set<string>([...sample, ...flaggedFromDedup, ...flaggedFromQuality]);
  const reviewQuestions = enriched.filter((q) => reviewIds.has(q.id));

  await writeFile(
    dataPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalEnriched: enriched.length,
        toReview: reviewQuestions.length,
        sampleSize,
        flaggedDedupCount: flaggedFromDedup.size,
        flaggedQualityCount: flaggedFromQuality.length,
        questions: reviewQuestions,
        dedupClusters: clusters?.records ?? [],
      },
      null,
      2,
    ),
    'utf8',
  );

  if (opts.open) {
    const url = `file:///${htmlPath.replace(/\\/g, '/')}`;
    process.stderr.write(`Opening reviewer in default browser: ${url}\n`);
    try {
      if (process.platform === 'win32') {
        await execAsync(`start "" "${htmlPath}"`);
      } else if (process.platform === 'darwin') {
        await execAsync(`open "${htmlPath}"`);
      } else {
        await execAsync(`xdg-open "${htmlPath}"`);
      }
    } catch (err) {
      process.stderr.write(`Could not auto-open. Open manually: ${url}\n`);
    }
  } else {
    const url = `file:///${htmlPath.replace(/\\/g, '/')}`;
    console.log(`Review data prepared. Open in browser: ${url}`);
  }

  return { dataPath, htmlPath };
}

/**
 * Apply browser-exported decisions to the enriched JSONL → produces final JSONL.
 * Enforces the no-delete rule: any 'reject' decision is converted to
 * keepWithLowPriority=true, never removed.
 */
export interface FinalizeOptions {
  enrichedPath: string;
  decisionsPath: string;
  outputPath?: string;
}

export async function finalizeReview(opts: FinalizeOptions): Promise<{
  outputPath: string;
  totalKept: number;
  flaggedLowPriority: number;
  editorialQueueSize: number;
}> {
  const enriched = await readJsonlAll<Question>(opts.enrichedPath);
  const decisionsRaw = await readFile(opts.decisionsPath, 'utf8');
  const decisions: Record<
    string,
    { decision: 'approve' | 'low_priority' | 'editorial_rewrite'; note?: string }
  > = JSON.parse(decisionsRaw);

  const outputPath =
    opts.outputPath ?? path.join(DATA_DIR, `questions-final-${todayStamp()}.jsonl`);
  const editorialQueuePath = path.join(DATA_DIR, `editorial-queue-${todayStamp()}.jsonl`);

  // Stream-write
  const { JsonlWriter } = await import('../utils/jsonl.js');
  const finalWriter = await JsonlWriter.open(outputPath);
  const editorialWriter = await JsonlWriter.open(editorialQueuePath);

  let totalKept = 0;
  let flaggedLowPriority = 0;
  let editorialQueueSize = 0;

  for (const q of enriched) {
    const decision = decisions[q.id];
    if (!decision) {
      // Default: keep as-is. (Anything not explicitly reviewed is implicitly approved.)
      await finalWriter.write(q);
      totalKept += 1;
      continue;
    }
    if (decision.decision === 'approve') {
      await finalWriter.write(q);
      totalKept += 1;
    } else if (decision.decision === 'low_priority') {
      const flagged: Question = {
        ...q,
        keepWithLowPriority: true,
        qualityRating: 'low_priority',
      };
      await finalWriter.write(flagged);
      totalKept += 1;
      flaggedLowPriority += 1;
    } else if (decision.decision === 'editorial_rewrite') {
      // Still kept in final, but also added to the editorial queue for future rewrite.
      const flagged: Question = {
        ...q,
        keepWithLowPriority: true,
        qualityRating: 'low_priority',
      };
      await finalWriter.write(flagged);
      await editorialWriter.write({ ...q, reviewerNote: decision.note ?? '' });
      totalKept += 1;
      flaggedLowPriority += 1;
      editorialQueueSize += 1;
    }
  }

  await finalWriter.close();
  await editorialWriter.close();

  console.log(
    `Finalize complete. ${totalKept} kept (${flaggedLowPriority} flagged low_priority, ${editorialQueueSize} in editorial queue) → ${outputPath}`,
  );

  return {
    outputPath,
    totalKept,
    flaggedLowPriority,
    editorialQueueSize,
  };
}

/** Deterministic PRNG so the random sample is reproducible across runs. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
