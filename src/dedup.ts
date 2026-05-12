import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import ora from 'ora';
import { createHash } from 'node:crypto';
import { DATA_DIR } from './config.js';
import { readJsonlAll, todayStamp } from './utils/jsonl.js';
import { CosineAnnIndex } from './utils/hnsw-index.js';
import type { Question } from './schema.js';

export interface DedupOptions {
  inputPath: string;
  outputPath?: string;
  /** Optional path to an existing pool's embedded JSONL — query against this. */
  poolPath?: string;
  topK?: number;
}

const TOP_K_DEFAULT = 5;

// Thresholds (lowered from spec §11.5 to reduce human-review load and catch
// near-paraphrases that text-multilingual-embedding-002 scores conservatively).
const T_AUTO_REJECT = 0.84;
const T_REJECT_LOG = 0.80;
const T_FLAG_REVIEW = 0.75;
const T_RELATED = 0.65;

interface DedupRecord {
  questionId: string;
  question: string;
  decision: 'auto_reject' | 'reject_log' | 'flag_review' | 'related' | 'unique';
  matches: Array<{ otherId: string; similarity: number; otherQuestion: string }>;
  clusterId?: string;
}

export async function dedupQuestions(opts: DedupOptions): Promise<{
  outputPath: string;
  decisionCounts: Record<DedupRecord['decision'], number>;
}> {
  const spinner = ora('Loading embeddings...').start();

  const newQuestions = await readJsonlAll<Question>(opts.inputPath);
  if (newQuestions.length === 0) {
    spinner.fail('No questions in input');
    throw new Error(`No questions found in ${opts.inputPath}`);
  }

  const dim = newQuestions[0].embedding?.length ?? 0;
  if (dim === 0) {
    spinner.fail('Input questions have no embeddings — run embed step first');
    throw new Error('Embedding step required before dedup');
  }

  const poolQuestions = opts.poolPath
    ? await readJsonlAll<Question>(opts.poolPath)
    : [];
  const allForIndex = [...poolQuestions, ...newQuestions];

  spinner.text = `Building hnsw index for ${allForIndex.length} questions...`;
  const index = new CosineAnnIndex(dim, allForIndex.length);
  for (const q of allForIndex) {
    if (!q.embedding) continue;
    index.add(q.id, q.embedding);
  }

  // Build a lookup so we can show the matched question's text.
  const byId = new Map<string, Question>();
  for (const q of allForIndex) byId.set(q.id, q);

  spinner.text = 'Running dedup queries...';
  const records: DedupRecord[] = [];
  const decisionCounts: Record<DedupRecord['decision'], number> = {
    auto_reject: 0,
    reject_log: 0,
    flag_review: 0,
    related: 0,
    unique: 0,
  };

  for (const q of newQuestions) {
    if (!q.embedding) continue;
    const neighbors = index.searchKnn(q.embedding, opts.topK ?? TOP_K_DEFAULT, q.id);

    let decision: DedupRecord['decision'] = 'unique';
    let clusterId: string | undefined;
    const matches = neighbors.map((n) => ({
      otherId: n.externalId,
      similarity: Number(n.similarity.toFixed(4)),
      otherQuestion: byId.get(n.externalId)?.question ?? '<unknown>',
    }));

    const top = matches[0];
    if (top) {
      if (top.similarity >= T_AUTO_REJECT) {
        decision = 'auto_reject';
      } else if (top.similarity >= T_REJECT_LOG) {
        decision = 'reject_log';
      } else if (top.similarity >= T_FLAG_REVIEW) {
        decision = 'flag_review';
      } else if (top.similarity >= T_RELATED) {
        decision = 'related';
        // Deterministic cluster id: hash of (lower of the two ids).
        const seedId = top.otherId < q.id ? top.otherId : q.id;
        clusterId = `cluster_${createHash('sha1').update(seedId).digest('hex').slice(0, 12)}`;
      } else {
        decision = 'unique';
      }
    }

    records.push({
      questionId: q.id,
      question: q.question,
      decision,
      matches,
      clusterId,
    });
  }

  // ----- Survivor selection per auto-reject / reject-log cluster ----------
  // Without this pass, BOTH halves of a 0.95 pair end up rejected, dropping
  // good content. We group connected components of mutually-rejected pairs
  // and promote the highest-quality member of each cluster back to "unique".
  // Tiebreaker: lowest qualityScore-equal id, deterministic.
  promoteSurvivors(records, byId);

  // Recompute counts after survivor promotion.
  for (const r of records) decisionCounts[r.decision] += 1;

  const outputPath =
    opts.outputPath ?? path.join(DATA_DIR, `dedup-clusters-${todayStamp()}.json`);
  await writeFile(outputPath, JSON.stringify({ records, decisionCounts }, null, 2), 'utf8');

  spinner.succeed(
    `Dedup complete: ${decisionCounts.auto_reject} auto-reject, ${decisionCounts.reject_log} reject-log, ${decisionCounts.flag_review} flag-review, ${decisionCounts.related} related, ${decisionCounts.unique} unique → ${outputPath}`,
  );

  return { outputPath, decisionCounts };
}

/**
 * In-place: for each connected component of records mutually rejecting each
 * other, choose ONE survivor and flip it back to "unique" (with a clusterId
 * pointing to its rejected siblings). Losers stay auto_reject / reject_log.
 *
 * Selection order:
 *   1. highest qualityAssessment.qualityScore (if present)
 *   2. tie-break by lowest id (deterministic across runs)
 *
 * Pool questions (not in newQuestions) are NEVER promoted — they're
 * already finalised; new questions that match them stay rejected.
 */
function promoteSurvivors(
  records: DedupRecord[],
  byId: Map<string, import('./schema.js').Question>,
): void {
  const REJECTING = new Set<DedupRecord['decision']>(['auto_reject', 'reject_log']);
  const newIds = new Set(records.map((r) => r.questionId));
  const recordById = new Map(records.map((r) => [r.questionId, r]));

  // Union-Find over rejected new questions only.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let cur = x;
    while (parent.get(cur) !== cur) {
      parent.set(cur, parent.get(parent.get(cur)!)!);
      cur = parent.get(cur)!;
    }
    return cur;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const r of records) {
    if (!REJECTING.has(r.decision)) continue;
    if (!parent.has(r.questionId)) parent.set(r.questionId, r.questionId);
    for (const m of r.matches) {
      if (m.similarity < T_REJECT_LOG) break; // matches sorted desc
      if (!newIds.has(m.otherId)) continue; // skip pool members; they're finalised
      const otherRec = recordById.get(m.otherId);
      if (!otherRec || !REJECTING.has(otherRec.decision)) continue;
      if (!parent.has(m.otherId)) parent.set(m.otherId, m.otherId);
      union(r.questionId, m.otherId);
    }
  }

  // Group by root.
  const clusters = new Map<string, string[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(id);
  }

  // Helper: does this question already auto-reject against a POOL member?
  // If yes, it must NOT be promoted to a cluster survivor — pool members are
  // finalised and the new question is genuinely a duplicate of finalised work.
  const matchesPoolHardly = (id: string): boolean => {
    const rec = recordById.get(id);
    if (!rec) return false;
    return rec.matches.some(
      (m) => !newIds.has(m.otherId) && m.similarity >= T_AUTO_REJECT,
    );
  };

  // Promote one survivor per cluster of size ≥ 2.
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    // Cluster members that ALSO duplicate a pool member can't be saved by
    // being a within-batch winner — exclude them from the survivor pick.
    const eligible = members.filter((id) => !matchesPoolHardly(id));
    if (eligible.length === 0) continue; // entire cluster duplicates the pool
    const ranked = eligible
      .map((id) => ({
        id,
        quality: byId.get(id)?.qualityAssessment?.qualityScore ?? 0,
      }))
      .sort((a, b) => b.quality - a.quality || a.id.localeCompare(b.id));
    const survivorId = ranked[0].id;
    const survivor = recordById.get(survivorId)!;
    survivor.decision = 'unique';
    // Tag the survivor with a cluster id so downstream knows it had siblings.
    const seedId = members.slice().sort()[0];
    survivor.clusterId = `cluster_${createHash('sha1').update(seedId).digest('hex').slice(0, 12)}`;
  }
}
