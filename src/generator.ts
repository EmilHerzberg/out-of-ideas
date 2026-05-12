import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pLimit from 'p-limit';
import ora from 'ora';
import { PROMPTS_DIR, DATA_DIR } from './config.js';
import { JsonlWriter, todayStamp } from './utils/jsonl.js';
import { getChatProvider } from './providers/factory.js';
import { GeneratedQuestionSchema, type Question, type Archetype, type Seed } from './schema.js';
import type { ChatProviderName } from './providers/types.js';
import {
  loadSeeds,
  makeBatchSeedSampler,
  markSeedUsed,
  saveSeeds,
  buildSeedPromptSection,
} from './seeds.js';

const VALID_ARCHETYPES: Archetype[] = [
  'cause_effect',
  'comparison',
  'process_sequence',
  'misconception',
  'etymology',
  'estimation',
  'lateral_connection',
  'odd_one_out',
  'counterfactual',
  'vocab_context',
  'strategy',
  'spatial',
];

const MAX_RETRIES = 3;

export interface GenerateOptions {
  count: number;
  archetype: Archetype;
  category: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  provider?: ChatProviderName;
  outputPath?: string;
  /**
   * If false, skip the seed system entirely (legacy free-form generation).
   * Default: true. Falls back to free-form automatically if no active seeds
   * match the requested category.
   */
  useSeeds?: boolean;
  /** Pin a specific seed by id (overrides sampling). */
  seedId?: string;
}

export async function generateQuestions(opts: GenerateOptions): Promise<{
  written: number;
  rejected: number;
  outputPath: string;
}> {
  if (!VALID_ARCHETYPES.includes(opts.archetype)) {
    throw new Error(
      `Invalid archetype "${opts.archetype}". Must be one of: ${VALID_ARCHETYPES.join(', ')}`,
    );
  }

  const masterPrompt = await loadMasterPrompt();
  const archetypePrompt = await loadArchetypePrompt(opts.archetype);
  const systemPrompt = `${masterPrompt}\n\n---\n\n${archetypePrompt}`;

  const provider = getChatProvider(opts.provider);
  const outputPath =
    opts.outputPath ?? path.join(DATA_DIR, `generated-${todayStamp()}.jsonl`);
  const writer = await JsonlWriter.open(outputPath);

  // --- Seed setup ----------------------------------------------------------
  const useSeeds = opts.useSeeds !== false;
  const seeds = useSeeds ? await loadSeeds() : [];
  const pinnedSeed: Seed | null = opts.seedId
    ? (seeds.find((s) => s.id === opts.seedId) ?? null)
    : null;
  if (opts.seedId && !pinnedSeed) {
    throw new Error(`No seed with id "${opts.seedId}" found in seeds.jsonl`);
  }
  const activeMatching = seeds.filter(
    (s) => s.status === 'active' && s.category.toLowerCase() === opts.category.toLowerCase(),
  );
  const seedingMode = pinnedSeed
    ? `pinned seed "${pinnedSeed.id}"`
    : activeMatching.length > 0
      ? `stratified across ${activeMatching.length} active seeds in "${opts.category}"`
      : `no seeds for "${opts.category}" — falling back to free-form`;

  // Stratified batch sampler: each seed gets used at least once per cycle.
  const batchSampler = pinnedSeed
    ? () => pinnedSeed
    : useSeeds
      ? makeBatchSeedSampler(seeds, opts.category)
      : () => null;

  const limit = pLimit(5);
  const spinner = ora(
    `Generating ${opts.count} ${opts.archetype} questions in ${opts.category} via ${provider.name} (${seedingMode})...`,
  ).start();

  let rejected = 0;
  let completed = 0;

  const tasks = Array.from({ length: opts.count }, (_, i) =>
    limit(async () => {
      // Pick a seed for THIS call via the stratified batch sampler.
      const seed: Seed | null = batchSampler();
      if (seed) markSeedUsed(seed); // increment immediately so subsequent samples see it

      try {
        const question = await generateOneWithRetry(
          provider,
          systemPrompt,
          opts.category,
          opts.archetype,
          opts.difficulty,
          seed,
        );
        await writer.write(question);
        completed += 1;
        spinner.text = `Generated ${completed}/${opts.count} (rejected ${rejected})`;
      } catch (err) {
        rejected += 1;
        spinner.text = `Generated ${completed}/${opts.count} (rejected ${rejected})`;
        // Log to stderr so the spinner stays clean.
        process.stderr.write(`\n[gen ${i}] failed after retries: ${(err as Error).message}\n`);
      }
    }),
  );

  await Promise.all(tasks);
  await writer.close();

  // Persist updated seed stats (timesUsed, lastUsedAt) once at the end.
  if (useSeeds && seeds.length > 0) {
    await saveSeeds(seeds);
  }

  spinner.succeed(
    `Generation complete. Wrote ${writer.written()} questions (rejected ${rejected}) → ${outputPath}`,
  );

  return { written: writer.written(), rejected, outputPath };
}

async function generateOneWithRetry(
  provider: ReturnType<typeof getChatProvider>,
  systemPrompt: string,
  category: string,
  archetype: Archetype,
  difficulty?: 'easy' | 'medium' | 'hard',
  seed?: Seed | null,
): Promise<Question> {
  const userPrompt = buildUserPrompt(category, archetype, difficulty, seed);

  let lastError: Error | undefined;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const result = await provider.generate(systemPrompt, userPrompt, {
        // 4096 (was 2048) — misconception/etymology archetypes produce longer
        // explanations and Vertex was returning empty/truncated content under
        // the lower budget, manifesting as "No JSON object found" parse errors.
        maxTokens: 4096,
        temperature: 0.7,
        jsonMode: true,
      });
      const parsed = parseGeneratedJson(result.content);
      const validated = GeneratedQuestionSchema.parse(parsed);
      // Add pipeline metadata.
      const question: Question = {
        ...validated,
        id: randomUUID(),
        generationProvider: result.provider,
        generationModel: result.model,
        generatedAt: new Date().toISOString(),
        ...(seed ? { seedId: seed.id } : {}),
      };
      return question;
    } catch (err) {
      lastError = err as Error;
      // On the next attempt, give the model a stronger reminder.
    }
  }
  throw lastError ?? new Error('generateOneWithRetry exhausted');
}

function buildUserPrompt(
  category: string,
  archetype: Archetype,
  difficulty?: 'easy' | 'medium' | 'hard',
  seed?: Seed | null,
): string {
  const diffNote = difficulty
    ? `\nTarget difficulty: ${difficulty}.`
    : '\nPick a difficulty appropriate for the question (easy / medium / hard).';
  const seedSection = seed ? buildSeedPromptSection(seed) + '\n\n' : '';
  return [
    seedSection +
      `Category: ${category}`,
    `Archetype: ${archetype}`,
    diffNote,
    ``,
    `Generate ONE question matching this archetype's rules${seed ? ' AND the sub-topic / depth / banned-angle constraints above' : ''}. Apply the self-check rubric before responding. Return ONLY the JSON object.`,
  ].join('\n');
}

function parseGeneratedJson(raw: string): unknown {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`No JSON object found in response: ${raw.slice(0, 200)}`);
  }
  return JSON.parse(match[0]);
}

async function loadMasterPrompt(): Promise<string> {
  return readFile(path.join(PROMPTS_DIR, 'master.txt'), 'utf8');
}

async function loadArchetypePrompt(archetype: Archetype): Promise<string> {
  if (archetype === 'unsalvageable') {
    throw new Error('Cannot generate questions with archetype "unsalvageable"');
  }
  return readFile(
    path.join(PROMPTS_DIR, 'archetypes', `${archetype}.txt`),
    'utf8',
  );
}
