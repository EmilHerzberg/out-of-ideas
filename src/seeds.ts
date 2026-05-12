import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT } from './config.js';
import { SeedSchema, type Seed } from './schema.js';

export const SEEDS_PATH = path.join(PROJECT_ROOT, 'seeds', 'seeds.jsonl');

export async function loadSeeds(filePath = SEEDS_PATH): Promise<Seed[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  return lines.map((line, idx) => {
    try {
      return SeedSchema.parse(JSON.parse(line));
    } catch (err) {
      throw new Error(`seeds.jsonl line ${idx + 1}: ${(err as Error).message}`);
    }
  });
}

export async function saveSeeds(seeds: Seed[], filePath = SEEDS_PATH): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const content = seeds.map((s) => JSON.stringify(s)).join('\n') + '\n';
  await writeFile(filePath, content, 'utf8');
}

/**
 * Pick one active seed for a given category, weighted by inverse times-used.
 * Returns null if no active seed matches.
 *
 * Weight formula: `seed.weight / (1 + stats.timesUsed)`. This biases toward
 * unused seeds without ever zeroing out a popular one — same seed can still be
 * picked occasionally even after heavy use.
 *
 * NOTE: this is per-call independent sampling. For batch generation, prefer
 * `makeBatchSeedSampler()` below — it guarantees within-batch spread (every
 * seed is hit at least once before any seed repeats).
 */
export function sampleSeed(seeds: Seed[], category: string): Seed | null {
  const candidates = seeds.filter(
    (s) => s.status === 'active' && s.category.toLowerCase() === category.toLowerCase(),
  );
  if (candidates.length === 0) return null;

  const weighted = candidates.map((s) => ({
    seed: s,
    w: s.weight / (1 + s.stats.timesUsed),
  }));
  const total = weighted.reduce((acc, x) => acc + x.w, 0);
  if (total <= 0) return candidates[0];

  let r = Math.random() * total;
  for (const { seed, w } of weighted) {
    r -= w;
    if (r <= 0) return seed;
  }
  return weighted[weighted.length - 1].seed;
}

/**
 * Build a stateful sampler for ONE batch of generation calls.
 *
 * Within the batch, every active seed in the category is used at least once
 * before any seed is sampled a second time — eliminates the "5/0/0/0" worst
 * case that pure independent random sampling produces on small batches.
 * Once the cycle is exhausted, a fresh cycle starts (still inverse-weighted
 * by historical timesUsed inside each cycle).
 */
export function makeBatchSeedSampler(
  seeds: Seed[],
  category: string,
): () => Seed | null {
  const candidates = seeds.filter(
    (s) => s.status === 'active' && s.category.toLowerCase() === category.toLowerCase(),
  );
  if (candidates.length === 0) return () => null;

  const usedThisCycle = new Set<string>();

  return function nextSeed(): Seed | null {
    let pool = candidates.filter((s) => !usedThisCycle.has(s.id));
    if (pool.length === 0) {
      usedThisCycle.clear();
      pool = candidates;
    }

    const weighted = pool.map((s) => ({
      seed: s,
      w: s.weight / (1 + s.stats.timesUsed),
    }));
    const total = weighted.reduce((acc, x) => acc + x.w, 0);

    let chosen: Seed;
    if (total <= 0) {
      chosen = pool[0];
    } else {
      let r = Math.random() * total;
      let pick: Seed | null = null;
      for (const { seed, w } of weighted) {
        r -= w;
        if (r <= 0) {
          pick = seed;
          break;
        }
      }
      chosen = pick ?? weighted[weighted.length - 1].seed;
    }
    usedThisCycle.add(chosen.id);
    return chosen;
  };
}

/** Mutates `seed` in-place to record one use. */
export function markSeedUsed(seed: Seed): void {
  seed.stats.timesUsed += 1;
  seed.lastUsedAt = new Date().toISOString();
}

/**
 * Render a seed's topic/angle/examples/banned-angles as a section to inject
 * into the user prompt sent to the generator.
 */
export function buildSeedPromptSection(seed: Seed): string {
  const parts: string[] = [];
  parts.push(`Sub-topic: ${seed.topic} — ${seed.angle}`);
  parts.push(
    `Stay at ${seed.depthCap} level. The audience is general consumers, not specialists.`,
  );
  if (seed.exampleStems.length > 0) {
    parts.push(
      `Example stems IN scope (use only as style anchors, do NOT copy verbatim or generate near-paraphrases): ` +
        seed.exampleStems.map((s) => `"${s}"`).join(', '),
    );
  }
  if (seed.bannedAngles.length > 0) {
    parts.push(
      `OUT OF SCOPE — do NOT generate questions that hinge on: ` +
        seed.bannedAngles.join(', ') +
        `. If the only natural question requires these, pick a different angle within the sub-topic instead.`,
    );
  }
  return parts.join('\n');
}
