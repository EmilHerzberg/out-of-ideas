import type { Archetype } from './schema.js';

/**
 * Per-archetype list of compatible CATEGORIES.
 *
 * Hard-filter only — applied by the orchestrator when picking
 * (category, archetype, provider) triples. Generating against an incompatible
 * pair produces filler (e.g. "etymology of Mt. Everest") that wastes API
 * tokens and pollutes the dedup pool.
 *
 * The matrix:
 *   - Strict-only archetypes (etymology, vocab_context, counterfactual) list
 *     ONLY the categories where the archetype's premise actually applies.
 *   - Universal archetypes (misconception, lateral_connection, odd_one_out,
 *     comparison) list ALL 10 categories.
 *   - Marginal categories per archetype are INCLUDED in the allow-list. We
 *     prefer to let Gemini try and let dedup + quality filter the weak cases,
 *     rather than hard-block. Empirically this keeps the orchestrator's
 *     rotation diverse.
 *
 * Future: if per-seed compatibility becomes important (e.g. lang_writing_pop
 * doesn't work well with etymology), add a `compatibleArchetypes` field to
 * the seed schema. The orchestrator would intersect this list with that one.
 */
const ALL_CATEGORIES = [
  'Science',
  'History',
  'Geography',
  'Pop Culture',
  'Sports',
  'Language',
  'Tech',
  'Food & Drink',
  'Arts',
  'General',
] as const;

export const ARCHETYPE_COMPATIBLE_CATEGORIES: Record<Archetype, readonly string[]> = {
  cause_effect: ['Science', 'History', 'Geography', 'Pop Culture', 'Sports', 'Tech', 'Food & Drink', 'Arts', 'General'],
  // Language removed 2026-05-01 — run 9 showed 0/19 survival on `comparison × Language`;
  // the archetype-aware quality verifier rejected ALL outputs because comparison's
  // 2x–10x magnitude rule + counterintuitive-answer rule don't apply to language facts.
  comparison: ['Science', 'History', 'Geography', 'Pop Culture', 'Sports', 'Tech', 'Food & Drink', 'Arts', 'General'],
  process_sequence: ['Science', 'History', 'Geography', 'Sports', 'Tech', 'Food & Drink', 'General'],
  misconception: ALL_CATEGORIES,
  etymology: ['Language'],                   // STRICT — word-origin questions only
  // Language removed 2026-05-05 — the 2026-05-05 production run showed
  // estimation × Language quality-rejects 100% (6 of 6 in batch 18). Root
  // cause: Language facts are inherently recall-based ("how many languages
  // exist", "how many idioms", "what % of vocabulary is borrowed"); none
  // are Fermi-derivable through rough mental multiplication, so the
  // archetype's core rule rejects every output. Same structural pattern
  // that drove `comparison × Language` removal back on 2026-05-01.
  estimation: ['Science', 'History', 'Geography', 'Pop Culture', 'Sports', 'Tech', 'Food & Drink', 'Arts', 'General'],
  lateral_connection: ALL_CATEGORIES,
  odd_one_out: ALL_CATEGORIES,
  counterfactual: ['Science'],                // STRICT — per spec, physical-science only (no history / politics)
  vocab_context: ['Language'],                // STRICT — needs a sentence + word
  strategy: ['Science', 'History', 'Pop Culture', 'Sports', 'Tech', 'General'],
  spatial: ['Science', 'Geography', 'Sports', 'Tech', 'Arts'],
  unsalvageable: [],                          // not generatable, never compatible
};

/** True if a (category, archetype) pair is allowed. Case-insensitive. */
export function isCompatible(category: string, archetype: Archetype): boolean {
  const allowed = ARCHETYPE_COMPATIBLE_CATEGORIES[archetype] ?? [];
  return allowed.some((c) => c.toLowerCase() === category.toLowerCase());
}

/** Categories the orchestrator should consider for a given archetype. */
export function compatibleCategories(archetype: Archetype): readonly string[] {
  return ARCHETYPE_COMPATIBLE_CATEGORIES[archetype] ?? [];
}
