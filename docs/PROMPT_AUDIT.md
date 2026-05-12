# Prompt Optimisation Audit — V1

Audit of `PROMPTS_FOR_REVIEW.md` (2026-05-05). Scope: 17 prompt sections + 4 dynamic-context sub-prompts. Lenses: A) cross-provider portability, B) length-budget compliance, C) default-repertoire avoidance, D) archetype rule enforcement, E) self-check rigor, F) redundancy/inconsistency, G) missing rules, H) stage-leverage.

---

# PART 1 — PER-PROMPT FINDINGS

## 1. `master.txt` — Question generation system prompt

- **Lens A (cross-provider portability):** The output schema declares `"question": "string, 10-200 chars"` while the Mobile UI section says ≤150. Thinking models that read the schema as authoritative will treat 200 as legal.
  Suggestion: change schema line to `"question": "string, 10-150 chars"` and `"explanation": "string, ≤300 chars"` so the schema is internally consistent with the hard caps. Aligns the JSON-mode validator with the Zod schema.
  Confidence: **high** — known issues note schema-layer rejections burn retry slots.

- **Lens B (length-budget compliance):** The self-check (6 items) does NOT include a length-budget check. The narrative section is 15 lines but the verification mechanism doesn't fire on length.
  Suggestion: add as item 7: "Is the question >150 chars or any answer >60 chars? If yes → rewrite tighter." Self-check items the model has just stated have empirical pull on output.
  Confidence: **high**.

- **Lens C (default-repertoire avoidance):** No default repertoire avoidance lives at the master level — it's only in `etymology.txt` (5 banned words) and `seed-verifier.txt` (14 banned stems). Cross-archetype default repertoire (Why-popcorn-pops, Why-Venus-hotter, mortgage) leaks into non-etymology archetypes.
  Suggestion: add a 3-line "Avoid default-repertoire stems" block referencing a shared `default-repertoire.txt` (see Part 2).
  Confidence: **high** — Run 8 evidence shows convergence across providers.

- **Lens D (archetype rule enforcement):** "ALWAYS pick exactly one archetype from the official archetype list" is misleading — the orchestrator hard-injects the archetype. This invites the model to second-guess.
  Suggestion: change to "ALWAYS use the archetype provided in the user message and follow its specific rules from the appended archetype block."
  Confidence: medium.

- **Lens E (self-check rigor):** Item 1 ("Could a Wikipedia infobox answer this in 1 lookup?") is rubber-stampable — most models say "no" reflexively. Item 6 ("if you removed the question and showed only 4 answers, would the correct one stand out?") is concrete.
  Suggestion: make item 1 verifiable: "Name the single fact required. Could a 5-second Google search return that exact fact? If yes → regenerate."
  Confidence: medium.

- **Lens F (redundancy):** ±20% answer length appears 3x (NEVER section, ALWAYS section, self-check item 2). Distractor-defeatability appears 2x. Acceptable redundancy.
  Suggestion: leave as-is — repetition is intentional reinforcement.

- **Lens G (missing rules):** No rule against using current-year, decade, or "as of 2025" framings — these date-rot the pool. No rule against ≥3 answers being numeric (a length-tell shortcut).
  Suggestion: add to NEVER list: "NEVER use 'as of [year]' or 'currently' framings — pool entries must read true 5 years from now."
  Confidence: medium.

- **Lens H (stage-leverage):** Master is appropriately heavy — 90 lines for the universal contract is right.
  Lens H: clean — no finding.

## 2.1 `cause_effect`

- **Lens A:** Clean — JSON shape is master-inherited.
- **Lens B:** Length budget present and explicit. Good.
  Lens B: clean — no finding.
- **Lens C:** Worked example explicitly uses "Why does popcorn pop?" as the KEEP example — and `seed-verifier.txt` lists this exact stem as default-repertoire default-repertoire to reject. **Direct contradiction.**
  Suggestion: replace KEEP example with a non-default-repertoire Why-question (e.g., "Why do flamingos stand on one leg?" — already used in stems list — show full worked answers/distractors).
  Confidence: **high** — this is the most empirically supported finding in the document.
- **Lens D:** "MUST start with 'Why' or 'What causes'" is concrete and refusable.
  Lens D: clean — no finding.
- **Lens E:** No self-check section. Inherits master's. Marginal.
- **Lens F:** "soup of factors" wording duplicated with master's "all of the above" ban — different concepts, leave.
- **Lens G:** No rule against the answer being a textbook citation ("photosynthesis", "evolution"). The audit notes p99=107 char narrative answers but doesn't flag generic-mechanism answers.
  Suggestion: add "Mechanism must be specific — avoid one-word generics ('evolution', 'gravity', 'photosynthesis')."
  Confidence: medium.

## 2.2 `comparison`

- **Lens A:** Clean.
- **Lens B:** **No length budget block.** Comparison stems list four items in the question — naturally pushes toward >120 chars when items are multi-word. ("Which is older: the pyramids of Giza, written language, mammoths, or Stonehenge?" = 80 chars; with longer items, easily over.)
  Suggestion: add 3-line length budget noting that 4-item lists in stems must use short item names; if items can't be shortened, move them into answers and ask "which is oldest" by category.
  Confidence: **high** — this is precisely the inheritance gap the doc flags.
- **Lens C:** Clean.
- **Lens D:** "Stem must explicitly use a comparative" is concrete and refusable. Good. Run-13 evidence shows this rule was added after Google superlative leak.
  Lens D: clean — no finding.
- **Lens E:** No self-check. Inherits master's.
- **Lens F:** Clean.
- **Lens G:** Pyramids/mammoths is a known-default-repertoire comparison stem (it's in the public Reddit/Wired default repertoire). The KEEP example is the default-repertoire version of this archetype.
  Suggestion: keep as a teaching example but flag with "This stem is illustrative; the orchestrator will not let you produce it because it's already in pool."
  Confidence: medium.

## 2.3 `process_sequence`

- **Lens A–D:** Length budget exists. JSON-shape clean. "MUST ask WHAT HAPPENS NEXT" is concrete.
  Lens A: clean — no finding. Lens B: clean — no finding.
- **Lens C:** Photosynthesis stem ("In photosynthesis, what comes right after chlorophyll absorbs light?") is an default-repertoire hotspot in process_sequence — biology textbook universal.
  Suggestion: replace with non-textbook process (e.g., bread rising, espresso shot extraction, glacier carving).
  Confidence: medium.
- **Lens E:** No self-check. Inherited.
- **Lens F:** Clean.
- **Lens G:** Doc notes Run 13 showed 17% survival on `process_sequence × deepseek/doubao` — but the prompt has no language tailored to weaker reasoning models. The fix is provider-archetype constraints, not prompt — appropriate.
  Lens G: clean — no finding.
- **Lens H:** Clean.

## 2.4 `misconception`

- **Lens A–B:** Length budget present.
  Lens A: clean — no finding. Lens B: clean — no finding.
- **Lens C:** **The KEEP example uses "goldfish 3-second memory" — this is default-repertoire trivia.** The REJECTED example calls out vomitoriums — but 10%-of-brain, Einstein-failed-math, swallow-spiders, and goldfish-memory are equally default-repertoire and the prompt USES one of them as the gold-standard KEEP.
  Suggestion: replace KEEP example with a less-saturated myth ("It's a popular myth that lemmings commit mass suicide. Actually?" or "Many believe Vikings wore horned helmets. Actually?"). Add 4–5 banned myths to the existing single-rejected vomitorium reference.
  Confidence: **high** — saturation hotspot evidence is in the prompt's own known issues.
- **Lens D:** "ONE distractor must literally restate the popular myth" is concrete and refusable.
  Lens D: clean — no finding.
- **Lens E:** No self-check.
- **Lens F:** Clean.
- **Lens G:** Doc notes saturation around vomitoriums and 10%-brain etc. — banlist should be explicit, not single-example.
  Suggestion: add explicit ban list of 8–10 default-repertoire myths (combine with cross-cutting `default-repertoire.txt`).
  Confidence: high.

## 2.5 `etymology`

- **Lens A:** Clean.
- **Lens B:** No length budget. Etymology answers are naturally short (the origin), so verbosity risk is low — but the explanation block can sprawl.
  Suggestion: skip dedicated length budget; inheritance is fine here. Lens B: clean — no finding.
- **Lens C:** Strongest default repertoire-avoidance prompt in the system. The 5-word ban list and 16-alternative replacement list are exemplary.
  Lens C: clean — no finding.
- **Lens D:** "Pick a different word" is concrete. The example stems show "salary" — banned in the next paragraph. Keep stems list contains "sabotage" which is fine, but listing `salary` then banning it in the next block sends mixed signals.
  Suggestion: remove `salary` from the example stems (line 386) — it's banned 10 lines later. Replace with `denim` or `tycoon`.
  Confidence: high.
- **Lens E:** No self-check. Inherited.
- **Lens F:** The default repertoire ban list duplicates 5 of the 14 entries in `seed-verifier.txt`. Drift risk.
  Suggestion: consolidate into shared `default-repertoire.txt` (see Part 2).
  Confidence: high.
- **Lens G:** Doesn't ban etymologies that are themselves urban legend (the Brooklyn-bridge-sucker, "rule of thumb" wife-beating, "OK = oll korrect"). These appear in alternative lists and are themselves default-repertoire.
  Suggestion: add note: "Avoid etymologies that are themselves disputed myth-default repertoire ('rule of thumb,' 'OK,' 'whole nine yards')."
  Confidence: medium.

## 2.6 `estimation`

- **Lens A:** Clean.
- **Lens B:** **No length budget.** Estimation stems can sprawl ("Roughly how many...") but tend to stay short. Distractor numerals are short. Risk is moderate.
  Suggestion: add 2-line budget noting answers should be bare numerals/units, not "Approximately 8 billion grains."
  Confidence: medium.
- **Lens C:** Heartbeats-in-lifetime, sand-on-beach, photos-in-last-10-years are all classic Fermi-trivia-default repertoire. Three of three example stems are default-repertoire.
  Suggestion: replace 1–2 examples with less-saturated angles (e.g., "How many emails are sent globally per second?" or "How many times does the average heart beat between two heartbeats of a hummingbird?")
  Confidence: high.
- **Lens D:** "Pure-recall estimations are REJECTED" is concrete.
  Lens D: clean — no finding.
- **Lens E:** No self-check.
- **Lens F:** Clean.
- **Lens G:** Doc flags estimation × verify is structurally fraught (low-confidence rate). The prompt does not signal to the verifier "this is estimation; soft-pass low confidence."
  Suggestion: this is a verifier-side fix, not estimation-side — see Section 4.
  Confidence: high — flagged in doc.
- **Lens H:** Clean.

## 2.7 `lateral_connection`

- **Lens A:** Clean.
- **Lens B:** **No length budget.** Surprising-pair-of-X answers tend to be longer ("Both rely on..." narrative form). Doubao 100% survival doesn't mean answers are short — survival is about correctness, not length.
  Suggestion: add length budget — answers should be the shared property in noun-phrase form ("Pavlovian conditioning of color"), not narrative.
  Confidence: medium.
- **Lens C:** "QWERTY/railway gauges" and "aspirin/willow bark" are default-repertoire lateral examples.
  Suggestion: keep one default-repertoire example for instruction; replace the other with a fresh angle.
  Confidence: medium.
- **Lens D:** "rhymes-with-truth" distractor rule is concrete.
  Lens D: clean — no finding.
- **Lens E:** No self-check.
- **Lens F–G:** Clean.
- **Lens H:** Clean.

## 2.8 `odd_one_out`

- **Lens A:** Clean.
- **Lens B:** **No length budget.** Items in the answer slot can be 1–4 word names — usually short. Risk: when items need disambiguation ("Linnaeus's binomial nomenclature for…"), they balloon.
  Suggestion: add a 2-line note: each of the 4 answer items must be ≤45 chars; if disambiguation is needed, the question stem carries it.
  Confidence: medium.
- **Lens C:** Clean — examples are non-default-repertoire.
- **Lens D:** "Surface-level shared traits (all green, all start with B) are too easy" is concrete and refusable.
  Lens D: clean — no finding.
- **Lens E:** No self-check.
- **Lens F–G:** Clean.

## 2.9 `counterfactual`

- **Lens A:** Clean.
- **Lens B:** **No length budget.** Counterfactual stems are conditional ("If X, then Y") and longer; physics-counterfactuals can fit, but historical stems blow budget. Already banned.
  Suggestion: add note: "Conditional stems must use 'If [single variable], what changes?' — no nested conditions."
  Confidence: medium.
- **Lens C:** Examples are fresh (axis tilt, half-gravity, photosynthesis-light-budget) — none are default-repertoire.
  Lens C: clean — no finding.
- **Lens D:** Hard rule banning historical/political counterfactuals is rigorously stated.
  Lens D: clean — no finding.
- **Lens E:** No self-check.
- **Lens F:** Clean.
- **Lens G:** No rule about avoiding distractors that are themselves implausible physics ("the Earth would explode"). Players need plausible distractors that trap mental models.
  Suggestion: add "Each distractor must describe a real plausible physics outcome — not a cartoon-extreme."
  Confidence: medium.

## 2.10 `vocab_context`

- **Lens A:** Clean.
- **Lens B:** **No length budget.** Vocab stems naturally include a sentence ("In the sentence 'Her arguments were sophistical,'…") — pushes toward 100+ chars. Answer options are short.
  Suggestion: add length budget — sentence-context stems must be ≤120 chars; answer options ≤45 chars.
  Confidence: high.
- **Lens C:** "sophistical/unctuous/baroque" are common SAT-vocab default repertoire — well-trodden in LLM training.
  Suggestion: replace one example with a less-saturated word (e.g., "phlegmatic," "sere," "pellucid").
  Confidence: medium.
- **Lens D:** "false friend" rule concrete.
  Lens D: clean — no finding.
- **Lens E–G:** Clean.

## 2.11 `strategy`

- **Lens A:** Clean.
- **Lens B:** Length budget present, explicit, and concrete (median 149 → ≤100 target, ≤40 answer aim).
  Lens B: clean — no finding.
- **Lens C:** Monty Hall is universal default-repertoire — but it's used here for instructive purposes (illustrates "naïve sophistication" distractor). Acceptable as teaching example as long as the orchestrator dedups the actual stem.
  Suggestion: add note: "These examples illustrate structure; do not produce these exact stems — the dedup pool already contains them."
  Confidence: medium.
- **Lens D:** "naïve sophistication" rule concrete.
  Lens D: clean — no finding.
- **Lens E–G:** Clean.

## 2.12 `spatial`

- **Lens A:** Clean.
- **Lens B:** **No length budget.** Spatial stems describe scenarios — naturally verbose. Tipping-cube-on-edge example is short; folding-map example is 78 chars.
  Suggestion: add length budget — spatial stems must use 2nd-person concrete-action form ("You fold X. What...?") not narrative; ≤120 chars.
  Confidence: medium.
- **Lens C:** Clock-in-mirror is default repertoire-ish; map-fold and cube-on-edge are fresh.
  Lens C: largely clean — no finding.
- **Lens D:** "Avoid purely recall-based geography unless it requires real spatial reasoning" — concrete enough.
  Lens D: clean — no finding.
- **Lens E–G:** Clean.

## 3. `quality.txt` — Quality assessor

- **Lens A (cross-provider):** Doc notes "smaller models sometimes treat the archetype rules as commentary." The prompt's section "How to use the user-message context" mentions archetype rules but doesn't flag them as **mandatory consultation**.
  Suggestion: change line "When archetype rules and generic rubric conflict, archetype rules win for qualityScore" to "BEFORE assigning qualityScore, you MUST verify each archetype rule. Cite the rule you're applying in `reasoning`."
  Confidence: **high** — doc explicitly flags this.
- **Lens B:** Quality assessor doesn't check length budgets — schema does. But quality CAN reject a question for "answers within ±20% of each other." Worth adding a length-tell check.
  Suggestion: add to qualityScore rubric: "qualityScore ≤ 2 if any answer is >1.5x the length of the shortest answer (length-tell)."
  Confidence: medium.
- **Lens C:** Quality assessor has no default repertoire-detection lens. A default-repertoire question is technically craftable; the assessor can't catch saturation.
  Suggestion: this lives at dedup, not quality — don't add. Lens C: clean — no finding.
- **Lens D:** Archetype-rule injection is the linchpin and is well-architected.
  Lens D: clean — no finding.
- **Lens E:** Decision rule is conjunctive (`specialist AND funScore≤3` requires BOTH). Doc flags this. A specialist question with funScore=4 escapes — but Review path catches it. Worth verifying empirically against actual rejected questions.
  Suggestion: leave decision rule; add: "If you assigned `accessibilityTier: specialist`, name the specific knowledge required. If a 14-year-old generalist could plausibly reason it, downgrade to enthusiast."
  Confidence: medium.
- **Lens F:** "Fun > Educational > Factual" is restated identically in master.txt and quality.txt. Acceptable.
  Lens F: clean — no finding.
- **Lens G:** Doc flags Reject-heavy worked examples (4 reject, 1 keep). Risks rejection-bias.
  Suggestion: add 1–2 more KEEP examples — one that is borderline-fun-but-recall (illustrates "boring-but-craft-good = REVIEW, not KEEP") and one that is clearly viral-grade.
  Confidence: medium.
- **Lens H:** This is the right place to invest prompt density (40% of pool entry gating).
  Lens H: clean — no finding.

## 4. Inline verifier prompt — Web-grounded fact check

- **Lens A:** 14 lines is dangerously thin for thinking models — Gemini 3.x reasoning consumes maxTokens budget before the JSON renders. Doc notes the proposer hit this exact issue (1200 → 8192 fix).
  Suggestion: add explicit "First, search the web for the answer. Then return JSON. Do not include reasoning in your output." Tells the thinking model to spend reasoning budget on search, not on reasoning-trace.
  Confidence: **high** — direct evidence from doc.
- **Lens B:** Verifier doesn't check length budgets. Out of scope.
  Lens B: clean — no finding.
- **Lens C:** Verifier doesn't see archetype context.
  Lens C: clean — no finding.
- **Lens D:** No archetype-aware behavior. Estimation should soft-pass on `low` confidence (per doc flag).
  Suggestion: add line: "If the question asks for an order-of-magnitude estimate or rough percentage, return confidence='medium' rather than 'low' if your search returns a defensible value within 2x of one option."
  Confidence: high.
- **Lens E:** No self-check.
  Suggestion: not needed at verify stage — search + select is the contract.
- **Lens F:** Clean.
- **Lens G:** Doc flags `citation` writes to `sourceLink` (URL-typed). Schema mismatch is a code fix, not prompt fix.
  Lens G: out of prompt scope — no finding.
- **Lens H:** **Disproportionate under-investment** — 14 lines for an 80% gate. Highest-leverage expansion target in the system.
  Suggestion: expand to ~30 lines: explicit search instruction, archetype-aware confidence calibration, instruction to return chosenLetter even when uncertain (with low confidence).
  Confidence: **high** — doc closing notes flag this directly.

## 5. `seed-verifier.txt`

- **Lens A:** Clean — Opus 4.7 + Gemini Pro tested.
  Lens A: clean — no finding.
- **Lens B:** Out of scope.
- **Lens C:** Strongest default repertoire-aware prompt — 14-stem ban list. Drift risk: this list lives separately from etymology.txt's 5-word ban.
  Suggestion: extract into shared `default-repertoire.txt` (Part 2).
  Confidence: high.
- **Lens D:** Refusal criteria concrete (KEEP/EDIT/REMOVE rubric).
  Lens D: clean — no finding.
- **Lens E:** Reasoning required per decision — built-in self-check.
  Lens E: clean — no finding.
- **Lens F:** Ban list duplicated with etymology.txt.
  See Lens C.
- **Lens G:** "Categories: one of the 10 allowed" but doesn't enumerate. Cheaper fallback models may not infer.
  Suggestion: list the 10 categories explicitly inline.
  Confidence: medium — doc flags this.
- **Lens H:** Appropriate investment — high-leverage gate, used Opus 4.7.
  Lens H: clean — no finding.

## 6. Inline seed proposer prompt

- **Lens A:** One-line system prompt + structured user prompt is portable. Doc notes Gemini truncation at 1200 maxTokens.
  Suggestion: schema-side fix already done; prompt-side ok. Lens A: clean — no finding.
- **Lens B:** No length-budget for proposed exampleStems. A proposer producing a 200-char stem will be reified by the verifier into a seed that biases generation long.
  Suggestion: add to user prompt: "exampleStems must be ≤150 chars to match mobile UI."
  Confidence: medium.
- **Lens C:** **No default repertoire ban.** Proposer can suggest seeds containing "Why does popcorn pop?" stems; verifier catches them but burns proposer→verifier round trips.
  Suggestion: add to user prompt: "exampleStems must NOT include default-repertoire trivia: see [default-repertoire list]."
  Confidence: **high** — direct cost mechanism, verifier rejection is downstream.
- **Lens D:** "stay STRICTLY at general-knowledge level" is concrete.
  Lens D: clean — no finding.
- **Lens E:** No self-check.
- **Lens F:** "fun 'huh, no way' questions" duplicated with master.txt — drift-prone if master is rephrased.
  Suggestion: stay aligned with master via shared phrasing constant.
  Confidence: low.
- **Lens G:** Proposer doesn't know which archetypes exist or which compatible with which categories. Verifier can KEEP a seed that pairs with no archetype — not actually rejected unless proposer also misses category fit.
  Suggestion: inject the (category → compatible archetypes) map into the user prompt.
  Confidence: medium.
- **Lens H:** Proposer is 1 line. Doc flags possible value to expansion.
  Suggestion: cautious expansion — current 1-line system + structured user prompt is producing valid output reliably; expansion to 5–10 lines acceptable, more risks JSON drift on cheap providers.
  Confidence: low.

## 7. Inline rewrite-mobile prompt

- **Lens A:** Clean.
- **Lens B:** Length budget IS the prompt's purpose. Concrete and refusable.
  Lens B: clean — no finding.
- **Lens C:** **No default repertoire-ban reference.** 45% success rate; the 46 quality-rejected compresses may include cases where compression accidentally landed on a default-repertoire phrasing.
  Suggestion: add line: "Do not compress toward universal stem patterns ('Why does popcorn pop?', 'Why is the sky blue?', etc.). If the natural compression hits one of those, the question is structurally default-repertoire and should be DROPPED rather than compressed."
  Confidence: high — doc explicitly flagged this in optimization angles.
- **Lens D:** "PRESERVATION RULES" block is concrete.
  Lens D: clean — no finding.
- **Lens E:** No self-check. Worth adding given 55% drop rate.
  Suggestion: append: "Self-check before output: (a) is your question ≤150 chars? (b) is each answer ≤60 chars? (c) does the correct answer at correctIndex still mean the same thing as the original? If any 'no' → rewrite."
  Confidence: high.
- **Lens F:** Length caps duplicated from master — acceptable here since rewrite-mobile is standalone.
  Lens F: clean — no finding.
- **Lens G:** Doesn't preserve `tags` — model may drop them. Schema may handle this; not in prompt scope.
- **Lens H:** Clean.

## 9.1 Generator user prompt (dynamic)

- **Lens A:** Cross-provider portability depends on JSON-mode + master/archetype schema; user prompt is structured key:value.
  Lens A: clean — no finding.
- **Lens B:** No length-budget reminder injected per call. Inheritance from system prompt only.
  Suggestion: append a 1-line reminder: "Hard caps: question ≤150 chars, each answer ≤60 chars."
  Confidence: medium — repetition empirically improves compliance on weaker models.
- **Lens C:** Does the user prompt inject the seed's `bannedAngles` AND a recent-stems list to avoid pool dupes?
  Suggestion (to verify, not edit): if recent-pool stems aren't injected, do so — embedding-dedup catches the symptom but earlier-stage avoidance is cheaper. (Need to inspect `generator.ts`.)
  Confidence: medium — depends on current behavior.
- **Lens D-G:** Out of audit scope without code read.

## 9.2 Quality user prompt (dynamic)

- **Lens A:** Per-call inject of category hints + archetype rules verbatim is well-architected.
  Lens A: clean — no finding.
- **Lens D:** Archetype rules injected verbatim — strong signal for the assessor. Worth confirming the **length-budget block** of each archetype is included (only 4 of 12 have one; the inject won't help when it's missing).
  Suggestion: see Part 2 — once length-budget blocks exist on all 12, this inject becomes uniformly powerful.
  Confidence: high.
- Other lenses: clean — no finding.

## 9.3 Verifier user prompt (no separate user prompt)

Whole question + options interpolated inside the inline system prompt.
- **Lens A:** Means thinking models see the question pre-baked, no separate user-turn signal. Some providers behave differently between system-only and system+user setups.
  Suggestion: split into proper system + user prompt. System carries the contract ("you're a strict fact checker, return JSON"); user carries the question. Cheap, improves cross-provider behavior.
  Confidence: medium.
- Other lenses: covered in Section 4.

## 9.4 Seed-verifier user prompt (dynamic)

- **Lens A:** Injects full existing seed catalog organized by category. With 59 seeds and growing, token cost per call rises linearly. Currently $0.43/run, ~20 proposals.
  Suggestion: inject only seeds in the same category as the proposal, not all 10 categories' seeds. Cuts token cost ~10x for this call without losing overlap detection.
  Confidence: high — overlap detection only matters within-category.
- **Lens C:** Catalog injection naturally lets the verifier see default repertoire-leaks in existing seeds — good defense-in-depth.
  Lens C: clean — no finding.
- Other lenses: clean — no finding.

---

# PART 2 — CROSS-CUTTING PATTERNS

### Pattern 1 — default-repertoire trivia ban list is fragmented across 3 prompts

The same default-repertoire stems (popcorn, mortgage, salary, sky-blue, Venus-vs-Mercury) are partially listed in `etymology.txt` (5 etymology words), `seed-verifier.txt` (14 stems), and inconsistently used as KEEP examples in `cause_effect.txt` ("Why does popcorn pop?" is the KEEP gold standard) and `misconception.txt` (goldfish-3-second-memory is the KEEP gold standard) — both of which the seed-verifier explicitly rejects.

**Prompts affected:** 1, 2.1, 2.4, 2.5, 2.7, 5, 6, 7.

**Why production-impact:** The seed-verifier banlist is enforced upstream — but the same default-repertoire stems leak in via generator examples. Run 8 demonstrated 4 providers converging on "mortgage/panic/salary" within first batches. Pool saturation hotspots flagged in known issues (vomitoriums, Why-Venus-hotter, mortgage etymology) all trace to default repertoire convergence.

**Remediation:** Create `src/prompts/default-repertoire.txt` — single source of truth listing ~30 default-repertoire stems and ~15 default-repertoire etymology targets. Reference it from master.txt ("AVOID stems in default-repertoire.txt"), etymology.txt ("AVOID etymology targets in default-repertoire.txt"), seed-verifier.txt (replace inline list), seed-proposer system prompt (1-line reference), rewrite-mobile prompt (don't compress toward default-repertoire patterns). Replace the 4 contradictory KEEP examples (popcorn cause_effect, goldfish misconception) with non-default-repertoire equivalents.

### Pattern 2 — 8 of 12 archetype prompts lack explicit length-budget blocks

Only `cause_effect`, `misconception`, `process_sequence`, `strategy` have dedicated length-budget sections. The other 8 (`comparison`, `etymology`, `estimation`, `lateral_connection`, `odd_one_out`, `counterfactual`, `vocab_context`, `spatial`) inherit master.txt's caps. Empirically, inheritance is insufficient: the 4 worst-offender archetypes were the first to get explicit blocks, and they got them only after 28% of pool entries violated the caps.

**Prompts affected:** 2.2, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.12.

**Why production-impact:** rewrite-mobile run dropped 84/153 over-budget entries — high failure rate partly because the source prompts don't actively encourage compression. Each over-budget question costs a generate + quality + verify round trip ($0.005–$0.015) before being rejected at schema.

**Remediation:** Add a 3–6 line length-budget block to each of the 8 missing archetypes, tailored to its verbosity pattern (estimation: bare numerals; comparison: short item names in stem 4-list; vocab_context: ≤120 char sentence stems; lateral_connection: noun-phrase shared property; etc.). Templating pass — same skeleton, archetype-specific text.

### Pattern 3 — Self-check checklists exist only at the master level; archetype prompts skip them

Master.txt has 6 self-check items. None of the 12 archetype prompts add archetype-specific self-checks. Doc notes mid-tier Chinese models (MiniMax, Doubao Lite) "often skip silently" on the master self-check — meaning per-archetype self-checks would be even less reliable on those providers.

**Prompts affected:** 2.1–2.12.

**Why production-impact:** Models that pass the master self-check still produce archetype-rule violations, caught only at quality stage (40% reject rate). A per-archetype 2-question self-check inserted at the end of each archetype prompt would shift catches earlier — cheaper.

**Remediation:** Add a `## Self-check` block (2 questions max) to each archetype prompt, focused on the archetype's most-violated rule. E.g., cause_effect: "(1) Does my answer name a specific mechanism, not a generic field? (2) Are all distractors real heat/cause-related effects in the topic?" Strategy: "(1) Does the correct move require going one layer deeper than naïve sophistication? (2) Is my scenario one clause?"

### Pattern 4 — Worked-example KEEPs frequently use the default-repertoire training-data trivia they should avoid

Master self-check uses generic Wikipedia-infobox phrasing. cause_effect KEEP = "Why does popcorn pop?". misconception KEEP = goldfish-3-second-memory. comparison KEEP = pyramids-vs-mammoths. estimation example = heartbeats-in-lifetime. strategy example = Monty Hall. lateral_connection examples = QWERTY/railway, aspirin/willow.

**Prompts affected:** 1, 2.1, 2.2, 2.4, 2.6, 2.7, 2.11.

**Why production-impact:** Worked examples set the model's mental anchor more strongly than rule statements. When the KEEP example IS the default-repertoire, the model produces default-repertoire variants. The same default-repertoire stems drive Run 8 cross-provider convergence and dedup-pool saturation.

**Remediation:** Audit every KEEP/example block and replace default-repertoire stems with non-default-repertoire examples that demonstrate the same structural property. Add an inline note where retaining a default-repertoire for instructional clarity: "Illustrative only — orchestrator dedup will reject this exact stem."

### Pattern 5 — Inline prompts are systematically thinner than their leverage warrants

The verifier prompt (Section 4) is 14 lines and gates ~80% of pool entry. The seed-proposer (Section 6) is 1 line of system prompt feeding into the seed-verifier ($0.43/run). Both work because cheap models handle simple tasks, but both have known issues with thinking models (Gemini truncation, low-confidence on estimation) that prompt expansion would address.

**Prompts affected:** 4, 6, 7 (rewrite-mobile is somewhat better — 17 lines).

**Why production-impact:** Inline prompts are written once, harder to find, easier to under-engineer relative to their stage leverage. The closing notes of PROMPTS_FOR_REVIEW.md explicitly call this out.

**Remediation:** Move each inline prompt into a dedicated `.txt` file alongside the others (`src/prompts/verifier.txt`, `src/prompts/seed-proposer.txt`). Establishing the file presence raises future-edit affordance. Add 5–10 lines each to address: thinking-budget instruction (Lens A), archetype-aware confidence (verifier), default-repertoire reference (seed-proposer, rewrite-mobile).

### Pattern 6 — Inconsistencies between schema declarations and rule text

Master.txt's JSON schema says `"question": "string, 10-200 chars"` while the rule text says ≤150. etymology.txt example stems include `salary` then ban it 10 lines later. Verifier prompt's `citation` field is typed as URL but the prompt asks for "a short sentence."

**Prompts affected:** 1, 2.5, 4.

**Why production-impact:** Models reading inconsistent specs split-decide, producing mid-spec output that passes one constraint and fails the other. The schema-says-200 / rule-says-150 case directly produces over-budget questions that burn schema-retry slots. The salary-listed-then-banned case drives the model toward salary anyway because example weight > rule weight.

**Remediation:** Mechanical pass to align schema text with rule text. Move `salary` out of etymology example stems. Decide whether verifier returns a sentence (current prompt) or a URL (schema field) and reconcile — this is also a code fix per doc.

### Pattern 7 — Per-call dynamic context redundantly injects what the system prompt already states

Quality user prompt embeds the archetype rules verbatim — good, this is documented. Seed-verifier user prompt embeds the full 10-category seed catalog when only the proposal's category is needed.

**Prompts affected:** 9.2 (acceptable), 9.4 (wasteful).

**Why production-impact:** Token cost. With 59 seeds and growing, full-catalog injection scales linearly into seed-verifier costs — currently $0.43/run, will be $1+/run by 200 seeds.

**Remediation:** Filter seed catalog injection to the proposal's category only. ~10x token reduction on seed-verifier user prompt. Trivial code change.

---

# PART 3 — PRIORITIZED ACTION LIST

Top to bottom by expected impact.

1. **Fix master.txt schema/rule inconsistency on length** — XS, **fixes silent over-budget question generation**. Change `"question": "string, 10-200 chars"` to `"string, 10-150 chars"` in master.txt JSON schema. Inconsistency with the 150 hard cap directly invites over-budget output that burns schema retries.

2. **Replace default-repertoire KEEP examples in cause_effect and misconception** — XS, **immediately reduces pool-saturation duplicates from convergent training-data default repertoire**. Swap "Why does popcorn pop?" out of cause_effect.txt's KEEP example and goldfish-3-second-memory out of misconception.txt. The seed-verifier already flags both as default repertoire-rejection targets — inconsistent with the prompt's own gold standard.

3. **Add length-budget blocks to the 8 archetype prompts that lack them** — S, **reduces rewrite-mobile drop rate (currently 84/153 = 55%) on future runs**. Templating pass: 3–6 line tailored block per archetype (comparison, etymology, estimation, lateral_connection, odd_one_out, counterfactual, vocab_context, spatial). Without this, length compliance depends on master.txt inheritance which empirically fails.

4. **Extract default-repertoire trivia ban list into shared `default-repertoire.txt`** — S, **eliminates drift between etymology.txt's 5 banned words and seed-verifier.txt's 14 banned stems; closes 4 prompt sites that should reference default repertoire avoidance but don't (master, seed-proposer, rewrite-mobile, misconception)**. Single source of truth referenced from 6 prompts; replace inline lists with one-line "see default-repertoire.txt."

5. **Expand verifier prompt from 14 to ~30 lines** — S, **stage gates 80% of pool entry; current investment under-engineered**. Add explicit "search the web first, then return JSON" instruction (helps thinking models like Gemini 3.x), archetype-aware confidence (estimation soft-pass), and split into proper system + user prompt for cross-provider portability.

6. **Add explicit length-budget item to master.txt self-check** — XS, **catches over-budget output before schema rejection**. Append: "Is the question >150 chars or any answer >60 chars? If yes → rewrite tighter." Self-check items the model has just stated have empirical pull.

7. **Add default-repertoire reference to rewrite-mobile prompt** — XS, **prevents compress-pass from drifting fresh questions toward default-repertoire phrasings (currently 46/153 quality-rejected)**. One-line addition: "If natural compression lands on a universal stem (Why-popcorn-pops form), DROP rather than compress."

8. **Filter seed-verifier user prompt to single-category catalog** — XS, **~10x token cost reduction at the seed-verifier stage; no behavior change since overlap detection only matters within-category**. Code-side fix to `seed-verifier.ts:buildUserPrompt`.

9. **Strengthen quality.txt instruction to mandatorily consult archetype rules** — XS, **doc explicitly flags that smaller models treat archetype rules as commentary**. Change "When archetype rules and generic rubric conflict, archetype rules win" to "BEFORE assigning qualityScore, you MUST verify each archetype rule. Cite the rule applied in `reasoning`."

10. **Add default-repertoire + archetype compatibility to seed-proposer user prompt** — XS, **reduces proposer→verifier rejection round trips**. Inject default-repertoire reference and (category → compatible archetypes) map.

11. **Add 2-line per-archetype self-check blocks** — S, **catches archetype-rule violations at generate stage instead of quality stage (cheaper)**. Templating pass adding 2 archetype-specific yes/no questions to each of 12 archetype files.

12. **Replace default-repertoire example stems within prompts (estimation, lateral_connection, vocab_context)** — XS, **lower-priority default repertoire avoidance — these examples drive but don't gold-stamp like KEEP examples do**. Swap one example per archetype for less-saturated alternative.

13. **Add 1–2 more KEEP examples to quality.txt** — XS, **doc flags Reject:Keep = 4:1 risks rejection-bias**. One borderline-fun-but-recall (REVIEW) and one viral-grade (KEEP) calibration anchor.

14. **Remove `salary` from etymology.txt example stems** — XS, **internal contradiction — listed as example, banned 10 lines later**. Single-word edit.

15. **Add "no `as of [year]` framings" to master.txt NEVER list** — XS, **prevents date-rot of pool entries**. One-line addition.

16. **Move inline prompts (verifier, seed-proposer, rewrite-mobile) into dedicated `.txt` files** — S, **raises future-edit affordance; current under-engineering of inline prompts is a structural pattern**. Mechanical move; behavior unchanged immediately, easier to audit/iterate on.

17. **Enumerate the 10 allowed categories explicitly in seed-verifier.txt** — XS, **cheap fallback models can't infer from context**. Insert the list inline.

18. **Add `temperature: 0.5` A/B test for rewrite-mobile** — XS, marginal, **doc-flagged optimization angle**. Configuration test, not a prompt edit per se; cheap to run.

The top 5 items are all XS or S effort. Top item (#1) is a single-line fix that directly removes a silent failure mode. Items 2–5 each have explicit empirical evidence in the doc's known-issues sections supporting the production-impact mechanism.
