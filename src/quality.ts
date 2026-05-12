import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pLimit from 'p-limit';
import ora from 'ora';
import { DATA_DIR, PROMPTS_DIR } from './config.js';
import { JsonlWriter, readJsonl, todayStamp } from './utils/jsonl.js';
import { getChatProvider } from './providers/factory.js';
import { QualityAssessmentSchema, type Question, type QualityDecision } from './schema.js';
import type { ChatProviderName } from './providers/types.js';

export interface QualityCheckOptions {
  inputPath: string;
  /** All questions are written here with their qualityAssessment + qualityStatus. */
  outputPath?: string;
  /** Optional split outputs — questions written here filtered by decision. */
  keepPath?: string;
  reviewPath?: string;
  rejectPath?: string;
  /** Override provider; default is whatever PROVIDER_GENERATOR resolves to. Recommend 'deepseek'. */
  provider?: ChatProviderName;
  /** Concurrency. */
  concurrency?: number;
  /**
   * A/B comparison: if set, also run quality assessment through this
   * alternate DeepSeek model and store the result on each question's
   * `qualityAssessmentAlt` field. The PRIMARY model (resolved via
   * DEEPSEEK_QUALITY_MODEL or the provider default) keeps executive decision
   * power — only its assessment drives keep/review/reject routing. The alt
   * is stored for offline comparison via the `quality-ab-report` CLI.
   *
   * Typical use: set primary = deepseek-v4-pro (current default), alt =
   * deepseek-chat (V4-Flash) to measure where the cheap assessor diverges
   * from the strict assessor before deciding whether to revert the upgrade.
   *
   * Failures of the alt call do NOT fail the question — primary's decision
   * always lands. Alt parse failures just leave the field undefined.
   */
  altModel?: string;
}

const MAX_RETRIES = 3;
const DEFAULT_CONCURRENCY = 5;

export async function checkQuality(opts: QualityCheckOptions): Promise<{
  total: number;
  decisionCounts: Record<QualityDecision, number>;
  outputPath: string;
}> {
  const systemPrompt = await loadQualityPrompt();
  const provider = getChatProvider(opts.provider);

  const outputPath =
    opts.outputPath ?? path.join(DATA_DIR, `quality-checked-${todayStamp()}.jsonl`);
  const keepPath =
    opts.keepPath ?? path.join(DATA_DIR, `quality-keep-${todayStamp()}.jsonl`);
  const reviewPath =
    opts.reviewPath ?? path.join(DATA_DIR, `quality-review-${todayStamp()}.jsonl`);
  const rejectPath =
    opts.rejectPath ?? path.join(DATA_DIR, `quality-reject-${todayStamp()}.jsonl`);

  const allWriter = await JsonlWriter.open(outputPath);
  const keepWriter = await JsonlWriter.open(keepPath);
  const reviewWriter = await JsonlWriter.open(reviewPath);
  const rejectWriter = await JsonlWriter.open(rejectPath);

  const decisionCounts: Record<QualityDecision, number> = { keep: 0, review: 0, reject: 0 };
  let total = 0;
  let errored = 0;

  const limit = pLimit(opts.concurrency ?? DEFAULT_CONCURRENCY);
  const spinner = ora(`Quality-checking via ${provider.name}...`).start();

  const tasks: Promise<void>[] = [];

  for await (const q of readJsonl<Question>(opts.inputPath)) {
    total += 1;
    const idx = total;
    tasks.push(
      limit(async () => {
        try {
          // Run primary + alt in parallel when alt is configured.
          // The alt failure is silently ignored (not allowed to fail the
          // primary's decision) — we want comparison data when it's
          // available without coupling reliability to it.
          const primaryPromise = assessOneWithRetry(provider, systemPrompt, q);
          const altPromise = opts.altModel
            ? assessOneWithRetry(provider, systemPrompt, q, opts.altModel).catch((e) => {
                process.stderr.write(`\n[quality ${idx} alt] failed: ${(e as Error).message}\n`);
                return undefined;
              })
            : Promise.resolve(undefined);

          const [assessment, altAssessment] = await Promise.all([primaryPromise, altPromise]);

          const enriched: Question = {
            ...q,
            qualityProvider: provider.name as 'anthropic' | 'deepseek' | 'google',
            qualityAssessment: assessment,
            qualityStatus: assessment.decision,
            ...(altAssessment ? { qualityAssessmentAlt: altAssessment, qualityAltModel: opts.altModel } : {}),
          };
          decisionCounts[assessment.decision] += 1;
          await allWriter.write(enriched);
          if (assessment.decision === 'keep') await keepWriter.write(enriched);
          else if (assessment.decision === 'review') await reviewWriter.write(enriched);
          else await rejectWriter.write(enriched);
          spinner.text =
            `Checked ${total} (keep ${decisionCounts.keep} / review ${decisionCounts.review} / reject ${decisionCounts.reject})`;
        } catch (err) {
          errored += 1;
          process.stderr.write(
            `\n[quality ${idx}] failed after retries: ${(err as Error).message}\n`,
          );
        }
      }),
    );
  }

  await Promise.all(tasks);
  await Promise.all([
    allWriter.close(),
    keepWriter.close(),
    reviewWriter.close(),
    rejectWriter.close(),
  ]);

  spinner.succeed(
    `Quality check complete: keep ${decisionCounts.keep}, review ${decisionCounts.review}, reject ${decisionCounts.reject}` +
      (errored ? ` (${errored} errored)` : '') +
      `\n  all      → ${outputPath}` +
      `\n  keep     → ${keepPath}` +
      `\n  review   → ${reviewPath}` +
      `\n  reject   → ${rejectPath}`,
  );

  return { total, decisionCounts, outputPath };
}

async function assessOneWithRetry(
  provider: ReturnType<typeof getChatProvider>,
  systemPrompt: string,
  q: Question,
  /** Override the quality model — used by A/B mode to call the alt model
   *  while the same call signature stays in the primary path. */
  modelOverride?: string,
): Promise<import('./schema.js').QualityAssessment> {
  const archetypeRules = await loadArchetypeRules(q.archetype);
  const userPrompt = buildUserPrompt(q, archetypeRules);

  // For DeepSeek specifically, use the dedicated quality model (default
  // deepseek-v4-pro) instead of whatever's configured for generation.
  // Other providers fall back to their default generator model.
  // The A/B alt path passes its own modelOverride and bypasses this default.
  const qualityModelOverride =
    modelOverride
      ?? (provider.name === 'deepseek' ? (await import('./config.js')).config.DEEPSEEK_QUALITY_MODEL : undefined);

  let lastError: Error | undefined;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const result = await provider.generate(systemPrompt, userPrompt, {
        // 4096, not 512 — the quality JSON output is small (~150 tokens) but
        // thinking-class models (deepseek-v4-pro, kimi-k2.x) burn most of
        // their budget on internal reasoning before any visible output. At
        // 512 v4-pro returned empty content for every assessor call (all 23
        // batches of the 2026-05-03 18:27 run rejected 100% of generated
        // questions). The extra ceiling costs ~$0 on non-thinking models
        // (they still only emit ~150 tokens of visible output) but rescues
        // thinking models entirely.
        maxTokens: 4096,
        temperature: 0.0,
        jsonMode: true,
        modelOverride: qualityModelOverride,
      });
      const parsed = parseJson(result.content);
      return QualityAssessmentSchema.parse(parsed);
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw lastError ?? new Error('assessOneWithRetry exhausted');
}

/**
 * Per-archetype rule cache. The quality assessor needs the archetype-specific
 * rules (loaded from `src/prompts/archetypes/<archetype>.txt`) to grade
 * archetype-specific failures — e.g., a "comparison" archetype question where
 * magnitudes are within 10% of each other should fail qualityScore even if
 * other craft is fine. Without these rules, the assessor judges only the
 * generic rubric and misses archetype violations.
 */
const archetypeRulesCache = new Map<string, string>();
async function loadArchetypeRules(archetype: string): Promise<string> {
  if (archetypeRulesCache.has(archetype)) {
    return archetypeRulesCache.get(archetype)!;
  }
  try {
    const text = await readFile(
      path.join(PROMPTS_DIR, 'archetypes', `${archetype}.txt`),
      'utf8',
    );
    archetypeRulesCache.set(archetype, text);
    return text;
  } catch {
    archetypeRulesCache.set(archetype, '');
    return '';
  }
}

/**
 * Per-category accessibility hints — different domains have different
 * floors for "specialist" vs "enthusiast" so the assessor's accessibilityTier
 * dimension shouldn't be uniform across categories. Anything not listed
 * falls back to the generic rubric in quality.txt.
 */
const CATEGORY_HINTS: Record<string, string> = {
  Science:
    'For Science: an enthusiast-tier question can still be fun if the mechanism is surprising. Specialist = requires biochem pathways, named protein subtypes, derivations.',
  History:
    'For History: enthusiast = famous events + cause/effect. Specialist = exact regnal years, named treaties, obscure battles. Avoid politically-loaded recent history.',
  Geography:
    'For Geography: enthusiast = surprising superlatives, exclaves, climate weirdness. Specialist = obscure peaks/coordinates, named ranges nobody has heard of.',
  'Pop Culture':
    'For Pop Culture: must be widely accessible. Specialist = obscure fandom trivia, exact box-office numbers, niche subreddit drama.',
  Sports:
    'For Sports: rules + history + iconic-moments are accessible. Specialist = athlete-personal-statistics, regional records, league bylaws.',
  Language:
    'For Language: etymology and idioms are fun if the origin is surprising; vocab-context risks being dull. Specialist = Proto-Indo-European reconstructions, IPA charts.',
  Tech:
    'For Tech: concepts and origin stories are accessible. Specialist = implementation details, named algorithms beyond the famous, CVE numbers.',
  'Food & Drink':
    'For Food: cooking science and food origins are accessible. Specialist = enzyme names, biochem pathways, regional micro-variations.',
  Arts:
    'For Arts: backstories of famous works are accessible. Specialist = art-history-theory jargon, named movements, auction prices.',
  General:
    'For General: must be widely accessible. Specialist = obscure number-theory, set theory, niche unit-of-measurement minutiae.',
};

function buildUserPrompt(q: Question, archetypeRules: string): string {
  const correct = q.answers[q.correctIndex];
  const distractors = q.answers
    .map((a, i) => (i === q.correctIndex ? null : a))
    .filter((x): x is string => x !== null);
  const categoryHint = CATEGORY_HINTS[q.category] ?? '';

  const sections: string[] = [
    `Category: ${q.category}${q.subcategory ? ` / ${q.subcategory}` : ''}`,
    `Archetype: ${q.archetype}`,
    `Stated difficulty: ${q.difficulty}`,
    ``,
  ];

  if (categoryHint) {
    sections.push(`CATEGORY CONTEXT — adjust accessibilityTier expectations accordingly:`);
    sections.push(categoryHint);
    sections.push(``);
  }

  if (archetypeRules) {
    sections.push(`ARCHETYPE-SPECIFIC RULES — the question was generated under THESE constraints. Your qualityScore must reflect whether the rules were followed:`);
    sections.push(`---`);
    sections.push(archetypeRules.trim());
    sections.push(`---`);
    sections.push(``);
  }

  sections.push(
    `Question: ${q.question}`,
    `Correct answer: ${correct}`,
    `Distractors:`,
    ...distractors.map((d) => `  - ${d}`),
    ``,
    `Explanation: ${q.explanation}`,
    ``,
    `Assess this question per the GENERIC RUBRIC (in your system prompt) AND the ARCHETYPE-SPECIFIC RULES above. A question that violates archetype rules should score qualityScore ≤ 2 regardless of other craft, and likely decision = reject. Output ONLY the JSON object.`,
  );

  return sections.join('\n');
}

function parseJson(raw: string): unknown {
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

async function loadQualityPrompt(): Promise<string> {
  return readFile(path.join(PROMPTS_DIR, 'quality.txt'), 'utf8');
}
