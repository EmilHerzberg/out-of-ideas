import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import ora from 'ora';
import { DATA_DIR } from './config.js';
import { readJsonlAll, todayStamp } from './utils/jsonl.js';
import { loadSeeds, saveSeeds, SEEDS_PATH } from './seeds.js';
import { getChatProvider } from './providers/factory.js';
import type { ChatProviderName } from './providers/types.js';
import type { Question, Seed } from './schema.js';

/**
 * Minimum questions assessed for a seed before evolver may take ANY action
 * on it (demote, ban, propose new seeds adjacent to it). Below this floor
 * we still compute stats for visibility, but never mutate state — too few
 * data points to trust the signal.
 */
// Lowered from 20 to 12 (2026-05-01) so the evolver actually fires during
// moderate-sized auto-generate runs. At 20 only 2 of 40 seeds crossed the
// floor in run 9 (455 questions across 81 batches); at 12 we'd expect ~10–15
// seeds to cross the floor at a similar scale, giving the evolver enough
// per-seed signal to act without firing on truly tiny samples.
export const MIN_QUESTIONS_BEFORE_ACTION = 12;

/**
 * Reject-rate threshold for demotion. Only applied to seeds whose
 * `questionsAssessed >= MIN_QUESTIONS_BEFORE_ACTION`.
 */
const DEMOTE_REJECT_RATE = 0.5;

/**
 * Sampling-weight floor / ceiling. Applied during performance-based weight
 * rebalancing so a single bad batch can't permanently zero a seed and a
 * single great batch can't dominate the sampler.
 */
const WEIGHT_MIN = 0.2;
const WEIGHT_MAX = 3.0;

export interface EvolveOptions {
  /** quality-checked-*.jsonl produced by the `quality` step. */
  qualityInputPath: string;
  /** dedup-clusters-*.json produced by the `dedup` step. Optional but recommended. */
  clustersInputPath?: string;
  /** Where to write a human-readable summary report (JSON). */
  reportOutputPath?: string;
  /**
   * Where to write proposed-but-not-applied new seeds for human review.
   * The evolver NEVER auto-adds to seeds.jsonl — it only proposes.
   */
  proposalsOutputPath?: string;
  /** Provider for proposing new seeds (cheap chat model). Default: deepseek. */
  proposalProvider?: ChatProviderName;
  /** Skip auto-proposal entirely (only update stats + demote). */
  skipProposals?: boolean;
}

interface ProviderBreakdown {
  provider: string;
  model: string | null;
  questionsAssessed: number;
  avgFunScore: number | null;
  avgQualityScore: number | null;
  avgLearningValue: number | null;
  rejectRate: number | null;
  duplicatePairsProduced: number;
  saturationFlag: boolean;
}

interface SeedReport {
  id: string;
  category: string;
  topic: string;
  status: Seed['status'];
  questionsAssessed: number;
  belowFloor: boolean;
  avgFunScore: number | null;
  avgQualityScore: number | null;
  avgLearningValue: number | null;
  rejectRate: number | null;
  duplicatePairsProduced: number;
  actionTaken: 'demoted' | 'already-demoted' | 'kept-active' | 'no-action-below-floor';
  proposalsRequested: boolean;
  /** Per-provider breakdown of the same metrics — surfaces "Gemini exhausted
   *  but Claude still fresh on this seed" without changing the seed schema. */
  byProvider: ProviderBreakdown[];
}

export async function evolveSeeds(opts: EvolveOptions): Promise<{
  reportPath: string;
  proposalsPath: string | null;
  demoted: number;
  proposed: number;
}> {
  const spinner = ora('Loading seeds + assessed questions + clusters...').start();

  const seeds = await loadSeeds();
  if (seeds.length === 0) {
    spinner.fail('No seeds loaded — nothing to evolve.');
    throw new Error('seeds.jsonl is empty or missing');
  }

  const questions = await readJsonlAll<Question>(opts.qualityInputPath);

  // Cluster lookup: questionId -> list of other questions it clustered with.
  const clusterPairs = new Map<string, Set<string>>();
  if (opts.clustersInputPath) {
    const clustersRaw = await readJsonlAll<unknown>(opts.clustersInputPath).catch(() => []);
    // The dedup output is a single JSON object, not jsonl — read it directly.
    try {
      const fs = await import('node:fs/promises');
      const text = await fs.readFile(opts.clustersInputPath, 'utf8');
      const parsed = JSON.parse(text) as {
        records: Array<{
          questionId: string;
          decision: string;
          matches: Array<{ otherId: string; similarity: number }>;
        }>;
      };
      for (const r of parsed.records) {
        if (
          r.decision === 'auto_reject' ||
          r.decision === 'reject_log' ||
          r.decision === 'flag_review' ||
          r.decision === 'related'
        ) {
          for (const m of r.matches) {
            if (!clusterPairs.has(r.questionId)) clusterPairs.set(r.questionId, new Set());
            clusterPairs.get(r.questionId)!.add(m.otherId);
          }
        }
      }
    } catch {
      // ignore — clusters file optional and may not be JSON
    }
    void clustersRaw;
  }

  // Bucket questions by seedId.
  const bySeed = new Map<string, Question[]>();
  let unattributed = 0;
  for (const q of questions) {
    if (!q.seedId) {
      unattributed += 1;
      continue;
    }
    if (!bySeed.has(q.seedId)) bySeed.set(q.seedId, []);
    bySeed.get(q.seedId)!.push(q);
  }

  spinner.text = `Computing stats for ${seeds.length} seeds across ${questions.length - unattributed} attributed questions (${unattributed} pre-seed, skipped)...`;

  const reports: SeedReport[] = [];
  let demotedCount = 0;

  for (const seed of seeds) {
    const seedQs = bySeed.get(seed.id) ?? [];
    const assessed = seedQs.filter((q) => q.qualityAssessment !== undefined);

    let avgFun: number | null = null;
    let avgQual: number | null = null;
    let avgLearn: number | null = null;
    let rejectRate: number | null = null;

    if (assessed.length > 0) {
      const sumFun = assessed.reduce((acc, q) => acc + (q.qualityAssessment!.funScore ?? 0), 0);
      const sumQual = assessed.reduce((acc, q) => acc + (q.qualityAssessment!.qualityScore ?? 0), 0);
      const sumLearn = assessed.reduce(
        (acc, q) => acc + (q.qualityAssessment!.learningValue ?? 0),
        0,
      );
      avgFun = sumFun / assessed.length;
      avgQual = sumQual / assessed.length;
      avgLearn = sumLearn / assessed.length;
      const rejected = assessed.filter((q) => q.qualityStatus === 'reject').length;
      rejectRate = rejected / assessed.length;
    }

    let dupPairs = 0;
    for (const q of seedQs) {
      const others = clusterPairs.get(q.id);
      if (others && others.size > 0) dupPairs += 1;
    }

    seed.stats.questionsAssessed = assessed.length;
    seed.stats.avgFunScore = avgFun;
    seed.stats.avgQualityScore = avgQual;
    seed.stats.avgLearningValue = avgLearn;
    seed.stats.rejectRate = rejectRate;
    seed.stats.duplicatePairsProduced = dupPairs;

    let actionTaken: SeedReport['actionTaken'] = 'kept-active';
    const belowFloor = assessed.length < MIN_QUESTIONS_BEFORE_ACTION;
    const wasAlreadyDemoted = seed.status === 'demoted';

    if (belowFloor) {
      actionTaken = 'no-action-below-floor';
    } else if (rejectRate !== null && rejectRate >= DEMOTE_REJECT_RATE && seed.status === 'active') {
      seed.status = 'demoted';
      actionTaken = 'demoted';
      demotedCount += 1;
    } else if (wasAlreadyDemoted) {
      // Distinct from `kept-active` — a demoted seed isn't "kept active",
      // it stays excluded from the sampler. Surfacing this separately so
      // operators don't think the seed is fine just because no NEW action
      // happened on this evolve pass.
      actionTaken = 'already-demoted';
    } else if (seed.status === 'active' && avgFun !== null && rejectRate !== null) {
      // Performance-based weight rebalancing — only above the data-floor.
      // Boost seeds producing fun, low-reject content; throttle weak ones.
      let newWeight = seed.weight;
      if (avgFun >= 4.0 && rejectRate <= 0.1) newWeight *= 1.3;
      else if (avgFun >= 3.5 && rejectRate <= 0.2) newWeight *= 1.1;
      else if (avgFun < 2.5 || rejectRate >= 0.3) newWeight *= 0.7;
      // Penalize seeds producing many duplicates.
      if (dupPairs >= 5) newWeight *= 0.8;
      newWeight = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, newWeight));
      seed.weight = Number(newWeight.toFixed(3));
    }

    // ----- Per-provider breakdown -----------------------------------------
    const byProvider = computeProviderBreakdown(seedQs, clusterPairs);

    reports.push({
      id: seed.id,
      category: seed.category,
      topic: seed.topic,
      status: seed.status,
      questionsAssessed: assessed.length,
      belowFloor,
      avgFunScore: avgFun,
      avgQualityScore: avgQual,
      avgLearningValue: avgLearn,
      rejectRate,
      duplicatePairsProduced: dupPairs,
      actionTaken,
      proposalsRequested: false,
      byProvider,
    });
  }

  // Save updated seeds (stats + any demotions).
  await saveSeeds(seeds);

  // ----- Proposals (gated on per-seed >=20 assessed) ----------------------
  let proposalsPath: string | null = null;
  let proposed = 0;
  if (!opts.skipProposals) {
    const candidatesForProposal = reports.filter(
      (r) =>
        !r.belowFloor &&
        (r.duplicatePairsProduced > 5 || (r.avgFunScore !== null && r.avgFunScore < 3.5)),
    );

    if (candidatesForProposal.length > 0) {
      spinner.text = `Proposing new seeds adjacent to ${candidatesForProposal.length} struggling seed(s)...`;
      const provider = getChatProvider(opts.proposalProvider ?? 'deepseek');
      const proposals: Array<{ adjacentTo: string; suggested: unknown }> = [];

      for (const r of candidatesForProposal) {
        const seed = seeds.find((s) => s.id === r.id)!;
        const seedQuestions = (bySeed.get(seed.id) ?? []).slice(0, 20);
        try {
          const suggestion = await proposeAdjacentSeeds(provider, seed, seeds, seedQuestions);
          proposals.push({ adjacentTo: seed.id, suggested: suggestion });
          const reportEntry = reports.find((x) => x.id === seed.id);
          if (reportEntry) reportEntry.proposalsRequested = true;
          proposed += 1;
        } catch (err) {
          process.stderr.write(
            `\n[propose ${seed.id}] failed: ${(err as Error).message}\n`,
          );
        }
      }

      proposalsPath =
        opts.proposalsOutputPath ??
        path.join(DATA_DIR, `seeds-proposed-${todayStamp()}.json`);
      await writeFile(proposalsPath, JSON.stringify({ proposals }, null, 2), 'utf8');
    }
  }

  // ----- Report ------------------------------------------------------------
  const reportPath =
    opts.reportOutputPath ?? path.join(DATA_DIR, `seed-report-${todayStamp()}.json`);
  const summary = {
    seedsPath: SEEDS_PATH,
    minQuestionsBeforeAction: MIN_QUESTIONS_BEFORE_ACTION,
    demoteRejectRateThreshold: DEMOTE_REJECT_RATE,
    totals: {
      seeds: seeds.length,
      attributedQuestions: questions.length - unattributed,
      unattributedQuestions: unattributed,
      seedsBelowFloor: reports.filter((r) => r.belowFloor).length,
      seedsAboveFloor: reports.filter((r) => !r.belowFloor).length,
      seedsDemotedThisRun: demotedCount,
      proposalRequests: proposed,
    },
    reports: reports.sort(
      (a, b) =>
        Number(a.belowFloor) - Number(b.belowFloor) ||
        (b.questionsAssessed ?? 0) - (a.questionsAssessed ?? 0),
    ),
  };
  await writeFile(reportPath, JSON.stringify(summary, null, 2), 'utf8');

  spinner.succeed(
    `Evolve complete. Demoted ${demotedCount}, proposals requested for ${proposed} seed(s). ` +
      `Report → ${reportPath}` +
      (proposalsPath ? `\n  proposals → ${proposalsPath}` : ''),
  );

  return {
    reportPath,
    proposalsPath,
    demoted: demotedCount,
    proposed,
  };
}

/**
 * Group a seed's questions by (provider, model) and compute the same metrics
 * per group. Lets the operator see e.g. "google + gemini-3.1-pro saturated this
 * seed but anthropic + claude-opus-4-7 still has headroom" — the cross-provider
 * exhaustion signal — without changing the seed schema.
 *
 * `saturationFlag` fires when a provider has produced ≥10 questions on this
 * seed AND its rejectRate ≥ 0.5 OR duplicatePairsProduced ≥ 5. That's the
 * signal to switch providers manually.
 */
function computeProviderBreakdown(
  seedQuestions: Question[],
  clusterPairs: Map<string, Set<string>>,
): ProviderBreakdown[] {
  const groups = new Map<string, Question[]>();
  for (const q of seedQuestions) {
    const key = `${q.generationProvider ?? 'unknown'}|${q.generationModel ?? 'unknown'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(q);
  }

  const out: ProviderBreakdown[] = [];
  for (const [key, qs] of groups.entries()) {
    const [provider, model] = key.split('|');
    const assessed = qs.filter((q) => q.qualityAssessment !== undefined);
    let avgFun: number | null = null;
    let avgQual: number | null = null;
    let avgLearn: number | null = null;
    let rejectRate: number | null = null;
    if (assessed.length > 0) {
      avgFun = assessed.reduce((a, q) => a + (q.qualityAssessment!.funScore ?? 0), 0) / assessed.length;
      avgQual = assessed.reduce((a, q) => a + (q.qualityAssessment!.qualityScore ?? 0), 0) / assessed.length;
      avgLearn = assessed.reduce((a, q) => a + (q.qualityAssessment!.learningValue ?? 0), 0) / assessed.length;
      rejectRate = assessed.filter((q) => q.qualityStatus === 'reject').length / assessed.length;
    }
    let dupPairs = 0;
    for (const q of qs) {
      if (clusterPairs.get(q.id)?.size) dupPairs += 1;
    }
    const saturationFlag =
      assessed.length >= 10 &&
      ((rejectRate !== null && rejectRate >= 0.5) || dupPairs >= 5);

    out.push({
      provider,
      model: model === 'unknown' ? null : model,
      questionsAssessed: assessed.length,
      avgFunScore: avgFun,
      avgQualityScore: avgQual,
      avgLearningValue: avgLearn,
      rejectRate,
      duplicatePairsProduced: dupPairs,
      saturationFlag,
    });
  }

  out.sort((a, b) => b.questionsAssessed - a.questionsAssessed);
  return out;
}

async function proposeAdjacentSeeds(
  provider: ReturnType<typeof getChatProvider>,
  seed: Seed,
  allSeeds: Seed[],
  recentQuestions: Question[],
): Promise<unknown> {
  const sameCategoryIds = allSeeds
    .filter((s) => s.category === seed.category)
    .map((s) => `${s.id} (${s.topic} — ${s.angle})`)
    .join('\n  ');
  const recent = recentQuestions
    .slice(0, 12)
    .map((q) => `- ${q.question}`)
    .join('\n');

  // Compute compatible archetypes for this seed's category, so the proposer
  // can shape exampleStems toward archetypes the orchestrator can actually
  // use. Without this, the verifier sometimes rejects seeds that pair with
  // no compatible archetype — wasted proposer call.
  const { ARCHETYPE_COMPATIBLE_CATEGORIES } = await import('./archetype-compatibility.js');
  const compatibleArchetypes: string[] = [];
  for (const [arch, cats] of Object.entries(ARCHETYPE_COMPATIBLE_CATEGORIES)) {
    if (cats.includes(seed.category)) compatibleArchetypes.push(arch);
  }

  const systemPrompt = `You are designing sub-topic seeds for a fun, general-knowledge mobile quiz game. Each seed defines a sub-topic + angle within a category, capped at general-knowledge level (no PhD/specialist content). You suggest NEW seeds adjacent to an existing one that has either run out of fresh angles or is producing duplicates. Avoid universal default-repertoire stems (popcorn / mortgage / Why-stars-twinkle / 10%-of-brain etc.) — see default-repertoire.txt; producing default-repertoire stems wastes proposer→verifier round-trips.`;

  const userPrompt = [
    `Existing seed:`,
    `  id: ${seed.id}`,
    `  category: ${seed.category}`,
    `  topic: ${seed.topic}`,
    `  angle: ${seed.angle}`,
    `  depthCap: ${seed.depthCap}`,
    `  bannedAngles: ${seed.bannedAngles.join(', ') || '(none)'}`,
    ``,
    `Compatible archetypes for category "${seed.category}" — your proposals should pair with at least one of these:`,
    `  ${compatibleArchetypes.join(', ')}`,
    ``,
    `Recent questions this seed produced (showing they're starting to repeat or score low):`,
    recent || '  (none)',
    ``,
    `Other seeds already in the same category — your proposals MUST NOT overlap with these:`,
    `  ${sameCategoryIds}`,
    ``,
    `Universal default-repertoire to avoid (the verifier downstream rejects these):`,
    `  popcorn-pop, sky-blue, sunsets-red, onions-cry, brain-freeze, yawn-contagion,`,
    `  Venus-vs-Mercury, stars-twinkle, ice-floats, leaves-color-autumn,`,
    `  10%-of-brain, Einstein-failed-math, swallow-spiders, goldfish-3-second,`,
    `  lemmings-suicide, Vikings-horned-helmets, Roman-vomitoriums,`,
    `  mortgage / panic / salary / sandwich / quarantine / OK / rule-of-thumb etymologies.`,
    ``,
    `Propose 3–5 NEW seeds in the same category and depthCap that:`,
    `- explore different angles than the existing seed and the other category seeds,`,
    `- stay STRICTLY at general-knowledge level (a smart 14-year-old can engage),`,
    `- produce fun "huh, no way" questions, not pure factual recall,`,
    `- include exampleStems each ≤150 chars (mobile UI hard cap),`,
    `- pair with at least one of the compatible archetypes listed above,`,
    `- include a bannedAngles list to keep generation away from specialist territory.`,
    ``,
    `Return ONLY a JSON array, no commentary:`,
    `[`,
    `  {`,
    `    "id": "<short snake_case unique id>",`,
    `    "category": "${seed.category}",`,
    `    "topic": "<sub-topic>",`,
    `    "angle": "<angle description, ≤200 chars>",`,
    `    "depthCap": "general-knowledge",`,
    `    "exampleStems": ["<stem ≤150c>", "<stem ≤150c>"],`,
    `    "bannedAngles": ["<thing 1>", "<thing 2>"]`,
    `  }`,
    `]`,
  ].join('\n');

  const result = await provider.generate(systemPrompt, userPrompt, {
    // 8192, not 1200 — Gemini 3.x is a thinking model and consumes a chunk
    // of the output budget on internal reasoning before any visible JSON
    // token appears. At 1200 the visible portion was being truncated mid-
    // string for every Gemini call (~36 visible tokens). 8192 matches the
    // seed-verifier's pattern and gives both thinking and JSON room. Other
    // providers ignore the headroom and only spend what they emit.
    maxTokens: 8192,
    temperature: 0.5,
    jsonMode: true,
  });
  const stripped = result.content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  // The model may wrap in `{ "proposals": [...] }` — be lenient.
  const jsonStart = stripped.search(/[\[{]/);
  if (jsonStart < 0) throw new Error('No JSON found in proposal response');
  const parsed = JSON.parse(stripped.slice(jsonStart));
  return Array.isArray(parsed) ? parsed : (parsed.proposals ?? parsed);
}
