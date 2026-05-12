/**
 * Zod schemas mirroring spec §11.4 + the enrichment-output shape used by E24.
 * Output of every step in the pipeline gets validated against one of these.
 */

import { z } from 'zod';

export const ArchetypeEnum = z.enum([
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
  'unsalvageable',
]);
export type Archetype = z.infer<typeof ArchetypeEnum>;

export const DifficultyEnum = z.enum(['easy', 'medium', 'hard']);
export type Difficulty = z.infer<typeof DifficultyEnum>;

export const QualityRatingEnum = z.enum(['good', 'low_priority', 'broken']);
export type QualityRating = z.infer<typeof QualityRatingEnum>;

export const AccessibilityTierEnum = z.enum(['beginner', 'enthusiast', 'specialist']);
export type AccessibilityTier = z.infer<typeof AccessibilityTierEnum>;

export const QualityDecisionEnum = z.enum(['keep', 'review', 'reject']);
export type QualityDecision = z.infer<typeof QualityDecisionEnum>;

const Score1to5 = z.number().int().min(1).max(5);

/** Output shape that the quality assessor must return. */
export const QualityAssessmentSchema = z.object({
  accessibilityTier: AccessibilityTierEnum,
  funScore: Score1to5,
  qualityScore: Score1to5,
  learningValue: Score1to5,
  decision: QualityDecisionEnum,
  reasoning: z.string().min(5).max(1200),
});
export type QualityAssessment = z.infer<typeof QualityAssessmentSchema>;

/**
 * The default-repertoire generated-question shape.
 * Matches spec §11.4 with small additions: `qualityRating` (from enrichment) and
 * provider-attribution fields (added by pipeline runners).
 */
export const QuestionSchema = z.object({
  id: z.string(),
  question: z.string().min(10).max(500),
  answers: z.array(z.string()).length(4),
  correctIndex: z.number().int().min(0).max(3),
  category: z.string(),
  subcategory: z.string().optional(),
  archetype: ArchetypeEnum,
  difficulty: DifficultyEnum,
  explanation: z.string().min(5).max(300),
  sourceLink: z.string().url().optional(),
  tags: z.array(z.string()).optional(),
  ttl: z.string().nullable().optional(),
  qualityRating: QualityRatingEnum.optional(),
  // Pipeline metadata (set by runners, not by AI):
  generationProvider: z.enum(['anthropic', 'deepseek', 'google', 'openai', 'dashscope', 'vertex-mistral', 'vertex-ai21', 'vertex-grok', 'zai', 'moonshot', 'byteplus', 'openrouter-qwen', 'openrouter-minimax', 'openrouter-ernie', 'openrouter-doubao']).optional(),
  /** Specific model id (e.g. "claude-opus-4-7", "gpt-5", "gemini-3.1-pro-preview").
   *  Set by the generator when the provider returns it. Lets the evolver compare
   *  model performance, not just provider performance. */
  generationModel: z.string().optional(),
  enrichmentProvider: z.enum(['anthropic', 'deepseek', 'google', 'openai', 'dashscope', 'vertex-mistral', 'vertex-ai21', 'vertex-grok', 'zai', 'moonshot', 'byteplus', 'openrouter-qwen', 'openrouter-minimax', 'openrouter-ernie', 'openrouter-doubao']).optional(),
  verificationProvider: z.enum(['perplexity', 'dashscope', 'google']).optional(),
  verificationStatus: z.enum(['passed', 'failed', 'skipped']).optional(),
  embeddingProvider: z.enum(['voyage', 'dashscope', 'google']).optional(),
  embedding: z.array(z.number()).optional(),
  relatedTo: z.string().optional(),
  keepWithLowPriority: z.boolean().optional(),
  generatedAt: z.string().optional(),
  // Quality-check stage (between generate and verify):
  qualityProvider: z.enum(['anthropic', 'deepseek', 'google', 'openai', 'dashscope', 'vertex-mistral', 'vertex-ai21', 'vertex-grok', 'zai', 'moonshot', 'byteplus', 'openrouter-qwen', 'openrouter-minimax', 'openrouter-ernie', 'openrouter-doubao']).optional(),
  qualityAssessment: QualityAssessmentSchema.optional(),
  qualityStatus: QualityDecisionEnum.optional(),
  // A/B comparison fields — when --quality-alt-model is set, every quality
  // call also runs the same prompt through an alternate model (typically a
  // cheaper variant like deepseek-chat) for offline comparison. The
  // EXECUTIVE decision lives on `qualityAssessment` / `qualityStatus`; the
  // alt result is stored verbatim and never used for routing.
  qualityAssessmentAlt: QualityAssessmentSchema.optional(),
  qualityAltModel: z.string().optional(),
  // Seed-system attribution (set by generator when a seed was sampled):
  seedId: z.string().optional(),
});
export type Question = z.infer<typeof QuestionSchema>;

// ---------- Seed system ----------------------------------------------------

export const DepthCapEnum = z.enum(['general-knowledge']);
export type DepthCap = z.infer<typeof DepthCapEnum>;

export const SeedStatusEnum = z.enum(['active', 'demoted', 'banned']);
export type SeedStatus = z.infer<typeof SeedStatusEnum>;

export const SeedStatsSchema = z.object({
  timesUsed: z.number().int().min(0).default(0),
  avgFunScore: z.number().nullable().default(null),
  avgQualityScore: z.number().nullable().default(null),
  avgLearningValue: z.number().nullable().default(null),
  rejectRate: z.number().min(0).max(1).nullable().default(null),
  duplicatePairsProduced: z.number().int().min(0).default(0),
  questionsAssessed: z.number().int().min(0).default(0),
});
export type SeedStats = z.infer<typeof SeedStatsSchema>;

export const SeedSchema = z.object({
  id: z.string(),
  category: z.string(),
  topic: z.string(),
  angle: z.string(),
  depthCap: DepthCapEnum,
  exampleStems: z.array(z.string()).max(10).default([]),
  bannedAngles: z.array(z.string()).max(20).default([]),
  stats: SeedStatsSchema.default({
    timesUsed: 0,
    avgFunScore: null,
    avgQualityScore: null,
    avgLearningValue: null,
    rejectRate: null,
    duplicatePairsProduced: 0,
    questionsAssessed: 0,
  }),
  weight: z.number().min(0).default(1.0),
  lastUsedAt: z.string().nullable().default(null),
  status: SeedStatusEnum.default('active'),
});
export type Seed = z.infer<typeof SeedSchema>;

/**
 * Output shape that the AI generator must return (subset — no metadata).
 *
 * Mobile UI hard limits are enforced HERE, not on QuestionSchema:
 *   - question:    ≤150 characters (Quizduell-class budget; aim for ≤120)
 *   - per-answer:  ≤60  characters (Quizduell button comfort threshold)
 *
 * Looser bounds remain on `QuestionSchema` so existing pool entries that
 * were generated before this constraint was added (the ~90 "legacy
 * offenders" identified 2026-05-05) still load. Tighter bounds bite on
 * every NEW generation. The orchestrator's per-question retry loop
 * surfaces parse failures, so a generator that consistently produces
 * over-budget content gets pushed off the rotation by the
 * provider-archetype auto-disable system.
 */
export const GeneratedQuestionSchema = QuestionSchema.pick({
  question: true,
  answers: true,
  correctIndex: true,
  category: true,
  subcategory: true,
  archetype: true,
  difficulty: true,
  explanation: true,
  tags: true,
}).extend({
  question: z.string().min(20).max(150),
  answers: z.array(z.string().min(1).max(60)).length(4),
});
export type GeneratedQuestion = z.infer<typeof GeneratedQuestionSchema>;

/** Output shape that the AI enricher must return (existing question + new fields). */
export const EnrichmentOutputSchema = z.object({
  explanation: z.string().min(5).max(300),
  archetype: ArchetypeEnum,
  tags: z.array(z.string()).min(1).max(10),
  correctIndex: z.number().int().min(0).max(3),
  qualityRating: QualityRatingEnum,
});
export type EnrichmentOutput = z.infer<typeof EnrichmentOutputSchema>;

/** Output shape that the verifier must return. */
export const VerifierOutputSchema = z.object({
  chosenLetter: z.enum(['A', 'B', 'C', 'D']),
  confidence: z.enum(['high', 'medium', 'low']),
  citation: z.string().optional().default(''),
});
export type VerifierOutput = z.infer<typeof VerifierOutputSchema>;

