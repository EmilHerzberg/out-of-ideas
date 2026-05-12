import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import ora from 'ora';
import { PROMPTS_DIR, DATA_DIR } from './config.js';
import { loadSeeds, saveSeeds, SEEDS_PATH } from './seeds.js';
import { SeedSchema, type Seed } from './schema.js';
import { getChatProvider, getChatProviderEntry } from './providers/factory.js';
import type { ChatProviderName } from './providers/types.js';

/**
 * Seed Verifier — third AI layer that gatekeeps proposed seeds before they
 * enter `seeds/seeds.jsonl`.
 *
 * The evolver proposes new seeds when an existing seed saturates. Without
 * this verifier, those proposals would either need manual review (slow) or
 * auto-merge (risks polluting the seed catalog). With this verifier, an LLM
 * acts as a gatekeeper and decides KEEP / EDIT / REMOVE per proposal,
 * applying the decision directly and logging WHY.
 *
 * Privileges (per the user's design):
 *   - KEEP: append the seed as-is to seeds.jsonl
 *   - EDIT: append the model's corrected version
 *   - REMOVE: don't append; log the rejection
 *
 * Models:
 *   - Primary: Anthropic Claude Opus 4.7 (best judgment quality)
 *   - Fallback: Google Gemini 3.1 Pro (when Anthropic is unavailable / errors)
 */

const VerifierDecisionSchema = z.object({
  proposalId: z.string(),
  decision: z.enum(['keep', 'edit', 'remove']),
  reasoning: z.string().min(5).max(2000),
  // Claude Opus emits `editedSeed: null` (not `undefined`) for keep/remove
  // decisions — accept both shapes, normalize to optional downstream.
  editedSeed: SeedSchema.nullable().optional(),
});

const VerifierOutputSchema = z.object({
  decisions: z.array(VerifierDecisionSchema),
});

export interface VerifySeedsOptions {
  /** Path to a seeds-proposed-*.json file (the format the evolver writes). */
  proposalsPath: string;
  /** Where to write the JSONL audit log. Defaults to `data/seed-verifier-log.jsonl`. */
  logPath?: string;
  /** Override the primary verifier provider (default 'anthropic'). */
  primaryProvider?: ChatProviderName;
  /** Override the fallback (default 'google'). */
  fallbackProvider?: ChatProviderName;
}

export interface VerifySeedsResult {
  total: number;
  kept: number;
  edited: number;
  removed: number;
  modelUsed: string;
  fallbackUsed: boolean;
  logPath: string;
  seedsAdded: string[];
}

interface ProposalEntry {
  adjacentTo: string;
  suggested: Array<{
    id: string;
    category: string;
    topic: string;
    angle: string;
    depthCap: string;
    exampleStems?: string[];
    bannedAngles?: string[];
  }>;
}
interface ProposalsFile {
  proposals: ProposalEntry[];
}

export async function verifySeeds(opts: VerifySeedsOptions): Promise<VerifySeedsResult> {
  const spinner = ora('Loading proposals + existing seeds...').start();

  // ----- Load inputs -----------------------------------------------------
  const proposalsRaw = JSON.parse(await readFile(opts.proposalsPath, 'utf8')) as ProposalsFile;
  const allProposed = proposalsRaw.proposals.flatMap((entry) => entry.suggested);

  // Deduplicate proposals by id (the evolver sometimes proposes the same id
  // from two different source seeds — keep the first).
  const seenIds = new Set<string>();
  const proposed: typeof allProposed = [];
  for (const p of allProposed) {
    if (seenIds.has(p.id)) continue;
    seenIds.add(p.id);
    proposed.push(p);
  }

  if (proposed.length === 0) {
    spinner.warn('No proposed seeds in file — nothing to verify.');
    return {
      total: 0,
      kept: 0,
      edited: 0,
      removed: 0,
      modelUsed: '(none)',
      fallbackUsed: false,
      logPath: opts.logPath ?? path.join(DATA_DIR, 'seed-verifier-log.jsonl'),
      seedsAdded: [],
    };
  }

  const existingSeeds = await loadSeeds();
  const systemPrompt = await readFile(path.join(PROMPTS_DIR, 'seed-verifier.txt'), 'utf8');
  const userPrompt = buildUserPrompt(existingSeeds, proposed);

  // ----- Call verifier with primary → fallback ---------------------------
  const primaryName = opts.primaryProvider ?? 'anthropic';
  const fallbackName = opts.fallbackProvider ?? 'google';
  const primaryEntry = getChatProviderEntry(primaryName);
  const fallbackEntry = getChatProviderEntry(fallbackName);
  const primaryAvailable = primaryEntry?.isAvailable() ?? false;
  const fallbackAvailable = fallbackEntry?.isAvailable() ?? false;

  if (!primaryAvailable && !fallbackAvailable) {
    spinner.fail(
      `No verifier provider configured. Need either ${primaryName} or ${fallbackName} credentials in .env.`,
    );
    throw new Error('No verifier provider available');
  }

  spinner.text = `Calling ${primaryAvailable ? primaryName : fallbackName} on ${proposed.length} proposed seeds...`;

  let response: { content: string; provider: string; model: string };
  let fallbackUsed = false;
  if (primaryAvailable) {
    try {
      const provider = getChatProvider(primaryName);
      const result = await provider.generate(systemPrompt, userPrompt, {
        maxTokens: 8000,
        temperature: 0.3,
        jsonMode: true,
      });
      response = { content: result.content, provider: result.provider, model: result.model };
    } catch (err) {
      if (!fallbackAvailable) {
        spinner.fail(`Primary (${primaryName}) failed and no fallback available: ${(err as Error).message}`);
        throw err;
      }
      spinner.text = `Primary (${primaryName}) failed (${(err as Error).message.slice(0, 80)}…) → falling back to ${fallbackName}`;
      const provider = getChatProvider(fallbackName);
      const result = await provider.generate(systemPrompt, userPrompt, {
        maxTokens: 8000,
        temperature: 0.3,
        jsonMode: true,
      });
      response = { content: result.content, provider: result.provider, model: result.model };
      fallbackUsed = true;
    }
  } else {
    const provider = getChatProvider(fallbackName);
    const result = await provider.generate(systemPrompt, userPrompt, {
      maxTokens: 8000,
      temperature: 0.3,
      jsonMode: true,
    });
    response = { content: result.content, provider: result.provider, model: result.model };
    fallbackUsed = true; // fallback because primary wasn't configured
  }

  // ----- Parse decisions -------------------------------------------------
  let parsed: z.infer<typeof VerifierOutputSchema>;
  try {
    const stripped = response.content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`No JSON object in response: ${response.content.slice(0, 200)}`);
    parsed = VerifierOutputSchema.parse(JSON.parse(match[0]));
  } catch (err) {
    spinner.fail(`Failed to parse verifier output: ${(err as Error).message}`);
    throw err;
  }

  // ----- Apply decisions -------------------------------------------------
  const logPath = opts.logPath ?? path.join(DATA_DIR, 'seed-verifier-log.jsonl');
  await mkdir(path.dirname(logPath), { recursive: true });

  let kept = 0;
  let edited = 0;
  let removed = 0;
  const seedsAdded: string[] = [];
  const seedsToAdd: Seed[] = [];

  for (const decision of parsed.decisions) {
    const proposal = proposed.find((p) => p.id === decision.proposalId);
    if (!proposal) {
      // Verifier hallucinated an id we didn't propose — log and skip.
      await appendFile(
        logPath,
        JSON.stringify({
          ts: new Date().toISOString(),
          proposalId: decision.proposalId,
          decision: 'skipped',
          reasoning: 'Verifier returned a proposalId that was not in the input',
          model: response.model,
          provider: response.provider,
          fallbackUsed,
        }) + '\n',
        'utf8',
      );
      continue;
    }

    const logEntry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      proposalId: decision.proposalId,
      decision: decision.decision,
      reasoning: decision.reasoning,
      model: response.model,
      provider: response.provider,
      fallbackUsed,
    };

    if (decision.decision === 'keep') {
      kept += 1;
      seedsAdded.push(proposal.id);
      seedsToAdd.push(scaffoldFromProposal(proposal));
    } else if (decision.decision === 'edit' && decision.editedSeed) {
      edited += 1;
      seedsAdded.push(decision.editedSeed.id);
      seedsToAdd.push(decision.editedSeed);
      logEntry.editedSeed = decision.editedSeed;
    } else if (decision.decision === 'edit' && !decision.editedSeed) {
      // Decision was edit but no edited seed — treat as remove with note.
      removed += 1;
      logEntry.decision = 'remove';
      logEntry.reasoning = `(originally 'edit' but verifier returned no editedSeed) ${decision.reasoning}`;
    } else {
      removed += 1;
    }

    await appendFile(logPath, JSON.stringify(logEntry) + '\n', 'utf8');
  }

  // ----- Append approved seeds to seeds.jsonl ----------------------------
  if (seedsToAdd.length > 0) {
    // Skip duplicates of existing seed ids — never overwrite.
    const existingIds = new Set(existingSeeds.map((s) => s.id));
    const newOnes = seedsToAdd.filter((s) => !existingIds.has(s.id));
    const skipped = seedsToAdd.length - newOnes.length;
    if (newOnes.length > 0) {
      const merged = [...existingSeeds, ...newOnes];
      await saveSeeds(merged);
    }
    if (skipped > 0) {
      await appendFile(
        logPath,
        JSON.stringify({
          ts: new Date().toISOString(),
          decision: 'duplicate-id-skipped',
          reasoning: `${skipped} approved seed(s) had ids that already existed in seeds.jsonl — not appended to avoid overwrite.`,
          model: response.model,
          provider: response.provider,
          fallbackUsed,
        }) + '\n',
        'utf8',
      );
    }
  }

  spinner.succeed(
    `Verifier (${response.model}${fallbackUsed ? ' — FALLBACK' : ''}) decided on ${parsed.decisions.length} proposals: keep ${kept}, edit ${edited}, remove ${removed}. Log → ${logPath}`,
  );

  return {
    total: parsed.decisions.length,
    kept,
    edited,
    removed,
    modelUsed: response.model,
    fallbackUsed,
    logPath,
    seedsAdded,
  };
}

/** Build the user prompt — gives the verifier ONLY the existing seeds in the
 *  same categories as the proposals (overlap detection only matters within
 *  category) plus the list of proposed seeds to evaluate. Filtering by
 *  category cuts injected-token cost ~10× when the proposals span only 1-2
 *  categories — typical for evolver ticks where one parent seed produces
 *  N proposals all in the same category. */
function buildUserPrompt(existing: Seed[], proposed: Array<{ id: string; category: string; topic: string; angle: string; depthCap: string; exampleStems?: string[]; bannedAngles?: string[] }>): string {
  // Identify categories mentioned by any proposal — those are the only ones
  // for which overlap detection is meaningful.
  const proposalCategories = new Set(proposed.map((p) => p.category));
  const relevantExisting = existing.filter((s) => proposalCategories.has(s.category));

  const byCategory = new Map<string, Seed[]>();
  for (const s of relevantExisting) {
    if (!byCategory.has(s.category)) byCategory.set(s.category, []);
    byCategory.get(s.category)!.push(s);
  }

  const sections: string[] = [];
  sections.push('# EXISTING SEED CATALOG (filtered to proposal categories)');
  sections.push('');
  sections.push(`Showing ${relevantExisting.length} of ${existing.length} seeds — only those in categories that the proposals also use, since overlap detection only matters within-category. Reject any proposal that substantially overlaps with these.`);
  sections.push('');
  for (const [cat, seeds] of [...byCategory.entries()].sort()) {
    sections.push(`## ${cat} (${seeds.length})`);
    for (const s of seeds) {
      sections.push(`- **${s.id}** (${s.status}) — ${s.topic}: ${s.angle}`);
    }
    sections.push('');
  }

  sections.push('# PROPOSED SEEDS TO EVALUATE');
  sections.push('');
  sections.push(`The evolver proposes the following ${proposed.length} new seeds. Decide KEEP / EDIT / REMOVE for each.`);
  sections.push('');
  sections.push('```json');
  sections.push(JSON.stringify(proposed, null, 2));
  sections.push('```');
  sections.push('');
  sections.push('Output a single JSON object with key "decisions" — one entry per proposalId, in the same order. Do NOT include markdown fences in your output.');

  return sections.join('\n');
}

/** Convert a raw proposal into a full seed object with default scaffolding. */
function scaffoldFromProposal(proposal: { id: string; category: string; topic: string; angle: string; depthCap: string; exampleStems?: string[]; bannedAngles?: string[] }): Seed {
  return SeedSchema.parse({
    id: proposal.id,
    category: proposal.category,
    topic: proposal.topic,
    angle: proposal.angle,
    depthCap: proposal.depthCap,
    exampleStems: proposal.exampleStems ?? [],
    bannedAngles: proposal.bannedAngles ?? [],
    stats: {
      timesUsed: 0,
      avgFunScore: null,
      avgQualityScore: null,
      avgLearningValue: null,
      rejectRate: null,
      duplicatePairsProduced: 0,
      questionsAssessed: 0,
    },
    weight: 1,
    lastUsedAt: null,
    status: 'active',
  });
}

void SEEDS_PATH; // re-export-friendly side effect
