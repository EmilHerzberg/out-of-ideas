import path from 'node:path';
import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import ora from 'ora';
import { DATA_DIR } from './config.js';
import { todayStamp, JsonlWriter, readJsonlAll } from './utils/jsonl.js';
import { generateQuestions } from './generator.js';
import { checkQuality } from './quality.js';
import { verifyQuestions } from './verifier.js';
import { embedQuestions } from './embedder.js';
import { dedupQuestions } from './dedup.js';
import { loadSeeds } from './seeds.js';
import { evolveSeeds } from './seed-evolver.js';
import { costLogger } from './cost-logger.js';
import { getActiveChatProviders } from './providers/factory.js';
import { isCompatible, compatibleCategories } from './archetype-compatibility.js';
import {
  loadProviderArchetypeStats,
  isCellAllowed,
  recordBatchOutcome,
  cellKey,
} from './provider-archetype-constraints.js';
import { Mutex } from './utils/mutex.js';
import type { Archetype, Question, Seed } from './schema.js';
import type { ChatProviderName } from './providers/types.js';

/**
 * Auto-generation orchestrator.
 *
 * Loops batches of (category × archetype × provider) until either the target
 * number of survivors lands in the pool, or the budget is spent. Within-run
 * saturation tracking rotates away from triples that are producing only
 * duplicates. Each batch writes a rich JSONL log entry for later analysis.
 *
 * Architecture choices:
 *   1. The orchestrator does NOT mutate seeds.jsonl beyond what `generate`
 *      already does (timesUsed/lastUsedAt updates). It does not auto-demote.
 *      That's the evolver's job, run between auto-generate sessions.
 *   2. Provider selection respects `getActiveChatProviders()` — providers
 *      without API keys are silently skipped.
 *   3. Within-run saturation is in-memory only. Cross-run saturation flags
 *      are managed by the evolver in `seeds.jsonl`.
 */

const DEFAULT_BATCH_SIZE = 8;
const DEFAULT_MAX_BATCHES = 200;
const SATURATION_CONSEC_ZERO = 2; // batches with zero survivors before flagging
const SATURATION_REJECT_RATE = 0.8;

/** Default archetype rotation order (skips counterfactual + spatial — handled separately per spec). */
const DEFAULT_ARCHETYPES: Archetype[] = [
  'cause_effect',
  'comparison',
  'misconception',
  'etymology',
  'estimation',
  'odd_one_out',
  'lateral_connection',
  'process_sequence',
  'vocab_context',
  'strategy',
];

export interface AutoGenerateOptions {
  /** Hard target — once the pool gains this many survivors, stop. */
  targetSurvivors: number;
  /** Hard cost cap (USD) across all stages. Stops when reached. */
  budgetUsd: number;
  /** Max batches to ever run, regardless of progress. Default 200. */
  maxBatches?: number;
  /** Questions per batch. Default 8. */
  batchSize?: number;
  /** Path to the running canonical pool. Default `data/finalized-pool.jsonl`. */
  poolPath?: string;
  /** Restrict to specific categories (default: all categories with active seeds). */
  categories?: string[];
  /** Restrict to specific archetypes (default: a sensible 10-archetype rotation). */
  archetypes?: Archetype[];
  /** Restrict to specific providers (default: all with credentials). */
  providers?: ChatProviderName[];
  /** Output directory for run logs + per-batch artifacts. Auto-created if missing. */
  logDir?: string;
  /** Trigger the seed-evolver every N batches (auto-runs demotions + weight
   *  rebalancing; new-seed proposals are written to a for-human-review file
   *  and never auto-merged). Default 30. Set to 0 to disable. */
  evolverTickEvery?: number;
  /**
   * Per-provider sampling weights — caps how often each provider is picked.
   * Defaults to equal weights (round-robin). Set this to throttle expensive
   * providers, e.g. `{ anthropic: 0.05, openai: 0.05, google: 0.45, deepseek: 0.45 }`
   * means anthropic + openai together get ~10% of batches.
   *
   * Weights are normalized at runtime; a value of 0 effectively excludes
   * the provider from the rotation. Within the surfacing of a triple, the
   * round-robin still cycles archetypes + categories — only provider
   * selection is weighted.
   */
  providerWeights?: Record<string, number>;
  /**
   * Run up to N batches concurrently, with a HARD INVARIANT that no two
   * concurrent batches use the same generator provider. Default 1 (sequential
   * — the original behaviour). Recommended max in production: 2-3.
   *
   * Why provider-uniqueness: if two concurrent batches happened to pick the
   * same provider, they'd double the per-provider rate-limit pressure and
   * risk 429s. Excluding in-flight providers from `nextTriple()`'s eligible
   * set keeps load-per-provider identical to the sequential mode.
   *
   * Critical sections (dedup + pool append + stats + log writes + evolver
   * tick) are serialised across batches via a shared mutex, so output
   * remains race-free. Stages BEFORE dedup (generate / quality / verify /
   * embed) run in parallel and provide most of the wallclock speedup.
   */
  concurrentBatches?: number;
  /**
   * A/B comparison: also assess every quality call through this alternate
   * DeepSeek model and store the result on `qualityAssessmentAlt`. The
   * primary `DEEPSEEK_QUALITY_MODEL` keeps executive decision power; the
   * alt is comparison-only. See `quality.ts:QualityCheckOptions.altModel`.
   *
   * Typical use: `--quality-alt-model deepseek-chat` (V4-Flash) while the
   * primary stays at `deepseek-v4-pro`, so the offline `quality-ab-report`
   * CLI can measure where flash diverges from pro.
   */
  qualityAltModel?: string;
  /**
   * Order in which (category, archetype) cells are visited during the
   * outer rotation:
   *
   * - `'sequential'` (default, recommended for testing) — alphabetical
   *   category × archetype order, fully deterministic. Re-running the
   *   same input produces the same triple sequence; results are
   *   reproducible across runs. **Use this for any test you want to
   *   compare against another test.**
   *
   * - `'random'` (recommended for production) — Fisher-Yates-shuffled
   *   (category, archetype) order at run start. Gives each cell a fair
   *   chance regardless of alphabetical position; particularly useful
   *   when total batches < total cells and the rotation would otherwise
   *   never reach categories late in the alphabet.
   *
   * The shuffle happens ONCE at run start (not per-cell), so any single
   * run still has a stable order — you just can't reproduce the order
   * across runs without seeding the RNG (intentional; prod runs aren't
   * meant to be reproducible).
   */
  rotation?: 'sequential' | 'random';
  /**
   * Targeted gap-filling mode. When set, the orchestrator IGNORES the normal
   * (category × archetype) outer rotation and instead targets specific
   * (provider × archetype) cells that have insufficient sample counts.
   *
   * Picks the cell with the LOWEST current `questionsAssessed` first
   * (frontload the most-needed cells), respects provider-uniqueness for
   * concurrent batches, and stops when every reachable cell has at least
   * `targetSamplesPerCell` assessed questions OR budget / max-batches
   * is hit.
   *
   * Each cell rotates through its compatible categories deterministically
   * (modulo current sample count) so repeated visits hit different
   * categories rather than re-hitting the same one.
   *
   * Used by the `fill-gaps` CLI command.
   */
  fillGaps?: {
    /** Target minimum `questionsAssessed` per (provider, model, archetype)
     *  cell. The orchestrator stops generating against a cell once it
     *  reaches this number. */
    targetSamplesPerCell: number;
  };
}

interface Triple {
  category: string;
  archetype: Archetype;
  provider: { name: ChatProviderName; configuredModel: () => string };
  key: string;
}

interface TripleStats {
  batches: number;
  questionsGenerated: number;
  survivors: number;
  totalCost: number;
  consecutiveZeroSurv: number;
}

interface BatchLog {
  ts: string;
  batchIdx: number;
  triple: { category: string; archetype: string; provider: string; model: string };
  generation: { requested: number; succeeded: number; parseFailures: number; cost: number };
  quality: { keep: number; review: number; reject: number; avgFun: number | null; avgQual: number | null; avgLearning: number | null; cost: number };
  verify: { passed: number; failed: number; cost: number };
  embed: { count: number; cost: number };
  dedup: { autoReject: number; rejectLog: number; flagReview: number; related: number; unique: number; vsPool: number; vsBatch: number };
  appended: number;
  cumulativeCost: number;
  cumulativeSurvivors: number;
  poolSizeAfter: number;
  durationMs: number;
  saturationFlagged?: string;
}

interface RunSummary {
  startedAt: string;
  endedAt: string;
  durationMs: number;
  config: AutoGenerateOptions;
  totals: {
    batchesRun: number;
    questionsGenerated: number;
    questionsSurvived: number;
    totalCost: number;
    poolSizeStart: number;
    poolSizeEnd: number;
  };
  stopReason: 'target_reached' | 'budget_exhausted' | 'max_batches' | 'all_saturated' | 'no_active_providers' | 'no_seeds' | 'generation_failing' | 'all_providers_disabled';
  /** Providers that were auto-disabled mid-run because they kept failing
   *  (out of credits, hard rate limit, invalid key). Only present when at
   *  least one provider tripped the per-provider failure threshold. */
  providersDisabledMidRun?: string[];
  perTripleStats: Record<string, TripleStats>;
}

export async function autoGenerate(opts: AutoGenerateOptions): Promise<RunSummary> {
  const startTime = Date.now();
  const startedAt = new Date(startTime).toISOString();

  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatches = opts.maxBatches ?? DEFAULT_MAX_BATCHES;
  const poolPath = opts.poolPath ?? path.join(DATA_DIR, 'finalized-pool.jsonl');
  const logDir = opts.logDir ?? path.join(DATA_DIR, 'auto-runs', startedAt.replace(/[:.]/g, '-'));
  await mkdir(logDir, { recursive: true });

  const logPath = path.join(logDir, 'run.log.jsonl');
  const summaryPath = path.join(logDir, 'summary.json');
  const qualityRollingPath = path.join(logDir, 'quality-rolling.jsonl');
  const dedupRecordsPath = path.join(logDir, 'dedup-records-rolling.jsonl');
  const evolverTicksDir = path.join(logDir, 'evolver-ticks');
  const evolverTickEvery = opts.evolverTickEvery ?? 30;

  // ----- Provider selection ----------------------------------------------
  const allActive = getActiveChatProviders();
  const requestedProviderNames = opts.providers ?? allActive.map((e) => e.name);
  const providers = allActive.filter((e) => requestedProviderNames.includes(e.name));

  if (providers.length === 0) {
    return finalizeEarly('no_active_providers');
  }

  // ----- Seed + category selection ---------------------------------------
  const seeds = await loadSeeds();
  const activeSeeds = seeds.filter((s) => s.status === 'active');
  if (activeSeeds.length === 0) {
    return finalizeEarly('no_seeds');
  }

  const seedsByCategory = new Map<string, Seed[]>();
  for (const s of activeSeeds) {
    if (!seedsByCategory.has(s.category)) seedsByCategory.set(s.category, []);
    seedsByCategory.get(s.category)!.push(s);
  }

  const allCategories = [...seedsByCategory.keys()];
  const categories = opts.categories ?? allCategories;
  const usableCategories = categories.filter((c) => seedsByCategory.has(c));
  if (usableCategories.length === 0) {
    return finalizeEarly('no_seeds');
  }

  const archetypes = opts.archetypes ?? DEFAULT_ARCHETYPES;

  // Load cross-run (provider, model, archetype) stats + auto-disable list.
  // The orchestrator references this in nextTriple() to skip blocked cells
  // and updates it after each batch via recordBatchOutcome().
  const providerArchetypeStats = await loadProviderArchetypeStats();

  // ----- State -----------------------------------------------------------
  const saturated = new Set<string>();
  const stats = new Map<string, TripleStats>();
  let cumulativeCost = 0;
  let cumulativeSurvivors = 0;
  let batchIdx = 0;
  let consecutiveZeroGenBatches = 0;
  const poolSizeStart = await countPool(poolPath);

  /**
   * Bail out after this many consecutive batches across ALL triples produce
   * 0 generated questions. This is a network / DNS / API-outage signal —
   * spinning further is just retry waste. Per-triple saturation is a
   * separate, slower signal handled below.
   */
  const NETWORK_FAILURE_THRESHOLD = 3;

  /**
   * Per-provider auto-disable Mode 1: if a SINGLE provider produces 0
   * generated questions for this many consecutive batches, mark it disabled
   * for the rest of the run (out of credits, rate-limited, invalid key).
   * Other providers keep running; the deficit picker redistributes its share.
   */
  const PROVIDER_DISABLE_THRESHOLD = 2;
  const providerConsecutiveZero: Record<string, number> = {};

  /**
   * Per-provider auto-disable Mode 2: if a SINGLE provider GENERATES questions
   * but 0 of them SURVIVE dedup across this many consecutive batches AND has
   * produced at least MIN_GEN_BEFORE_SURV_THROTTLE total questions, throttle
   * it for the rest of the run. This catches the "burns budget but produces
   * only duplicates" pattern (e.g., Anthropic on a saturated category set).
   * Different from Mode 1 — generation succeeds, but cost-efficiency is dead.
   */
  const PROVIDER_SURV_THROTTLE_CONSEC_ZERO = 2;
  const PROVIDER_SURV_THROTTLE_MIN_GEN = 10;
  const providerConsecutiveZeroSurv: Record<string, number> = {};
  const providerTotalGen: Record<string, number> = {};

  for (const p of providers) {
    providerConsecutiveZero[p.name] = 0;
    providerConsecutiveZeroSurv[p.name] = 0;
    providerTotalGen[p.name] = 0;
  }
  const disabledProviders = new Set<string>();
  const disableReasons: Record<string, string> = {};

  /**
   * Per-category rolling-window survival rate. Categories whose recent N
   * batches average below `CATEGORY_SURVIVAL_FLOOR` survival are temporarily
   * deprioritized in `nextTriple()` — the rotation skips past them in favor
   * of fresher categories. Only a soft skip: if ALL categories are below
   * the floor, the rotation falls back to its normal round-robin so the
   * run still makes progress.
   *
   * Rolling window keeps the state local to this run; doesn't mutate seeds.jsonl.
   */
  const CATEGORY_SURVIVAL_WINDOW = 4;
  const CATEGORY_SURVIVAL_FLOOR = 0.15;
  const recentSurvival = new Map<string, number[]>(); // category -> last N (kept/generated) ratios
  const isCategoryDeprioritized = (cat: string): boolean => {
    const window = recentSurvival.get(cat);
    if (!window || window.length < CATEGORY_SURVIVAL_WINDOW) return false;
    const avg = window.reduce((a, x) => a + x, 0) / window.length;
    return avg < CATEGORY_SURVIVAL_FLOOR;
  };

  // ----- Round-robin scheduler ------------------------------------------
  // Outer rotation order is a precomputed list of (catIdx, archIdx) pairs.
  // Two modes:
  //   - sequential (default): alphabetical category × archetype, deterministic
  //   - random: Fisher-Yates-shuffled once at run start (production mode)
  // Provider is picked per-batch via WEIGHTED sampling — defaults to equal
  // weights, but can be biased toward cheap providers so we don't burn the
  // budget on Opus / GPT-5 by default. The next-provider state still follows
  // a counter so spinner output is predictable.
  const rotationMode = opts.rotation ?? 'sequential';
  const outerOrder: Array<{ catIdx: number; archIdx: number }> = [];
  for (let c = 0; c < usableCategories.length; c++) {
    for (let a = 0; a < archetypes.length; a++) {
      outerOrder.push({ catIdx: c, archIdx: a });
    }
  }
  if (rotationMode === 'random') {
    // Fisher-Yates shuffle, in-place. No seeding — production-mode runs are
    // not meant to be reproducible (use 'sequential' for that).
    for (let i = outerOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [outerOrder[i], outerOrder[j]] = [outerOrder[j], outerOrder[i]];
    }
  }
  let outerIdx = 0;
  let provIdx = 0;

  // Per-provider default weights, applied when --provider-weights doesn't
  // specify a value for that provider. Override per-run from the CLI when
  // you want fresh tier-comparison data — but the defaults here keep bulk
  // production runs from accidentally pouring most of the budget into the
  // top-tier US providers, which empirically eat 50–60% of spend at equal
  // weights for only ~20% of survivors (10–20× more $/survivor than
  // google/deepseek/openrouter). Set the throttle low enough that they fire
  // roughly 1 batch in 20 — surgical-strike usage, not bulk.
  const DEFAULT_PROVIDER_WEIGHTS: Record<string, number> = {
    // Anthropic + OpenAI run ~$0.12-0.22 / survivor — 10-20× pricier than
    // google/deepseek. At 0.1 they fire roughly once per 75 batches, enough
    // to surface as a per-run data point but small enough that one unlucky
    // dedup-wall batch (e.g. 2026-05-04 production run: anthropic 6 gen, 0
    // surv, $0.38 wasted) doesn't blow up cumulative spend share.
    anthropic: 0.1,
    openai: 0.1,
    // openrouter-qwen produced strong survival in measured runs but at high
    // per-survivor cost ($0.036 vs $0.011 for deepseek, $0.014 for google).
    // Throttle to ~30% of equal-weight share so it still appears in the
    // rotation as a quality data point but doesn't dominate spend.
    'openrouter-qwen': 0.3,
  };

  // Normalize provider weights. Resolution order:
  //   1. opts.providerWeights[name] (passed via --provider-weights CLI flag)
  //   2. DEFAULT_PROVIDER_WEIGHTS[name] (the throttles above)
  //   3. 1.0 (everyone else gets equal share)
  const providerWeights: Record<string, number> = {};
  for (const p of providers) {
    providerWeights[p.name] =
      opts.providerWeights?.[p.name]
      ?? DEFAULT_PROVIDER_WEIGHTS[p.name]
      ?? 1.0;
  }
  const weightSum = Object.values(providerWeights).reduce((a, b) => a + b, 0);
  if (weightSum <= 0) throw new Error('All provider weights are zero — no provider can be picked');

  // Track per-provider quota usage so over-time we hit the configured ratio
  // even with one-batch-at-a-time decisions. `expectedShare` = the provider's
  // weight / sum. `usedShare` = batches assigned to this provider / total
  // assigned so far. We pick the provider with the largest deficit
  // (expectedShare - usedShare) — same idea as a Hungarian-style fairness
  // queue. This converges to the configured ratio quickly even on small runs.
  const providerBatchCount: Record<string, number> = {};
  for (const p of providers) providerBatchCount[p.name] = 0;
  /**
   * Pick the next provider via weighted-deficit. `excludeProviders` lets the
   * caller filter out providers that are currently in-flight (used by the
   * concurrent-batches mode to enforce the no-two-batches-same-provider
   * invariant). Default: empty set = all enabled providers eligible.
   */
  const pickProvider = (excludeProviders: ReadonlySet<ChatProviderName> = new Set()): typeof providers[number] | null => {
    const eligible = providers.filter((p) => !disabledProviders.has(p.name) && !excludeProviders.has(p.name));
    if (eligible.length === 0) return null;
    const totalAssigned = Object.values(providerBatchCount).reduce((a, b) => a + b, 0);
    let bestIdx = 0;
    let bestDeficit = -Infinity;
    for (let i = 0; i < eligible.length; i++) {
      const p = eligible[i];
      const expected = providerWeights[p.name] / weightSum;
      const used = totalAssigned > 0 ? providerBatchCount[p.name] / totalAssigned : 0;
      const deficit = expected - used;
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        bestIdx = i;
      }
    }
    const chosen = eligible[bestIdx];
    provIdx = providers.indexOf(chosen);
    return chosen;
  };

  // Rotation order:
  //   - PROVIDER is picked by `pickProvider()` (weighted-deficit sampler) per batch
  //   - The (CATEGORY, ARCHETYPE) outer pair advances via outerOrder[outerIdx],
  //     wrapping modulo outerOrder.length. In sequential mode this is the
  //     alphabetical category × archetype order; in random mode it's a fixed
  //     Fisher-Yates shuffle of the same pairs (decided once at run start).
  // Provider weights throttle expensive providers (anthropic, openai) without
  // sacrificing archetype/category coverage.
  const advance = (): void => {
    outerIdx = (outerIdx + 1) % outerOrder.length;
  };

  /**
   * Fill-gaps triple picker — alternative to nextTriple(). Picks the
   * (provider × archetype) cell with the LOWEST current `questionsAssessed`
   * count that's still below `targetSamplesPerCell`. Rotates through
   * compatible categories per cell using `samples % compat.length` so
   * repeated visits hit different categories.
   *
   * Returns null when every reachable cell has hit the target (stop signal).
   */
  const fillGapsTarget = opts.fillGaps?.targetSamplesPerCell ?? 0;
  const nextFillGapsTriple = (excludeProviders: ReadonlySet<ChatProviderName> = new Set()): Triple | null => {
    if (!opts.fillGaps) return null;

    interface Candidate { provider: typeof providers[number]; archetype: Archetype; samples: number }
    const candidates: Candidate[] = [];

    for (const p of providers) {
      if (disabledProviders.has(p.name)) continue;
      if (excludeProviders.has(p.name)) continue;
      const model = p.configuredModel();
      for (const archetype of archetypes) {
        // Need at least one compatible category in our usable set.
        const compatCats = compatibleCategories(archetype).filter((c) => usableCategories.includes(c));
        if (compatCats.length === 0) continue;
        // Respect manual + auto-disable blocklist (same as normal rotation).
        const allowed = isCellAllowed(p.name, model, archetype, providerArchetypeStats);
        if (!allowed.compatible) continue;
        // Live sample count — recordBatchOutcome mutates the in-memory cache,
        // so this picks up freshly-completed batches without needing re-load.
        const k = cellKey(p.name, model, archetype);
        const samples = providerArchetypeStats.stats[k]?.questionsAssessed ?? 0;
        if (samples >= fillGapsTarget) continue; // cell already filled
        candidates.push({ provider: p, archetype, samples });
      }
    }

    if (candidates.length === 0) return null;

    // Lowest sample count first (frontload most-needed cells). Tiebreaker:
    // provider order in `providers` for determinism across runs.
    candidates.sort((a, b) => {
      if (a.samples !== b.samples) return a.samples - b.samples;
      return providers.indexOf(a.provider) - providers.indexOf(b.provider);
    });
    const chosen = candidates[0];

    // Pick a compatible category — rotate by samples count so repeated
    // visits hit different categories within the same cell.
    const compatCats = compatibleCategories(chosen.archetype).filter((c) => usableCategories.includes(c));
    const category = compatCats[chosen.samples % compatCats.length];

    providerBatchCount[chosen.provider.name]++;
    return {
      category,
      archetype: chosen.archetype,
      provider: chosen.provider,
      key: `${chosen.provider.name}|${category}|${chosen.archetype}`,
    };
  };

  const nextTriple = (excludeProviders: ReadonlySet<ChatProviderName> = new Set()): Triple | null => {
    const totalCombos = outerOrder.length;
    // Two passes: first prefer non-deprioritized categories; then if everything
    // is deprioritized (all below the floor), fall through and accept any.
    for (const acceptDeprioritized of [false, true]) {
      for (let i = 0; i < totalCombos; i++) {
        const { catIdx, archIdx } = outerOrder[outerIdx];
        const archetype = archetypes[archIdx];
        const category = usableCategories[catIdx];
        advance();
        if (!isCompatible(category, archetype)) continue;
        if (!acceptDeprioritized && isCategoryDeprioritized(category)) continue;
        // Provider is weighted, not round-robin. Find one whose triple isn't
        // saturated AND that hasn't been auto-disabled mid-run; if all are
        // unusable for this (cat, arch), skip the cell.
        for (let attempt = 0; attempt < providers.length; attempt++) {
          const provider = pickProvider(excludeProviders);
          if (!provider) break; // every provider has been disabled or excluded
          const key = `${provider.name}|${category}|${archetype}`;
          if (saturated.has(key)) {
            providerBatchCount[provider.name]++;
            continue;
          }
          // Provider × archetype constraints — skip cells where this provider's
          // configured model has been manually blocked or auto-disabled by
          // cross-run evidence (poor survival or quality on this archetype).
          const allowed = isCellAllowed(
            provider.name,
            provider.configuredModel(),
            archetype,
            providerArchetypeStats,
          );
          if (!allowed.compatible) {
            providerBatchCount[provider.name]++;
            continue;
          }
          providerBatchCount[provider.name]++;
          return { category, archetype, provider, key };
        }
      }
      // Inner loop already wraps via advance() — outerIdx is back at start
      // of pass 1's scan, so no manual rewind needed before pass 2.
    }
    return null;
  };

  // ----- Main loop -------------------------------------------------------
  // Concurrent-batches mode: when concurrentBatches > 1, we dispatch up to
  // N batches at a time, with the invariant that no two in-flight batches
  // share a generator provider. The post-batch critical section (dedup,
  // pool append, stats updates, log writes, evolver tick) is serialised
  // via `postBatchMutex`. Stages BEFORE dedup (gen / quality / verify /
  // embed) run in parallel and provide most of the wallclock speedup.
  const concurrentBatches = Math.max(1, opts.concurrentBatches ?? 1);
  const postBatchMutex = new Mutex();
  /** Providers currently in-flight — used by `nextTriple()` to enforce the
   *  no-two-batches-same-provider invariant. Mutated only inside the
   *  serial dispatcher below, so no race. */
  const inFlightProviders = new Set<ChatProviderName>();
  /** Pending batch promises — `Promise.race` over this set lets the
   *  dispatcher wait for ANY batch to finish before retrying nextTriple(). */
  const inFlightPromises = new Set<Promise<void>>();

  const spinner = ora(
    `Auto-generating: target ${opts.targetSurvivors}, budget $${opts.budgetUsd.toFixed(2)}, ${providers.length} providers × ${usableCategories.length} cats × ${archetypes.length} archetypes${concurrentBatches > 1 ? ` (×${concurrentBatches} concurrent)` : ''}`,
  ).start();

  let stopReason: RunSummary['stopReason'] = 'max_batches';
  let stopRequested = false;

  /**
   * Update the aggregate spinner — single source of truth across all
   * concurrent batches. Per-batch detail goes to run.log.jsonl; the spinner
   * just shows totals. Replaces the per-batch `spinner.text = ...` from
   * sequential mode (which would clobber when ≥2 batches updated).
   */
  const refreshSpinner = () => {
    spinner.text =
      `survivors ${cumulativeSurvivors}/${opts.targetSurvivors} | ` +
      `spent $${cumulativeCost.toFixed(3)}/$${opts.budgetUsd} | ` +
      `batches ${batchIdx} | ` +
      `in-flight ${inFlightPromises.size}/${concurrentBatches}` +
      (inFlightProviders.size > 0 ? ` (${[...inFlightProviders].join(', ')})` : '');
  };

  /**
   * Process one batch end-to-end: claim the triple, run the pipeline,
   * apply post-batch state mutations under the shared mutex. Resolves
   * when the batch is fully accounted for in the run state.
   */
  const processBatch = async (triple: Triple, localBatchIdx: number): Promise<void> => {
    const batchDir = path.join(logDir, `batch-${String(localBatchIdx).padStart(3, '0')}`);
    await mkdir(batchDir, { recursive: true });

    const batchLog = await runOneBatch({
      triple,
      batchSize,
      batchDir,
      poolPath,
      batchIdx: localBatchIdx,
      postBatchMutex,
      altModel: opts.qualityAltModel,
    });

    // POST-BATCH STATE: serialised. Cumulative counters, per-provider
    // tracking, stats persistence, log writes, evolver tick — all need
    // to see the same view of state, so wrap them in the same mutex
    // that gated dedup. Two batches finishing simultaneously enter this
    // section in dispatch order (whoever's runOneBatch resolves first).
    await postBatchMutex.lock(async () => {
      await applyBatchResult(batchLog, triple, localBatchIdx);
    });
  };

  /**
   * Dispatcher loop: keep up to N batches in flight. When at the cap,
   * wait for one to finish before queueing the next. Stop conditions
   * (target / budget / max-batches / network failure / all-disabled /
   * all-saturated) are checked between dispatches.
   */
  while (!stopRequested) {
    // Check stop conditions on shared state
    if (cumulativeSurvivors >= opts.targetSurvivors) { stopReason = 'target_reached'; break; }
    if (cumulativeCost >= opts.budgetUsd) { stopReason = 'budget_exhausted'; break; }
    if (batchIdx >= maxBatches) { stopReason = 'max_batches'; break; }
    if (consecutiveZeroGenBatches >= NETWORK_FAILURE_THRESHOLD) { stopReason = 'generation_failing'; break; }
    if (disabledProviders.size >= providers.length && inFlightProviders.size === 0) { stopReason = 'all_providers_disabled'; break; }

    // At concurrency limit? Wait for a slot.
    if (inFlightPromises.size >= concurrentBatches) {
      await Promise.race(inFlightPromises);
      continue;
    }

    // Pick a triple, excluding currently in-flight providers. In fill-gaps
    // mode, the picker targets cells under the sample threshold instead of
    // the normal (category × archetype) outer rotation.
    const triple = opts.fillGaps
      ? nextFillGapsTriple(inFlightProviders)
      : nextTriple(inFlightProviders);
    if (!triple) {
      if (inFlightPromises.size === 0) {
        stopReason = 'all_saturated';
        break;
      }
      // No eligible work right now (all eligible providers in flight, or
      // all cells saturated for the moment) — wait for a batch to finish
      // and retry, since freeing a provider may make more cells eligible.
      await Promise.race(inFlightPromises);
      continue;
    }

    const localBatchIdx = batchIdx++;
    inFlightProviders.add(triple.provider.name);
    refreshSpinner();

    const promise = processBatch(triple, localBatchIdx)
      .catch((err) => {
        process.stderr.write(`\n[batch ${localBatchIdx}] FATAL: ${(err as Error).message}\n`);
      })
      .finally(() => {
        inFlightProviders.delete(triple.provider.name);
        inFlightPromises.delete(promise);
        refreshSpinner();
      });
    inFlightPromises.add(promise);
  }

  // Wait for any in-flight batches to drain before final accounting.
  if (inFlightPromises.size > 0) {
    spinner.text = `Draining ${inFlightPromises.size} in-flight batches...`;
    await Promise.all(inFlightPromises);
  }

  /**
   * Apply one batch's result to the shared run state. ONLY called inside
   * postBatchMutex — every mutation here is serialised across concurrent
   * batches. This is the surgical extraction of the original sequential
   * loop's post-batch bookkeeping; logic is unchanged from the pre-
   * concurrency version.
   */
  async function applyBatchResult(batchLog: BatchLog, triple: Triple, localBatchIdx: number): Promise<void> {
    void localBatchIdx; // batchLog already carries it

    cumulativeCost += batchLog.generation.cost + batchLog.quality.cost + batchLog.verify.cost + batchLog.embed.cost;
    cumulativeSurvivors += batchLog.appended;
    batchLog.cumulativeCost = cumulativeCost;
    batchLog.cumulativeSurvivors = cumulativeSurvivors;
    batchLog.poolSizeAfter = await countPool(poolPath);

    // Update per-category rolling survival window — drives soft deprioritization
    // in nextTriple() so saturated categories yield airtime to fresh ones.
    if (batchLog.generation.succeeded > 0) {
      const survivalRatio = batchLog.appended / batchLog.generation.succeeded;
      const win = recentSurvival.get(triple.category) ?? [];
      win.push(survivalRatio);
      if (win.length > CATEGORY_SURVIVAL_WINDOW) win.shift();
      recentSurvival.set(triple.category, win);
    }

    // Network-failure detection: track consecutive zero-generation batches
    // across all triples. When the count reaches the threshold, abort —
    // continuing is retry waste, not progress.
    if (batchLog.generation.succeeded === 0) {
      consecutiveZeroGenBatches += 1;
    } else {
      consecutiveZeroGenBatches = 0;
    }
    if (consecutiveZeroGenBatches >= NETWORK_FAILURE_THRESHOLD) {
      stopReason = 'generation_failing';
      stopRequested = true;
      await appendFile(logPath, JSON.stringify(batchLog) + '\n', 'utf8');
      return;
    }

    // Per-provider auto-disable: two independent failure modes.
    const provName = triple.provider.name;

    // ---- Mode 1: zero GENERATED — catches credit/network/key failures ----
    if (batchLog.generation.succeeded === 0) {
      providerConsecutiveZero[provName] = (providerConsecutiveZero[provName] ?? 0) + 1;
      if (
        providerConsecutiveZero[provName] >= PROVIDER_DISABLE_THRESHOLD &&
        !disabledProviders.has(provName)
      ) {
        disabledProviders.add(provName);
        disableReasons[provName] = `zero generation across ${PROVIDER_DISABLE_THRESHOLD} consecutive batches (credit / rate-limit / invalid key)`;
        process.stderr.write(
          `\n⚠ Provider "${provName}" auto-disabled (Mode 1: zero-generation) at batch ${localBatchIdx + 1} — likely out of credits / rate-limited / invalid key.\n`,
        );
      }
    } else {
      providerConsecutiveZero[provName] = 0;
    }

    // ---- Mode 2: generates fine but 0 SURVIVE — catches saturation/cost waste ----
    providerTotalGen[provName] = (providerTotalGen[provName] ?? 0) + batchLog.generation.succeeded;
    if (batchLog.generation.succeeded > 0 && batchLog.appended === 0) {
      providerConsecutiveZeroSurv[provName] = (providerConsecutiveZeroSurv[provName] ?? 0) + 1;
      if (
        providerConsecutiveZeroSurv[provName] >= PROVIDER_SURV_THROTTLE_CONSEC_ZERO &&
        providerTotalGen[provName] >= PROVIDER_SURV_THROTTLE_MIN_GEN &&
        !disabledProviders.has(provName)
      ) {
        disabledProviders.add(provName);
        disableReasons[provName] = `0 survivors across ${PROVIDER_SURV_THROTTLE_CONSEC_ZERO} consecutive batches despite generating ${providerTotalGen[provName]} questions (cost-efficiency death — burning budget on duplicates)`;
        process.stderr.write(
          `\n⚠ Provider "${provName}" auto-disabled (Mode 2: zero-survivor) at batch ${localBatchIdx + 1} — generated ${providerTotalGen[provName]} questions, 0 survived dedup across ${PROVIDER_SURV_THROTTLE_CONSEC_ZERO} batches. Burning budget without progress.\n`,
        );
      }
    } else if (batchLog.appended > 0) {
      providerConsecutiveZeroSurv[provName] = 0;
    }

    // ---- Bail out if all providers are now disabled ----
    if (disabledProviders.size >= providers.length) {
      stopReason = 'all_providers_disabled';
      stopRequested = true;
      await appendFile(logPath, JSON.stringify(batchLog) + '\n', 'utf8');
      return;
    }

    // Update triple stats and saturation flag
    const ts = stats.get(triple.key) ?? { batches: 0, questionsGenerated: 0, survivors: 0, totalCost: 0, consecutiveZeroSurv: 0 };
    ts.batches += 1;
    ts.questionsGenerated += batchLog.generation.succeeded;
    ts.survivors += batchLog.appended;
    ts.totalCost += batchLog.generation.cost + batchLog.quality.cost + batchLog.verify.cost + batchLog.embed.cost;
    const rejectRate = batchLog.dedup.autoReject + batchLog.dedup.rejectLog;
    const generated = batchLog.generation.succeeded;
    const rateFloat = generated > 0 ? rejectRate / generated : 0;
    if (batchLog.appended === 0) {
      ts.consecutiveZeroSurv += 1;
      if (ts.consecutiveZeroSurv >= SATURATION_CONSEC_ZERO && rateFloat >= SATURATION_REJECT_RATE) {
        saturated.add(triple.key);
        batchLog.saturationFlagged = triple.key;
      }
    } else {
      ts.consecutiveZeroSurv = 0;
    }
    stats.set(triple.key, ts);

    // Cross-run (provider, model, archetype) stats — feeds the auto-disable
    // mechanism. Read quality scores from the per-batch quality.jsonl so we
    // get per-question scores (not just batch averages). Any newly-blocked
    // cell is logged to stderr so the operator notices in real time.
    {
      const batchDirForStats = path.join(logDir, `batch-${String(localBatchIdx).padStart(3, '0')}`);
      const qualityPath = path.join(batchDirForStats, 'quality.jsonl');
      const qualityScores: number[] = [];
      const funScores: number[] = [];
      if (existsSync(qualityPath)) {
        try {
          const qLines = (await readFile(qualityPath, 'utf8')).trim().split('\n').filter(Boolean);
          for (const line of qLines) {
            const q = JSON.parse(line) as Question;
            const a = q.qualityAssessment;
            if (a) {
              qualityScores.push(a.qualityScore);
              funScores.push(a.funScore);
            }
          }
        } catch { /* per-batch quality file missing or malformed — skip */ }
      }
      try {
        const newlyBlocked = await recordBatchOutcome({
          provider: triple.provider.name,
          model: triple.provider.configuredModel(),
          archetype: triple.archetype as Archetype,
          questionsGenerated: batchLog.generation.succeeded,
          survivors: batchLog.appended,
          qualityRejects: batchLog.quality.reject,
          qualityScores,
          funScores,
        });
        if (newlyBlocked) {
          process.stderr.write(
            `\n⚠ Auto-blocked ${triple.provider.name} (${triple.provider.configuredModel()}) × ${triple.archetype}: ${newlyBlocked.reason}\n`,
          );
        }
      } catch (err) {
        // Persisting stats is best-effort; never abort a run because the
        // stats file is unwritable.
        process.stderr.write(
          `\n[provider-archetype-stats] update failed at batch ${localBatchIdx + 1}: ${(err as Error).message}\n`,
        );
      }
    }

    await appendFile(logPath, JSON.stringify(batchLog) + '\n', 'utf8');

    // Append batch's quality + dedup records to rolling files so the evolver
    // tick can see all questions assessed so far this run.
    const batchDir2 = path.join(logDir, `batch-${String(localBatchIdx).padStart(3, '0')}`);
    const batchQualityPath = path.join(batchDir2, 'quality.jsonl');
    const batchDedupPath = path.join(batchDir2, 'dedup.json');
    if (existsSync(batchQualityPath)) {
      const qContent = await readFile(batchQualityPath, 'utf8');
      if (qContent.trim()) await appendFile(qualityRollingPath, qContent.endsWith('\n') ? qContent : qContent + '\n', 'utf8');
    }
    if (existsSync(batchDedupPath)) {
      try {
        const dContent = JSON.parse(await readFile(batchDedupPath, 'utf8')) as { records?: unknown[] };
        const recs = dContent.records ?? [];
        if (recs.length > 0) {
          await appendFile(dedupRecordsPath, recs.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
        }
      } catch { /* ignore parse errors — partial batch */ }
    }

    // Note: batchIdx already incremented in the dispatcher (`batchIdx++`).
    // localBatchIdx is the OLD value, so completedCount == localBatchIdx + 1
    // (this batch has now finished). Evolver-tick uses completedCount
    // exclusively so the divisibility check fires once per N completed
    // batches, regardless of completion order under concurrency.
    const completedCount = localBatchIdx + 1;

    // Evolver tick: every N batches, run demotions + weight tweaks +
    // new-seed proposals against everything assessed so far this run.
    // Mutations land in seeds.jsonl; the next batch's generator picks them
    // up via fresh disk-load. Proposals are written to a per-tick file —
    // never auto-merged into seeds.jsonl.
    if (evolverTickEvery > 0 && completedCount % evolverTickEvery === 0 && existsSync(qualityRollingPath)) {
      try {
        const tickDir = path.join(evolverTicksDir, `batch-${String(completedCount).padStart(3, '0')}`);
        await mkdir(tickDir, { recursive: true });

        // Build the rolling dedup-clusters JSON the evolver expects.
        const dedupClustersPath = path.join(tickDir, 'dedup-clusters-rolling.json');
        if (existsSync(dedupRecordsPath)) {
          const recsRaw = await readFile(dedupRecordsPath, 'utf8');
          const records = recsRaw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
          await writeFile(dedupClustersPath, JSON.stringify({ records }, null, 2), 'utf8');
        }

        spinner.text = `Batch ${completedCount} | running evolver tick (analyzing ${completedCount} batches so far)...`;
        const proposalsPath = path.join(tickDir, 'seeds-proposed.json');
        await evolveSeeds({
          qualityInputPath: qualityRollingPath,
          clustersInputPath: existsSync(dedupClustersPath) ? dedupClustersPath : undefined,
          reportOutputPath: path.join(tickDir, 'seed-report.json'),
          proposalsOutputPath: proposalsPath,
          // Use Google (Gemini Pro) for new-seed proposals. Gemini's broader
          // training-data lineage produces seed angles that are LESS likely
          // to overlap with what DeepSeek itself would canonicalise during
          // generation — we want fresh territory, not echoes of the same model.
          proposalProvider: 'google',
        });

        // Auto-run the seed verifier on the proposals. Claude Opus 4.7 (with
        // Gemini fallback) decides keep / edit / remove per proposal and
        // applies the decision directly to seeds.jsonl. Subsequent batches
        // will pick up the new seeds via the generator's fresh disk-load.
        if (existsSync(proposalsPath)) {
          try {
            spinner.text = `Batch ${completedCount} | seed-verifier (Opus 4.7 → Gemini fallback) reviewing proposals...`;
            const { verifySeeds } = await import('./seed-verifier.js');
            await verifySeeds({
              proposalsPath,
              logPath: path.join(tickDir, 'seed-verifier-log.jsonl'),
            });
          } catch (verifyErr) {
            process.stderr.write(
              `\n[seed-verifier @ batch ${completedCount}] failed: ${(verifyErr as Error).message}\n`,
            );
          }
        }
      } catch (err) {
        process.stderr.write(`\n[evolver tick @ batch ${completedCount}] failed: ${(err as Error).message}\n`);
      }
    }
  }

  if (cumulativeSurvivors >= opts.targetSurvivors) stopReason = 'target_reached';
  else if (cumulativeCost >= opts.budgetUsd) stopReason = 'budget_exhausted';

  const disabledNote = disabledProviders.size > 0
    ? ` (auto-disabled: ${[...disabledProviders].join(', ')})`
    : '';
  if (stopReason === 'generation_failing') {
    spinner.fail(
      `Aborted — ${NETWORK_FAILURE_THRESHOLD}+ consecutive batches produced 0 questions (likely network/API outage). ${cumulativeSurvivors} survivors over ${batchIdx} batches, $${cumulativeCost.toFixed(3)} spent${disabledNote}.`,
    );
  } else if (stopReason === 'all_providers_disabled') {
    spinner.fail(
      `Aborted — all providers auto-disabled${disabledNote}. ${cumulativeSurvivors} survivors over ${batchIdx} batches, $${cumulativeCost.toFixed(3)} spent.`,
    );
  } else {
    spinner.succeed(
      `Done — ${stopReason}. ${cumulativeSurvivors} survivors over ${batchIdx} batches, $${cumulativeCost.toFixed(3)}${disabledNote}.`,
    );
  }

  const endedAt = new Date().toISOString();
  const summary: RunSummary = {
    startedAt,
    endedAt,
    durationMs: Date.now() - startTime,
    config: opts,
    totals: {
      batchesRun: batchIdx,
      questionsGenerated: [...stats.values()].reduce((a, s) => a + s.questionsGenerated, 0),
      questionsSurvived: cumulativeSurvivors,
      totalCost: cumulativeCost,
      poolSizeStart,
      poolSizeEnd: await countPool(poolPath),
    },
    stopReason,
    perTripleStats: Object.fromEntries(stats),
    providersDisabledMidRun: disabledProviders.size > 0 ? [...disabledProviders] : undefined,
  };
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

  // Auto-generate the standard run report so every run has the per-provider
  // spend / per-category trajectory / per-seed cost-band analysis on disk.
  try {
    const { analyzeRun } = await import('./analyze-run.js');
    const { reportPath } = await analyzeRun(logDir);
    console.log(`\nReport: ${reportPath}`);
  } catch (err) {
    process.stderr.write(`\n[analyze-run] failed: ${(err as Error).message}\n`);
  }

  return summary;

  // -----------------------------------------------------------------------
  function finalizeEarly(reason: RunSummary['stopReason']): RunSummary {
    return {
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      config: opts,
      totals: { batchesRun: 0, questionsGenerated: 0, questionsSurvived: 0, totalCost: 0, poolSizeStart: 0, poolSizeEnd: 0 },
      stopReason: reason,
      perTripleStats: {},
    };
  }
}

/**
 * Runs ONE mini-batch through the full pipeline:
 * generate → quality → verify → embed → dedup → append survivors to pool.
 * Returns a (mostly populated) BatchLog — the orchestrator fills in
 * cumulativeCost / cumulativeSurvivors / poolSizeAfter.
 */
async function runOneBatch(args: {
  triple: Triple;
  batchSize: number;
  batchDir: string;
  poolPath: string;
  batchIdx: number;
  /** Mutex guarding the dedup→append critical section. In sequential mode
   *  this is a fresh per-call mutex (effectively a no-op); in concurrent
   *  mode all batches share the same mutex so dedup-then-append is
   *  serialised across batches. */
  postBatchMutex: Mutex;
  /** Optional alt model for A/B quality comparison. */
  altModel?: string;
}): Promise<BatchLog> {
  const { triple, batchSize, batchDir, poolPath, batchIdx, postBatchMutex, altModel } = args;
  const tStart = Date.now();

  const generatedPath = path.join(batchDir, 'generated.jsonl');
  const qualityPath = path.join(batchDir, 'quality.jsonl');
  const keepPath = path.join(batchDir, 'keep.jsonl');
  const reviewPath = path.join(batchDir, 'review.jsonl');
  const rejectPath = path.join(batchDir, 'reject.jsonl');
  const verifiedPath = path.join(batchDir, 'verified.jsonl');
  const embeddedPath = path.join(batchDir, 'embedded.jsonl');
  const dedupPath = path.join(batchDir, 'dedup.json');

  // ---- Generate ----------------------------------------------------------
  const cb1 = costLogger.total();
  const genResult = await generateQuestions({
    count: batchSize,
    archetype: triple.archetype,
    category: triple.category,
    provider: triple.provider.name,
    outputPath: generatedPath,
  });
  const genCost = costLogger.total() - cb1;

  if (genResult.written === 0) {
    return emptyBatchLog(triple, batchSize, genCost, batchIdx, tStart);
  }

  // ---- Quality (DeepSeek default) ---------------------------------------
  const cb2 = costLogger.total();
  let qualityKeep = 0,
    qualityReview = 0,
    qualityReject = 0;
  let avgFun: number | null = null,
    avgQual: number | null = null,
    avgLearn: number | null = null;
  try {
    const qRes = await checkQuality({
      inputPath: generatedPath,
      outputPath: qualityPath,
      keepPath,
      reviewPath,
      rejectPath,
      provider: 'deepseek',
      altModel,
    });
    qualityKeep = qRes.decisionCounts.keep;
    qualityReview = qRes.decisionCounts.review;
    qualityReject = qRes.decisionCounts.reject;
    // Compute averages from the all-output file
    const all = await readJsonlAll<Question>(qualityPath);
    const assessed = all.filter((q) => q.qualityAssessment);
    if (assessed.length > 0) {
      avgFun = assessed.reduce((a, q) => a + (q.qualityAssessment!.funScore ?? 0), 0) / assessed.length;
      avgQual = assessed.reduce((a, q) => a + (q.qualityAssessment!.qualityScore ?? 0), 0) / assessed.length;
      avgLearn = assessed.reduce((a, q) => a + (q.qualityAssessment!.learningValue ?? 0), 0) / assessed.length;
    }
  } catch (err) {
    process.stderr.write(`\n[batch ${batchIdx}] quality failed: ${(err as Error).message}\n`);
  }
  const qualityCost = costLogger.total() - cb2;

  // ---- Verify (only KEEP from quality) ----------------------------------
  const cb3 = costLogger.total();
  let verifyPassed = 0,
    verifyFailed = 0;
  try {
    if (existsSync(keepPath) && qualityKeep > 0) {
      const vRes = await verifyQuestions({
        inputPath: keepPath,
        outputPath: verifiedPath,
      });
      verifyPassed = vRes.passed;
      verifyFailed = vRes.failed;
    }
  } catch (err) {
    process.stderr.write(`\n[batch ${batchIdx}] verify failed: ${(err as Error).message}\n`);
  }
  const verifyCost = costLogger.total() - cb3;

  // ---- Embed ------------------------------------------------------------
  const cb4 = costLogger.total();
  let embedCount = 0;
  try {
    if (existsSync(verifiedPath) && verifyPassed > 0) {
      const eRes = await embedQuestions({
        inputPath: verifiedPath,
        outputPath: embeddedPath,
      });
      embedCount = eRes.embedded;
    }
  } catch (err) {
    process.stderr.write(`\n[batch ${batchIdx}] embed failed: ${(err as Error).message}\n`);
  }
  const embedCost = costLogger.total() - cb4;

  // ---- Dedup ------------------------------------------------------------
  let dedupCounts = { auto_reject: 0, reject_log: 0, flag_review: 0, related: 0, unique: 0 };
  let vsPool = 0;
  let vsBatch = 0;
  let appended = 0;

  if (existsSync(embeddedPath) && embedCount > 0) {
    // CRITICAL SECTION: serialise dedup+pool-append across concurrent batches.
    // Dedup needs to read the FRESH pool (including survivors appended by
    // any concurrently-running batch that finished its critical section
    // first). Without this mutex, batch A's appended survivors are invisible
    // to batch B's HNSW index, allowing duplicates to slip through.
    await postBatchMutex.lock(async () => {
      try {
        const dRes = await dedupQuestions({
          inputPath: embeddedPath,
          poolPath: existsSync(poolPath) ? poolPath : undefined,
          outputPath: dedupPath,
        });
        dedupCounts = dRes.decisionCounts;

        // Breakdown: rejected vs pool member vs vs another batch sibling.
        // (No cross-provider count here — the orchestrator runs one provider per
        // batch, so within-batch matches are always within-provider by design.)
        const dedupJson = JSON.parse(await readFile(dedupPath, 'utf8'));
        const records: Array<{ questionId: string; decision: string; matches: Array<{ otherId: string; similarity: number }> }> = dedupJson.records;
        const newQs = await readJsonlAll<Question>(embeddedPath);
        const newIds = new Set(newQs.map((q) => q.id));
        for (const r of records) {
          if (r.decision !== 'auto_reject' && r.decision !== 'reject_log') continue;
          const top = r.matches[0];
          if (!top) continue;
          if (!newIds.has(top.otherId)) {
            vsPool += 1;
          } else {
            vsBatch += 1;
          }
        }

        // Append survivors to the pool
        const survivorIds = new Set(records.filter((r) => r.decision === 'unique' || r.decision === 'related').map((r) => r.questionId));
        const survivorRecords = newQs.filter((q) => survivorIds.has(q.id));
        if (survivorRecords.length > 0) {
          const lines = survivorRecords.map((q) => JSON.stringify(q)).join('\n') + '\n';
          await appendFile(poolPath, lines, 'utf8');
          appended = survivorRecords.length;
        }
      } catch (err) {
        process.stderr.write(`\n[batch ${batchIdx}] dedup failed: ${(err as Error).message}\n`);
      }
    });
  }

  return {
    ts: new Date().toISOString(),
    batchIdx,
    triple: {
      category: triple.category,
      archetype: triple.archetype,
      provider: triple.provider.name,
      model: triple.provider.configuredModel(),
    },
    generation: {
      requested: batchSize,
      succeeded: genResult.written,
      parseFailures: genResult.rejected,
      cost: genCost,
    },
    quality: { keep: qualityKeep, review: qualityReview, reject: qualityReject, avgFun, avgQual, avgLearning: avgLearn, cost: qualityCost },
    verify: { passed: verifyPassed, failed: verifyFailed, cost: verifyCost },
    embed: { count: embedCount, cost: embedCost },
    dedup: {
      autoReject: dedupCounts.auto_reject,
      rejectLog: dedupCounts.reject_log,
      flagReview: dedupCounts.flag_review,
      related: dedupCounts.related,
      unique: dedupCounts.unique,
      vsPool,
      vsBatch,
    },
    appended,
    cumulativeCost: 0, // filled by caller
    cumulativeSurvivors: 0, // filled by caller
    poolSizeAfter: 0, // filled by caller
    durationMs: Date.now() - tStart,
  };
}

function emptyBatchLog(triple: Triple, batchSize: number, genCost: number, batchIdx: number, tStart: number): BatchLog {
  return {
    ts: new Date().toISOString(),
    batchIdx,
    triple: {
      category: triple.category,
      archetype: triple.archetype,
      provider: triple.provider.name,
      model: triple.provider.configuredModel(),
    },
    generation: { requested: batchSize, succeeded: 0, parseFailures: batchSize, cost: genCost },
    quality: { keep: 0, review: 0, reject: 0, avgFun: null, avgQual: null, avgLearning: null, cost: 0 },
    verify: { passed: 0, failed: 0, cost: 0 },
    embed: { count: 0, cost: 0 },
    dedup: { autoReject: 0, rejectLog: 0, flagReview: 0, related: 0, unique: 0, vsPool: 0, vsBatch: 0 },
    appended: 0,
    cumulativeCost: 0,
    cumulativeSurvivors: 0,
    poolSizeAfter: 0,
    durationMs: Date.now() - tStart,
  };
}

async function countPool(poolPath: string): Promise<number> {
  if (!existsSync(poolPath)) return 0;
  const text = await readFile(poolPath, 'utf8');
  return text.split('\n').filter((l) => l.trim().length > 0).length;
}

// JsonlWriter is imported above to keep its definition adjacent; touch it once
// so tree-shakers don't drop it.
void JsonlWriter;
void todayStamp;
