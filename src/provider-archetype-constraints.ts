import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import type { Archetype } from './schema.js';
import type { ChatProviderName } from './providers/types.js';

/**
 * (Provider × Archetype) compatibility — separate from the (category × archetype)
 * matrix in archetype-compatibility.ts. Some archetypes have strict craftsmanship
 * requirements (`process_sequence` distractors must be REAL steps in the same
 * process, `estimation` options must span an order of magnitude) that mid-tier
 * Chinese models routinely fail. The quality verifier catches these correctly,
 * but at full token cost — better to skip the cell entirely.
 *
 * Two layers:
 *
 *   1. **MANUAL_BLOCKLIST** — source-controlled, human-curated. Starts empty;
 *      add entries as we accumulate evidence. Lives in this file so the
 *      blocklist evolves with the code.
 *
 *   2. **AUTO-DISABLE** — persisted to `data/provider-archetype-stats.json`.
 *      The orchestrator updates per-(provider, model, archetype) stats after
 *      each batch. When a cell crosses the thresholds (enough samples AND
 *      poor survival OR poor quality), it's auto-added to a blocklist that
 *      future runs honour. Keys include the model id, so upgrading the
 *      configured model for a provider RESETS its evidence — fresh model
 *      gets a clean slate, no stale carry-over.
 */

// ---------------------------------------------------------------------------
// Layer 1 — manual, source-controlled blocklist
// ---------------------------------------------------------------------------

/**
 * Manual provider × archetype blocklist. ANY model under that provider name
 * is blocked from this archetype, regardless of model id. Use sparingly —
 * model upgrades may fix the underlying weakness. For per-model blocking,
 * rely on Layer 2 (auto-disable, which keys on model id).
 *
 * Starts empty 2026-05-03 — Run 13 surfaced doubao/minimax weaknesses on
 * process_sequence + estimation, but those evidence points were on OLD model
 * versions (seed-1.6, m2.7-20260318). With the upgraded models in place
 * (seed-2.0-lite, m2.7), wait for fresh evidence before manually banning.
 */
export const MANUAL_PROVIDER_ARCHETYPE_BLOCKLIST: Partial<Record<Archetype, ChatProviderName[]>> = {
  // Example shape — populate after the next test run gives evidence:
  // process_sequence: ['openrouter-doubao', 'openrouter-minimax'],
  // estimation: ['openrouter-minimax'],
};

// ---------------------------------------------------------------------------
// Layer 2 — auto-disable based on cross-run stats
// ---------------------------------------------------------------------------

/** Once a (provider, model, archetype) has produced this many assessed
 *  questions, we trust its survival/quality signals enough to act on them. */
export const MIN_QUESTIONS_BEFORE_AUTO_BLOCK = 20;

/** Auto-block when survival rate falls below this floor (with enough samples). */
export const AUTO_BLOCK_SURVIVAL_FLOOR = 0.20;

/** Auto-block when avg quality score falls below this floor (with enough samples). */
export const AUTO_BLOCK_QUALITY_FLOOR = 2.5;

const STATS_PATH = path.join(DATA_DIR, 'provider-archetype-stats.json');

interface CellStats {
  /** Total questions where this provider+model+archetype was used. */
  questionsAssessed: number;
  /** Survivors that landed in the pool. */
  survivors: number;
  /** Sum of qualityScores across assessed questions (for averaging). */
  qualityScoreSum: number;
  /** Count of questions for which we have a qualityScore (denominator for sum). */
  qualityScoreCount: number;
  /** Sum of funScores (for averaging). */
  funScoreSum: number;
  funScoreCount: number;
  /** Quality-stage rejection count (separate from dedup rejection). */
  qualityRejects: number;
  /** ISO timestamp of the most recent batch that updated this cell. */
  lastUpdated: string;
}

interface BlocklistEntry {
  /** When the auto-disable fired. */
  blockedAt: string;
  /** Human-readable reason — "8% survival across 24 questions". */
  reason: string;
  /** Snapshot of the stats at the time of blocking. */
  questionsAssessed: number;
  survivors: number;
  survivalRate: number;
  avgQualityScore: number | null;
}

interface StatsFile {
  /** Schema version — bump if we ever change the on-disk format. */
  version: 1;
  stats: Record<string, CellStats>;
  blocklist: Record<string, BlocklistEntry>;
  lastUpdated: string;
}

const EMPTY_STATS_FILE: StatsFile = {
  version: 1,
  stats: {},
  blocklist: {},
  lastUpdated: new Date(0).toISOString(),
};

/** Build the default-repertoire key for a (provider, model, archetype) cell. */
export function cellKey(provider: ChatProviderName, model: string, archetype: Archetype): string {
  return `${provider}|${model}|${archetype}`;
}

let cachedStats: StatsFile | null = null;

/** Load the persisted stats (cached in-process). */
export async function loadProviderArchetypeStats(): Promise<StatsFile> {
  if (cachedStats) return cachedStats;
  if (!existsSync(STATS_PATH)) {
    cachedStats = { ...EMPTY_STATS_FILE, stats: {}, blocklist: {} };
    return cachedStats;
  }
  try {
    const raw = await readFile(STATS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as StatsFile;
    if (parsed.version !== 1) {
      // Unknown version — start fresh rather than corrupt newer state.
      cachedStats = { ...EMPTY_STATS_FILE, stats: {}, blocklist: {} };
      return cachedStats;
    }
    cachedStats = parsed;
    return cachedStats;
  } catch {
    cachedStats = { ...EMPTY_STATS_FILE, stats: {}, blocklist: {} };
    return cachedStats;
  }
}

async function saveStats(s: StatsFile): Promise<void> {
  await mkdir(path.dirname(STATS_PATH), { recursive: true });
  await writeFile(STATS_PATH, JSON.stringify(s, null, 2), 'utf8');
  cachedStats = s;
}

/** Reset the in-process cache (used by CLI commands that need a fresh read). */
export function resetCache(): void {
  cachedStats = null;
}

// ---------------------------------------------------------------------------
// Compatibility check — called by the orchestrator's nextTriple()
// ---------------------------------------------------------------------------

export interface CompatibilityResult {
  compatible: boolean;
  reason?: string;
  source?: 'manual' | 'auto';
}

/**
 * True if this (provider, model, archetype) cell is allowed to run.
 *
 * Sync version that operates on already-loaded stats — orchestrator calls
 * `loadProviderArchetypeStats()` once at run start, then queries this many
 * times per batch.
 */
export function isCellAllowed(
  provider: ChatProviderName,
  model: string,
  archetype: Archetype,
  stats: StatsFile,
): CompatibilityResult {
  // Layer 1 — manual blocklist (model-agnostic)
  const manualBlocked = MANUAL_PROVIDER_ARCHETYPE_BLOCKLIST[archetype]?.includes(provider);
  if (manualBlocked) {
    return {
      compatible: false,
      source: 'manual',
      reason: `${provider} is on the manual blocklist for ${archetype}`,
    };
  }
  // Layer 2 — auto-disable (model-specific)
  const key = cellKey(provider, model, archetype);
  const autoEntry = stats.blocklist[key];
  if (autoEntry) {
    return {
      compatible: false,
      source: 'auto',
      reason: autoEntry.reason,
    };
  }
  return { compatible: true };
}

// ---------------------------------------------------------------------------
// Stats update — called by the orchestrator after each batch
// ---------------------------------------------------------------------------

export interface BatchOutcome {
  provider: ChatProviderName;
  model: string;
  archetype: Archetype;
  questionsGenerated: number;
  survivors: number;
  /** Per-question quality scores, in any order. May be empty if no quality stage ran. */
  qualityScores?: number[];
  /** Per-question fun scores, in any order. */
  funScores?: number[];
  /** Number of questions the quality stage rejected (separate from dedup). */
  qualityRejects: number;
}

/**
 * Update the persistent (provider, model, archetype) stats with this batch's
 * outcome, and auto-block the cell if it now crosses the thresholds.
 *
 * Returns the blocklist entry if the cell was JUST auto-blocked by this call
 * (so the orchestrator can log it), otherwise null.
 */
export async function recordBatchOutcome(outcome: BatchOutcome): Promise<BlocklistEntry | null> {
  const s = await loadProviderArchetypeStats();
  const key = cellKey(outcome.provider, outcome.model, outcome.archetype);
  const cell = s.stats[key] ?? {
    questionsAssessed: 0,
    survivors: 0,
    qualityScoreSum: 0,
    qualityScoreCount: 0,
    funScoreSum: 0,
    funScoreCount: 0,
    qualityRejects: 0,
    lastUpdated: new Date(0).toISOString(),
  };

  cell.questionsAssessed += outcome.questionsGenerated;
  cell.survivors += outcome.survivors;
  cell.qualityRejects += outcome.qualityRejects;
  if (outcome.qualityScores && outcome.qualityScores.length > 0) {
    cell.qualityScoreSum += outcome.qualityScores.reduce((a, b) => a + b, 0);
    cell.qualityScoreCount += outcome.qualityScores.length;
  }
  if (outcome.funScores && outcome.funScores.length > 0) {
    cell.funScoreSum += outcome.funScores.reduce((a, b) => a + b, 0);
    cell.funScoreCount += outcome.funScores.length;
  }
  cell.lastUpdated = new Date().toISOString();
  s.stats[key] = cell;
  s.lastUpdated = cell.lastUpdated;

  let newlyBlocked: BlocklistEntry | null = null;
  if (!s.blocklist[key] && cell.questionsAssessed >= MIN_QUESTIONS_BEFORE_AUTO_BLOCK) {
    const survRate = cell.survivors / cell.questionsAssessed;
    const avgQual = cell.qualityScoreCount > 0 ? cell.qualityScoreSum / cell.qualityScoreCount : null;
    const failsSurvival = survRate < AUTO_BLOCK_SURVIVAL_FLOOR;
    const failsQuality = avgQual !== null && avgQual < AUTO_BLOCK_QUALITY_FLOOR;
    if (failsSurvival || failsQuality) {
      const reasons: string[] = [];
      if (failsSurvival) reasons.push(`${(survRate * 100).toFixed(0)}% survival across ${cell.questionsAssessed} questions`);
      if (failsQuality) reasons.push(`avg quality ${avgQual!.toFixed(2)} (floor ${AUTO_BLOCK_QUALITY_FLOOR})`);
      newlyBlocked = {
        blockedAt: cell.lastUpdated,
        reason: reasons.join('; '),
        questionsAssessed: cell.questionsAssessed,
        survivors: cell.survivors,
        survivalRate: survRate,
        avgQualityScore: avgQual,
      };
      s.blocklist[key] = newlyBlocked;
    }
  }

  await saveStats(s);
  return newlyBlocked;
}

// ---------------------------------------------------------------------------
// Manual operations (CLI helpers)
// ---------------------------------------------------------------------------

/** Remove a single auto-block entry — useful when you want to retest a cell
 *  after fixing the underlying problem (different prompt, etc.). */
export async function clearAutoBlock(key: string): Promise<boolean> {
  const s = await loadProviderArchetypeStats();
  if (!s.blocklist[key]) return false;
  delete s.blocklist[key];
  await saveStats(s);
  return true;
}

/** Wipe ALL accumulated stats + the auto-blocklist. Used when starting over. */
export async function resetAllStats(): Promise<void> {
  await saveStats({ ...EMPTY_STATS_FILE, stats: {}, blocklist: {} });
}

export interface CellSummary {
  key: string;
  provider: string;
  model: string;
  archetype: string;
  questionsAssessed: number;
  survivors: number;
  survivalRate: number;
  avgQualityScore: number | null;
  avgFunScore: number | null;
  qualityRejects: number;
  blocked: boolean;
  blockReason: string | null;
}

/** Flatten the stats file into a sorted list for human display. */
export function summarizeStats(s: StatsFile): CellSummary[] {
  const out: CellSummary[] = [];
  for (const [key, cell] of Object.entries(s.stats)) {
    const [provider, model, archetype] = key.split('|');
    const blocked = Boolean(s.blocklist[key]);
    out.push({
      key,
      provider,
      model,
      archetype,
      questionsAssessed: cell.questionsAssessed,
      survivors: cell.survivors,
      survivalRate: cell.questionsAssessed > 0 ? cell.survivors / cell.questionsAssessed : 0,
      avgQualityScore: cell.qualityScoreCount > 0 ? cell.qualityScoreSum / cell.qualityScoreCount : null,
      avgFunScore: cell.funScoreCount > 0 ? cell.funScoreSum / cell.funScoreCount : null,
      qualityRejects: cell.qualityRejects,
      blocked,
      blockReason: blocked ? s.blocklist[key].reason : null,
    });
  }
  out.sort((a, b) => b.questionsAssessed - a.questionsAssessed);
  return out;
}
