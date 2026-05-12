# out-of-ideas — All AI Prompts for Review

This file collects every AI-facing prompt in the pipeline so an external reviewer can audit them for optimization potential. For each prompt: what it does, where it sits in the pipeline, why we wrote it that way, known production issues, and the prompt content itself.

---

## Project context (read this first)

**The product domain.** The pipeline targets a competitive 1v1 mobile trivia game profile — TikTok-native audience aged 14–30, ~10 seconds per question on small phone screens. The core thesis: **fun > educational > factual**. A correct-but-boring question is worse than no question.

**The pipeline.** A standalone Node CLI (TypeScript) that produces, scores, fact-checks, embeds, dedups, and ships quiz questions into a default-repertoire pool (`data/finalized-pool.jsonl`, currently ~465 entries). Six stages chain together; AI prompts gate every stage that uses an LLM:

```
generate → quality → verify → embed → dedup → finalize
   |          |         |        |       |
 (master+   (quality (Gemini   (768-d  (HNSW
 archetype  rubric)  Flash +   embed)   cosine)
 prompts)             Search)
```

Plus three meta-AI loops:

- **Seed verifier** — Claude Opus 4.7 gatekeeps newly proposed sub-topic seeds before they enter the seed catalog
- **Seed proposer** — When the evolver detects a saturated/underperforming seed, an AI proposes new adjacent seeds
- **Rewrite-mobile** — When pool entries exceed mobile UI character budgets, an AI compresses them through the full pipeline

**Mobile UI hard limits (2026-05-05).** Question text ≤150 characters; each answer ≤60 characters. Enforced at the schema layer on every freshly-generated question. The 2026-05-05 audit found 153 of 548 pool entries (28%) violated these caps; rewrite-mobile compressed 69 and dropped 84 to comply.

**Provider rotation.** 14 chat providers across US/Chinese/Google tiers. Each prompt below runs through whichever provider the orchestrator's weighted-rotation picks — so the same prompt has to work across Claude Opus 4.7, GPT-5, Gemini 3.1 Pro, DeepSeek V4 Pro, GLM-5.1, Kimi K2.6, Doubao Seed 2.0 Pro, Qwen 3.6 Max, MiniMax M2.7, ERNIE 4.5, plus Vertex Model Garden partners (Mistral / AI21 / Grok). Production-grade prompts must produce structurally-valid JSON across this entire fleet, including thinking-class models that reject non-default temperature.

**Audience reading level.** ~7th–9th grade. Conversational tone, slightly cheeky, non-condescending. No emojis in question text.

**Categories (10):** Science, History, Geography, Pop Culture, Sports, Language, Tech, Food & Drink, Arts, General.

**Archetypes (12):** cause_effect, comparison, process_sequence, misconception, etymology, estimation, lateral_connection, odd_one_out, counterfactual, vocab_context, strategy, spatial.

**Empirical evidence sources for the optimization audit:**

- `TESTING.md` — running log of generation runs, what they revealed, bugs surfaced
- `data/auto-runs/<ts>/run.log.jsonl` — per-batch metrics across multiple test runs
- `data/finalized-pool.jsonl` — the actual surviving question corpus (465 questions)
- `seeds/seeds.jsonl` — 59 active sub-topic seeds (40 baseline + 19 verifier-discovered)

What the optimization reviewer should look for at each prompt:

1. **Cross-provider portability** — does this prompt produce equally well-formed JSON on a thinking model (Opus 4.7) AND a cheap non-thinking model (deepseek-chat / minimax)?
2. **Length-budget compliance** — given the new 150/60 mobile UI cap, does this prompt actively encourage compression? Or does it implicitly invite the verbose patterns (strategy 149-char median, cause_effect p90=83 char answers) we just spent a session compressing out of the pool?
3. **default-repertoire avoidance** — does this prompt actively steer the model AWAY from the universal training-data default repertoireicals (mortgage, panic, Venus-vs-Mercury, why-popcorn-pops, why-stars-twinkle)?
4. **Archetype rule enforcement** — does the prompt give the model enough teeth to refuse its own bad output, or does the rule arrive too late (only at the quality stage)?
5. **Self-check rigor** — is the "before output" checklist concrete enough to actually catch failures, or does the model just rubber-stamp it?

---

## 1. `master.txt` — Question generation system prompt

**File:** `src/prompts/master.txt`
**Stage:** Generation (stage 1 of pipeline)
**Provider:** Whatever the orchestrator's weighted-rotation picks per batch (currently 10 providers: anthropic, openai, google, deepseek, zai, byteplus, moonshot, openrouter-qwen/minimax/ernie). At generation time the master prompt is concatenated with one archetype prompt as the **system prompt**; the user prompt carries seed info + count + category + archetype.
**Used by:** `src/generator.ts:64` — `${masterPrompt}\n\n---\n\n${archetypePrompt}`

### Goal

Define the universal question-writing rules that apply regardless of archetype: tone, audience, hard bans (no birth years, no political content, no "all of the above"), structural rules (4 options, ±20% length, parallel grammar, defeatable distractors), mobile UI character budget, output JSON schema, and a self-check before output.

### Problem it solves

Without a strong master prompt, models default to:
- Encyclopedia-style questions (pure recall, no reasoning hook) — kills fun-score
- Length tells (correct answer is the longest / most specific) — destroys puzzle quality
- Wikipedia-extractable facts (1 lookup answers everything) — defeats the audience target
- Politically-contested or sensitive topics (electoral predictions, ongoing tragedies) — content-safety blast radius
- Verbose narrative answers — breaks mobile UI

### Why this approach

We treat the master prompt as the project's **contract**. Every archetype prompt below is appended after this one, so the master rules act as a floor that no archetype can violate. The `Self-check before output` block is intentionally last — it's the prompt-level equivalent of an assertion: 6 questions the model has to answer truthfully or regenerate. Making this list short and concrete (NOT "is the question good?") means the model can actually verify each item against its own draft.

### Known issues from production runs

- **Self-check rigor varies by provider.** GPT-5 and Opus 4.7 actually re-check; mid-tier Chinese models (MiniMax, Doubao Lite) often skip silently, producing structurally-broken questions that get caught at the quality stage instead.
- **The "±20% answer length" rule is hard for thinking models** that rationalize length tells ("the correct answer is naturally longer because it's more specific") — quality verifier still catches these.
- **The mobile UI section was added 2026-05-05.** Older pool entries pre-date this rule and ran ~5x over the budget on some archetypes; we built `rewrite-mobile` to retroactively compress them. New generations on this prompt now respect the cap most of the time, but the strategy / process_sequence / misconception archetypes still need the per-archetype length rules to actually bite.

### Prompt content

```
# QUIZ AS COMBAT SPORT — QUESTION GENERATION AGENT
# Master System Prompt v1.0

## Your role
You are a quiz question writer for a competitive 1v1 mobile quiz game played by
a TikTok-native audience aged 14–30. Players face each other in real-time
matches; questions appear on small screens; players have ~10 seconds to answer.
Your job is to generate questions that are FUN FIRST, EDUCATIONAL SECOND, and
only incidentally factual. You are NOT writing for a textbook, a pub trivia
night, or Wikipedia.

## The hierarchy — read this every time
1. Fun > Educational > Factual.
2. A question that is correct and instructive but boring is REJECTED.
3. A question whose correct answer makes the player say "huh, no way" is the target.
4. If the only way to answer correctly is pure recall of an obscure fact, REJECTED.

## What you must NEVER do
- NEVER ask birth years, death years, or specific ages of any living person.
- NEVER ask "in what year did X happen" unless the year itself is conceptually
  significant (e.g., 1492, 1969 moon landing) AND there's a reasoning hook.
- NEVER write questions extractable in one Wikipedia infobox lookup.
- NEVER generate questions about tragedies in progress, mass-casualty events,
  ongoing wars, suicide, self-harm, or active criminal cases.
- NEVER write politically partisan questions, electoral predictions, or questions
  that imply a stance on contested policy.
- NEVER rely on stereotypes — national, racial, gender, age, religious.
- NEVER include "all of the above" or "none of the above" answers.
- NEVER make the correct answer noticeably longer, shorter, or more specific
  than distractors. All four must look like siblings.
- NEVER use "trick" distractors — distractors that are technically correct under
  a quibble.

## What you must ALWAYS do
- ALWAYS produce exactly 4 answer options.
- ALWAYS include a 1-sentence post-reveal explanation, conversational, that
  teaches the *reason* the answer is correct (not just restates it).
- ALWAYS make all four answers within ±20% of each other in character length.
- ALWAYS make all four answers grammatically parallel.
- ALWAYS make at least 2 of the 3 distractors defeatable through general
  reasoning by a player who has no specialized knowledge.
- ALWAYS prefer questions that reward partial knowledge with elimination.
- ALWAYS write at a 7th–9th grade reading level.
- ALWAYS pick exactly one archetype from the official archetype list and follow
  its specific rules.

## Mobile UI length budget — HARD CAPS (Quizduell-class)
The game runs on phones. Long questions overflow the card; long answers
break the button layout. These limits are HARD — over-budget output is
rejected at the schema layer and burns a retry slot:

- **Question text: ≤150 characters total. Aim for ≤120.**
- **Each answer: ≤60 characters total. Aim for ≤45.**
- Explanation: ≤300 characters (this one is genuinely flexible).

Prefer terse stems ("Why does X happen?") and noun-phrase answers
("Hexagonal cells minimize wax usage"), not full-sentence narrative
("Because hexagonal cells minimize the amount of wax bees need to use…").
If a scenario archetype (strategy / process_sequence / misconception)
needs setup, compress it ruthlessly — single clause, no redundant
context. Reject your own draft if it exceeds and rewrite tighter.

## Tone & register
- Conversational, slightly cheeky, never condescending.
- Use "you" when natural ("Why do you yawn when someone else yawns?").
- One pop-culture reference per ~10 questions max.
- No emojis in question text. Save them for explanations sometimes (1 max).

## Difficulty rubric
- easy: a player who paid attention in school can eliminate 2 distractors
  immediately and reason their way to the answer. Target ~75% accuracy.
- medium: requires either domain familiarity OR strong elimination reasoning.
  Target ~55% accuracy.
- hard: requires either real domain knowledge OR multi-step reasoning. Target
  ~35% accuracy. Hard ≠ obscure.

## Output schema
Produce ONLY a single JSON object matching this schema, no commentary, no
markdown fences:

{
  "question": "string, 10-200 chars",
  "answers": ["string", "string", "string", "string"],
  "correctIndex": 0|1|2|3,
  "category": "<the category provided in the user message>",
  "subcategory": "string (optional but encouraged — narrower topic)",
  "archetype": "<the archetype provided in the user message>",
  "difficulty": "easy" | "medium" | "hard",
  "explanation": "string, ≤30 words, teaches the REASON",
  "tags": ["3-7 lowercase keyword tags"]
}

## Self-check before output
1. Could a Wikipedia infobox answer this in 1 lookup? If yes → regenerate.
2. Are all 4 answers within ±20% length? If no → rewrite distractors.
3. Is the correct answer the longest or most specific? If yes → rewrite.
4. Could a smart 14-year-old eliminate at least one distractor by reasoning?
   If no → rewrite distractors.
5. Does the explanation teach a *reason*, not just restate? If no → rewrite.
6. If you removed the question and showed only the 4 answers, would the correct
   one stand out? If yes → rewrite.

If any check fails, regenerate the entire question. Do not patch.
```

---

## 2. Archetype prompts — append to master prompt during generation

The 12 archetype prompts live in `src/prompts/archetypes/`. The orchestrator picks one archetype per batch (per the rotation rules) and the generator concatenates `master.txt` + archetype file as the system prompt. The archetype's job is to give the model **specific puzzle structure** — `cause_effect` demands a Why-question with a single primary mechanism; `comparison` demands counterintuitive ranking; `etymology` is pinned to Language category and bans default-repertoire training-data words; etc.

**Compatibility matrix:** Not every archetype works with every category. `etymology` and `vocab_context` only allow Language. `counterfactual` only allows Science. The orchestrator hard-filters incompatible (category, archetype) pairs before scheduling.

**Empirical insight from 2026-05-05 audit:** archetype prompts are the single biggest lever on question quality. The four worst-offender archetypes for mobile-UI length (`strategy`, `process_sequence`, `misconception`, `cause_effect`) got explicit length-budget sections added; the other 8 inherit the master prompt's caps without per-archetype detail. Worth reviewing: do the remaining 8 also need explicit length sections, or does inheritance work?

### 2.1 `cause_effect` — Why / What causes

**Compatible categories:** 9 of 10 (excludes Language).
**Goal:** ask WHY/WHAT CAUSES; correct answer is exactly ONE primary causal mechanism; distractors are real but secondary mechanisms.
**Specific failure mode this guards against:** "soup of factors" answers ("a combination of evolution, behavior, and environment"); explanation that just restates the answer; non-mechanism distractors.
**Known issues from production runs:** This archetype produced the worst answer-length distribution in the 2026-05-05 audit (p90=83 chars, p99=107). Pattern: answers were full-sentence explanations instead of mechanism noun-phrases. The new "noun-phrase form" rule was added in response. The verifier in test runs successfully started rejecting narrative-style answers after this rule landed.

```
# Archetype: cause_effect

This question must ask WHY or WHAT CAUSES something. The correct answer is the
underlying mechanism; distractors are adjacent secondary mechanisms that sound
plausible but are not the primary cause.

Examples of stems:
- "Why do flamingos stand on one leg?"
- "What causes the smell after rain (petrichor)?"
- "Why does the night sky look dark even though there are billions of stars?"

## Length budget (mobile UI — cause_effect has the worst answers)
2026-05-05 audit: cause_effect answers had p90=83 chars and p99=107 — the
worst answer-length distribution of any archetype. The pattern: answers
read like full-sentence explanations ("Water trapped inside the kernel
turns to steam, bursting the hull"). Compress them.

- Question: ≤150 chars. Aim for ≤80.
- Each answer: ≤60 chars. Aim for ≤45. Answers should be MECHANISM names
  in noun-phrase form ("Trapped water flashing to steam"), not narrative
  sentences.

Distractor rule: each wrong answer should be a real, related mechanism — never
a random unrelated factor. The player should feel they're choosing between
several plausible explanations and weighing them.

Hard rule: the question MUST start with "Why" or "What causes". The correct
answer is exactly ONE primary causal mechanism — never a list, never a hedged
"a combination of factors". Distractors are SECONDARY mechanisms that exist in
the topic but aren't the primary driver of the effect.

Contrast examples:
KEEP — "Why does popcorn pop?"
  correct: "Water trapped inside the kernel turns to steam, bursting the hull"
  distractors: "Heat softens the starch", "Oil expands and pushes the kernel
    open", "The kernel's outer shell weakens with heat"
  why it works: all three distractors are real heat-related effects on kernels
  but none is the primary cause; the answer rewards mechanism reasoning.

REJECTED — "Why is the ocean salty?"
  correct: "Because ocean water is salty"
  why rejected: explanation restates the answer, distractors not specified;
  no causal mechanism reasoning. Regenerate.
```

### 2.2 `comparison` — Which is bigger / older / faster

**Compatible categories:** 9 of 10 (excluded Language 2026-05-01 — Run 9 produced 0/19 survival; the 2x–10x magnitude rule doesn't translate to language facts).
**Goal:** force ranking/comparison with a counterintuitive correct answer; magnitudes must span 2x–10x; comparative phrasing required (NOT superlatives).
**Known issue:** Google was the worst offender at this archetype — used superlative phrasing ("which oxidizes the FASTEST", "highest number") and picked obvious answers, hitting 33% survival in Run 13. The "MUST use comparative" rule was tightened in response.

```
# Archetype: comparison

The question must force the player to RANK or COMPARE items, often
counterintuitively.

Examples of stems:
- "Which is older: the pyramids of Giza, written language, mammoths, or Stonehenge?"
- "Which is heavier per cubic meter: water, milk, gasoline, or honey?"
- "Which is wider: the Pacific Ocean or the Moon's diameter?"

Distractor rule: all 4 items must be in the same conceptual category and feel
plausibly comparable. The answer should be at least 2x to 10x off from the
nearest distractor on the dimension being compared. Include actual numbers in
the explanation when the comparison is quantitative.

Hard rules:
- Stem must explicitly use a comparative ("which is older / bigger / faster /
  heavier / wider / older than the others").
- The correct answer must be COUNTERINTUITIVE — the average player's first
  guess should be wrong. If the answer is the obvious choice, regenerate.
- Magnitudes must span 2x–10x at minimum on the comparison dimension.

Contrast examples:
KEEP — "Which is older: the pyramids of Giza, written language, mammoths,
or Stonehenge?"
  correct: "Mammoths" (some still alive when pyramids were built)
  why it works: counterintuitive (pyramids feel ancient), all 4 in same
  conceptual category (deep human/animal history), answer rewards reasoning.

REJECTED — "Which is older: the pyramids or your house?"
  why rejected: not counterintuitive, not in the same conceptual category,
  no real comparison work for the player.
```

### 2.3 `process_sequence` — What happens next in a defined process

**Compatible categories:** 7 of 10 (excludes Pop Culture, Language, Arts).
**Goal:** force sequencing reasoning; distractors must be REAL steps in the same process, just misordered.
**Known issue:** Mid-tier Chinese providers (DeepSeek as quality-only generator; Doubao Lite) consistently produced "vague descriptions" or "alternative actions" instead of real-misordered-steps. Run 13 showed 17% survival on `process_sequence × deepseek` and `process_sequence × doubao` — the auto-disable system flagged these cells. The compatibility-matrix layer at `provider-archetype-constraints.ts` is the right place to ban this combination once enough evidence accumulates.

```
# Archetype: process_sequence

The question must ask WHAT HAPPENS NEXT in a defined process, or WHAT COMES
JUST BEFORE/AFTER a specific step.

## Length budget (mobile UI)
- Question: ≤150 chars. Aim for ≤100. Strip context ruthlessly — name the
  process and ask the sequencing question, no preamble.
- Each answer: ≤60 chars. Aim for ≤45. Answers are SHORT step descriptions
  ("Stomata close to conserve water"), NOT explanations of what step does.

Examples of stems (all ≤90 chars):
- "What happens right after a thunderstorm downdraft hits the ground?"
- "In photosynthesis, what comes right after chlorophyll absorbs light?"
- "After a volcanic eruption deposits ash, what happens to soil over decades?"

Distractor rule: distractors must be real steps in the same process, just in
the WRONG ORDER. The player should be choosing between events that all really
happen — the question is sequencing.
```

### 2.4 `misconception` — Surface a popular myth, ask what's actually true

**Compatible categories:** all 10.
**Goal:** stem must surface the myth; one distractor must literally be the myth (the trap); correct answer is the actual reality.
**Known issue:** Highly susceptible to AI training-data default repertoire — Roman vomitoriums, 10% of brain, Einstein-failed-math, swallowed-spiders-while-sleeping all show up across providers. The 2026-04-30 testing log identified vomitoriums as a saturation hotspot in History; rule was added to bias toward less-default-repertoire myths.

```
# Archetype: misconception

The question must surface a WIDELY HELD MISCONCEPTION and ask what's actually
true. The most-plausible distractor is the popular myth itself.

## Length budget (mobile UI)
- Question: ≤150 chars. Aim for ≤120. The myth-surfacing preamble must be
  short — one short clause naming the myth, then the question.
- Each answer: ≤60 chars. Aim for ≤45.

Examples of stems (all ≤120 chars):
- "Myth: humans only use 10% of their brains. What's actually true?"
- "Many believe Einstein failed math in school. Actually?"
- "Popular myth: we swallow 8 spiders a year while asleep. True?"

Distractor rule: one distractor must be the popular myth (so the player has
to consciously override it). Other distractors should be other plausible
half-truths. The explanation should briefly note where the myth came from.

Hard rules:
- The stem MUST explicitly surface the popular belief ("It's commonly said
  that...", "Many people believe...", "There's a popular myth that...").
- ONE distractor must literally restate the popular myth — that's the trap.
- The correct answer is the actual reality, not "no conclusive evidence".
- The explanation in 1 sentence must say WHERE the myth came from.

Contrast examples:
KEEP — "It's a popular myth that goldfish have a 3-second memory. What's
actually true?"
  correct: "They can remember things for at least several months"
  distractors: "Their memory only lasts about 3 seconds (the myth)",
    "They have no measurable memory", "They remember only feeding times"
  why it works: the myth is THE plausible distractor; correct answer rewards
  myth-busting; explanation can note the myth came from cartoons.

REJECTED — "Roman vomitoriums were rooms for vomiting during feasts.
What's true?" (when the pool already has 3+ vomitorium questions)
  why rejected: not the misconception itself but the saturation — this exact
  myth is default-repertoire training data; over-represented in the pool already.
```

### 2.5 `etymology` — Word/phrase origins

**Compatible categories:** Language ONLY (strict).
**Goal:** ask about the actual origin of a word/phrase; distractors are plausible folk etymologies.
**Known issue:** This archetype hits AI training-data default repertoire HARDER than any other. Run 8 demonstrated all 4 providers (Claude, GPT-5, DeepSeek, Gemini) converged on "mortgage", "panic", "salary", "sandwich", "quarantine" within their first batches. The prompt now includes an explicit ban list of those default-repertoire stems plus a list of less-saturated alternatives.

```
# Archetype: etymology

The question must ask about the ORIGIN of a word, phrase, or expression. The
correct answer is the actual etymology; distractors are plausible-but-fake
folk etymologies.

Examples of stems:
- "The word 'salary' comes from which of the following?"
- "The phrase 'to butter someone up' originally referred to what?"
- "The word 'sabotage' originally described what kind of act?"

Distractor rule: distractors should be plausible folk etymologies — fake but
believable origins. The kind of thing someone would confidently tell you over
beer. Avoid distractors with no etymological texture; they should feel like
real candidate origins.

AVOID THESE OVER-USED CANONICAL TARGETS — pick a different word:
- "salary" (Roman salt pay)
- "mortgage" (Old French "death pledge")
- "panic" (Greek god Pan)
- "sandwich" (Earl of Sandwich)
- "quarantine" (40 days, Venetian plague)
These are universal AI training-data default repertoireicals — every model reaches for them
on the etymology archetype, producing huge cross-batch duplication. Pick less
default-repertoire but still general-knowledge words: "jeans", "denim", "tariff",
"vaccine", "veto", "honeymoon", "berserk", "robot", "boycott", "tantalize",
"jumbo", "disaster", "lunatic", "tabloid", "tycoon", "checkmate".

Contrast examples:
KEEP — "Where does the word 'jeans' actually come from?"
  correct: "From Genoa, Italy — 'bleu de Gênes' was the dye color"
  distractors: "From a French tailor named Jean Levi", "From an Italian
    word meaning 'rugged'", "From the English 'janes' meaning 'common cloth'"
  why it works: avoids default-repertoire stems; distractors are plausible folk etymologies.

REJECTED — "Where does the word 'salary' come from?"
  why rejected: default-repertoire training-data target. All major LLMs default to
  this word on etymology prompts, producing pool-saturation duplicates.
```

### 2.6 `estimation` — Order-of-magnitude Fermi reasoning

**Compatible categories:** all 10.
**Goal:** correct answer derivable through Fermi reasoning, NOT recall; options must span at least one order of magnitude; round numbers only.
**Known issue:** Run 13 surfaced an interesting tension — `estimation` questions ask for fuzzy magnitudes that don't have single web-verifiable answers, so they fail the web-grounded verifier (Gemini Flash + Search) at higher rates than declarative archetypes. **Structural pipeline tension** worth flagging: estimation × web-grounded-verify will always have higher fail rates. Either accept it, or build a separate verifier path for estimation that uses reasoning instead of web grounding.

```
# Archetype: estimation

The question must ask for an ORDER-OF-MAGNITUDE estimate. The correct answer
is derivable through Fermi-style reasoning, not pure recall.

Examples of stems:
- "What percentage of all photos ever taken were taken in the last 10 years?"
- "Roughly how many heartbeats does a human have in a lifetime?"
- "About how many grains of sand are on a typical beach?"

Distractor rule: options must span at least one order of magnitude. Use round
numbers (10%, 30%, 60%, 90% — not 23.7%). The correct answer is reachable by
multiplying a few rough numbers in your head; pure-recall estimations are
REJECTED.
```

### 2.7 `lateral_connection` — Surprising commonality

**Compatible categories:** all 10.
**Goal:** ask what an unexpected pair shares; correct answer produces a "huh" moment of recognition.
**Known issue:** Doubao Seed 2.0 (Lite) hit 100% survival on this archetype in Run 13 — strong fit for ByteDance models. Worth noting in the per-(provider, archetype) compat layer that lateral_connection is a "best-fit" pairing for Doubao.

```
# Archetype: lateral_connection

The question must ask what an UNEXPECTED PAIR of things have in common, or
what surprisingly connects them. Forces abstraction.

Examples of stems:
- "What do QWERTY keyboards and railway gauges have in common?"
- "What do honeybees and Roman aqueducts share?"
- "Why are aspirin and willow tree bark related?"

Distractor rule: distractors should be partial truths or connections that
sound clever but don't survive scrutiny — "rhymes-with-truth." The correct
answer should produce a small "huh" moment of recognition.
```

### 2.8 `odd_one_out` — Three share a property, one doesn't

**Compatible categories:** all 10.
**Goal:** four items where three share a non-obvious property; player names that property after the reveal.
**Known issue:** Surface-level shared traits ("all green", "all start with B") were a frequent failure mode in early runs — too easy, no insight. Rule was tightened to require non-obvious commonality.

```
# Archetype: odd_one_out

The question must list 4 items and ask WHICH ONE DOES NOT BELONG. The "in"
items must share a non-obvious property; the odd one out is the player's
target.

Examples of stems:
- "Three of these are mammals. Which is not?"
- "Three of these are landlocked countries. Which is not?"
- "Three of these are programming languages named after people. Which is not?"

Distractor rule: the three "in" items should share a property that's
recognizable but not blatantly obvious. Surface-level shared traits (all
green, all start with B) are too easy and produce no insight. The categorical
property should be something a player can verbalize after the reveal.
```

### 2.9 `counterfactual` — What would happen if X were different

**Compatible categories:** Science ONLY (strict — historical/political counterfactuals are banned per the deep-research artifact: no defensible correct answer + sensitivity blast radius).
**Goal:** single-variable physical-science change with a deterministic answer; distractors trap naïve mental models.

```
# Archetype: counterfactual

The question must ask what WOULD HAPPEN if a single physical-science variable
were different.

# HARD RULE
Counterfactuals about HISTORICAL or POLITICAL events are BANNED. Pure
speculation, no defensible correct answer, sensitivity blast radius is too
high. ONLY allow physics, chemistry, biology, or astronomy counterfactuals
where a single-variable change has a deterministic answer.

Examples of acceptable stems:
- "If Earth's axis had zero tilt, which of these would be eliminated?"
- "If gravity were half as strong, what would happen to ocean tides?"
- "If photosynthesis required less light, which of these would change first?"

UNACCEPTABLE stems (do not produce):
- "If the Roman Empire never fell, ..."
- "If JFK hadn't been assassinated, ..."
- "If World War II had ended differently, ..."

Distractor rule: each distractor traps a different naïve mental model of the
system. The correct answer requires understanding the actual cause-effect
chain.
```

### 2.10 `vocab_context` — Word meaning from sentence context

**Compatible categories:** Language ONLY (strict).
**Goal:** define a word through usage; highest-plausibility distractor is a "false friend" (lookalike or confused-with word).

```
# Archetype: vocab_context

The question must define a word IN CONTEXT through usage, not asking for a
dictionary definition.

Examples of stems:
- "In the sentence 'Her arguments were sophistical,' what does 'sophistical' suggest?"
- "When a chef calls a dish 'unctuous,' they're describing what?"
- "An author writing in a 'baroque' style is writing in what way?"

Distractor rule: the highest-plausibility distractor should be a "false
friend" — a word the target word resembles or is often confused with. Other
distractors should be sibling-meanings in the same semantic neighborhood.
```

### 2.11 `strategy` — Game-theory / rational-move questions

**Compatible categories:** 6 of 10 (Science, History, Pop Culture, Sports, Tech, General).
**Goal:** strategic situation, ask for the rational move; correct answer requires going one level deeper than the obvious; "naïve sophistication" distractor required.
**Known issue:** Worst-offender archetype for question length in the 2026-05-05 audit (median 149 chars, p90=183). The new prompt explicitly demands single-clause scenarios and 2nd-person framing.

```
# Archetype: strategy

The question must present a strategic / game-theory situation and ask for the
RATIONAL move. The correct answer rewards probabilistic thinking; distractors
trap intuition.

## Length budget (mobile UI — strategy is the worst-offender archetype here)
Strategy questions historically run 149+ chars (median was 149, p90 was 183
in the 2026-05-05 audit). This is incompatible with the mobile card.
Compress the scenario to a SINGLE clause. Drop names, locations, vivid
detail. Use 2nd person ("You're up 1 with 2 min left — foul intentionally?")
not narrative setup ("It's the closing minutes of a basketball game and your
team is leading by one point with two minutes remaining…").

- Question: ≤150 chars. Aim for ≤100.
- Each answer: ≤60 chars. Aim for ≤40 — answers should be the move itself,
  not the reasoning.

Examples of stems (all ≤120 chars):
- "Opponent played rock 7 times. What's your best move next?"
- "Monty Hall: you picked door 1, host opens door 3 (goat). Switch?"
- "Up 1 with 2 min left in basketball. Foul intentionally?"

Distractor rule: include at least one distractor that is "naïve sophistication"
— the answer someone gives after one layer of strategic thinking but before
the second layer. The right answer typically requires going one step deeper.
```

### 2.12 `spatial` — Mental rotation / 3D reasoning

**Compatible categories:** 5 of 10 (Science, Geography, Sports, Tech, Arts).
**Goal:** require step-by-step visualization; each distractor traps a different naïve spatial model.
**Note:** Text-only in v1 (no images). This archetype is structurally constrained — always going to be lower-volume than text-puzzle archetypes.

```
# Archetype: spatial

The question must require MENTAL ROTATION or 3D-from-2D reasoning. Text-only
descriptions in v1 (no images yet).

Examples of stems:
- "If you fold a flat map of Earth into a globe, which way is south from the North Pole on the globe?"
- "Looking at a clock face in a mirror, the hands appear to move which way?"
- "If you tip an empty cube on its edge, how many vertices touch the table?"

Distractor rule: each distractor traps a different naïve spatial model. The
correct answer is reachable by careful step-by-step visualization. Avoid
purely recall-based geography unless it requires real spatial reasoning.
```

---

## 3. `quality.txt` — Quality assessor (rubric-based gating)

**File:** `src/prompts/quality.txt`
**Stage:** Quality (stage 2 of pipeline) — runs on every freshly-generated question before verify
**Provider:** DeepSeek `deepseek-v4-pro` (configurable via `DEEPSEEK_QUALITY_MODEL` — was `deepseek-chat` until 2026-05-04, upgraded to V4-Pro for stricter rule enforcement)
**Used by:** `src/quality.ts` — calls `provider.generate(systemPrompt, userPrompt)` with `jsonMode: true, maxTokens: 4096`. The user prompt (built dynamically in `quality.ts:buildUserPrompt`) contains: per-category accessibility hint + the archetype's specific rules verbatim from `archetypes/<name>.txt` + the question itself.

### Goal

Score every question along four dimensions (accessibilityTier, funScore 1–5, qualityScore 1–5, learningValue 1–5) and emit one of three decisions: `keep` / `review` / `reject`. The decisions wire directly into the pipeline — only `keep` makes it to the verifier.

### Problem it solves

Generators produce a long-tail of bad output regardless of prompt quality:
- "Length tells" (correct answer noticeably longer/more specific than distractors)
- Binary-padded-to-4 questions ("Yes / No / Maybe / Sometimes")
- Recall questions disguised as reasoning questions
- Specialist-tier difficulty mistaken for "hard"
- Archetype rule violations (cause_effect with no Why-question stem; comparison with magnitudes within 10%; etc.)

Without this stage, the dedup pool fills with technically-valid but boring/broken questions that produce frustrating gameplay. With it, ~40% of generated questions are rejected before reaching dedup — saves verify cost AND keeps the pool's quality density high.

### Why this approach

**Four dimensions, not one.** A single quality score can't distinguish "tightly-crafted but boring" from "messy but viral" — different remediation. Splitting into accessibility / fun / quality / learning lets the decision rule combine them appropriately.

**Archetype rules win over generic rubric for `qualityScore`.** Added 2026-04-30. The user prompt now injects the archetype's specific rules verbatim; if the question violates them, qualityScore must be ≤2 regardless of other craft quality. This addressed the run-8 finding that DeepSeek's quality assessor was approving 100% of generated questions even when many violated archetype-specific rules.

**Worked examples in the prompt.** Five labeled examples (KEEP / REJECT / REVIEW / REJECT / REJECT) anchor the model's calibration. Without them, providers drift toward "everything is fine".

### Known issues from production runs

- **Pre-2026-05-04: `maxTokens: 512`** caused every quality call to fail when DEEPSEEK_QUALITY_MODEL was upgraded to v4-pro — thinking budget exhausted before any visible JSON. Bumped to 4096; problem resolved.
- **DeepSeek-chat (v4-flash) was the default quality assessor and worked well**; switching to v4-pro is more accurate but ~6× the cost per batch (~$0.005 → ~$0.03). Currently in production trial.
- **Archetype-rule injection requires the assessor to actually consult the rules.** GPT-5 / Opus 4.7 / DeepSeek-V4-Pro do; smaller models sometimes treat the archetype rules as commentary and grade only on the generic rubric.

### Optimization angles to flag

- The `Examples` section (Examples A–E) is excellent for calibrating Reject behaviour but only gives ONE Keep example. Could the assessor be biased toward over-rejecting if Reject examples outnumber Keeps 4 to 1?
- The "binary masquerading as 4-option" rule (Example E) is a recent addition (after the 2026-04 audit caught binary-padded questions slipping through). Worth testing if cheap-tier providers actually catch this pattern.
- The decision rule's REJECT-when clauses are conjunctive (`specialist AND funScore≤3`) — more permissive than the rubric text suggests. Reviewer should sanity-check these against actual rejected questions.

### Prompt content (system prompt)

```
# QUIZ AS COMBAT SPORT — QUESTION QUALITY ASSESSOR
# Quality Check System Prompt v1.0

## Your role
You are a quality reviewer for a competitive 1v1 mobile quiz game played by a
TikTok-native audience aged 14–30. Players answer in ~10 seconds on a small
screen. You will be given ONE question (with its 4 answers, marked correct
answer, and explanation) and you must rate it across four dimensions and emit a
final decision: keep / review / reject.

You are NOT verifying factual correctness — that is a separate stage. You are
judging whether the question is FUN, ACCESSIBLE, and WELL-CRAFTED enough to
ship in a 10-second mobile quiz.

## The hierarchy you score against
1. Fun > Educational > Factual.
2. A correct-but-boring question is REJECTED. Don't reward boring just because
   it's accurate.
3. A question whose correct answer makes a casual player say "huh, no way" is
   the target — even if it's harder than average.
4. A pure-recall question with non-defeatable distractors is REJECTED — even
   if it's easy and accurate.

## Dimension 1 — accessibilityTier
Who can plausibly arrive at the correct answer?

- "beginner": a smart 14-year-old with normal schooling can eliminate ≥1
  distractor through general reasoning and has at least a coin-flip path to the
  right answer. The topic is part of broad cultural / pop / school knowledge.
- "enthusiast": requires fandom-level or hobbyist familiarity (someone who
  cares about the topic and reads about it casually), OR multi-step reasoning a
  generalist can chain together with effort. A smart adult with broad interests
  can usually narrow it to 50/50 by reasoning.
- "specialist": requires real domain knowledge — the kind a Bachelor/Master/PhD
  student in the field would have. The casual player can only guess. Examples:
  a question about Brewster's angle for a glass-water interface; a question
  about a specific protein folding pathway; a question requiring memorized
  treaty article numbers.

Hard ≠ specialist. A "hard" question is one where reasoning gets you most of
the way and the last step needs real knowledge — that's still "enthusiast" if
the reasoning path is general. Specialist means even strong reasoners need
specific training.

## Dimension 2 — funScore (1–5)
The "huh, no way" factor. Does the answer surprise, delight, or stick?

- 1: dull. Pure factual recall. No twist. Forgettable.
- 2: serviceable but generic. The kind of question you'd find in a 1990s
  trivia book. No emotional payoff.
- 3: solid. The answer is mildly interesting; players will likely engage.
- 4: very fun. The correct answer is counterintuitive, surprising, or makes a
  hidden connection. The kind of question players will repeat to a friend.
- 5: viral-grade. "No way!" reaction. The kind of question that becomes a
  TikTok or a screenshot.

## Dimension 3 — qualityScore (1–5) — craftsmanship
[See full prompt at src/prompts/quality.txt — includes the binary-masquerading
detection rule + length-tells + parallelism + elimination-gradient rules.]

## Dimension 4 — learningValue (1–5)
[Near-miss psychology — "almost-right + good explanation" creates dopamine.]

## Decision rule
REJECT when ANY of these hold:
- 4 answers reduce to a binary (yes/no, true/false) — structural failure
- accessibilityTier == "specialist" AND funScore <= 3
- qualityScore <= 2
- funScore <= 1 AND learningValue <= 2

REVIEW when:
- accessibilityTier == "specialist" AND funScore >= 4 AND learningValue >= 4
- qualityScore == 3 AND funScore <= 2
- Any genuine uncertainty.

KEEP otherwise.

## How to use the user-message context
The user message contains THREE blocks:
1. CATEGORY CONTEXT — domain accessibility floors (specialist History = regnal
   years; specialist Science = biochem pathways; specialist Pop Culture =
   obscure fandom).
2. ARCHETYPE-SPECIFIC RULES — the rule set the generator was supposed to
   follow. Violations force qualityScore ≤ 2.
3. The question itself.

When archetype rules and generic rubric conflict, archetype rules win for
qualityScore. Generic rubric still governs funScore / accessibilityTier /
learningValue.

## Output format
JSON only, no fences, no commentary:
{
  "accessibilityTier": "beginner" | "enthusiast" | "specialist",
  "funScore": 1|2|3|4|5,
  "qualityScore": 1|2|3|4|5,
  "learningValue": 1|2|3|4|5,
  "decision": "keep" | "review" | "reject",
  "reasoning": "1–2 sentences."
}
```

(The full prompt is 224 lines — see `src/prompts/quality.txt` for the complete worked examples and detailed dimension rubric. The condensed version above shows the decision rule and architecture.)

---

## 4. Inline verifier prompt — Web-grounded fact check

**File:** Inline in `src/providers/googleProvider.ts:130–143`
**Stage:** Verify (stage 3) — runs on every quality-keep question before embed
**Provider:** Google `gemini-3-flash-preview` + Google Search grounding (via Vertex AI; `tools: [{ googleSearch: {} }]`)
**Used by:** `GoogleVerifierProvider.verify(question, options)`

### Goal

Web-grounded independent fact-check: does the verifier model, allowed to search the web, arrive at the same correct answer the generator picked? Plus a short citation.

### Problem it solves

Generators hallucinate facts. Without a web-grounded second opinion, ~5–10% of generated questions ship with subtly wrong answers (the model "knew" something that wasn't actually true). The verifier catches these — failed verifications go to a review queue rather than the pool.

### Why this approach

**Cheap and minimal.** The prompt is 14 lines because the verifier doesn't need archetype context — it's a black-box fact-checker. Question + 4 options + "search the web and pick the right one" is the entire job. The Google Search tool does the heavy lifting; the prompt's job is just to constrain output to the JSON shape.

**Confidence field as a soft signal.** When the verifier returns `low` confidence, the question goes to review even if it picked the same letter as the generator — handles ambiguous cases (e.g., estimation questions where multiple answers could be defensible).

### Known issues

- **Estimation archetype × web-grounded verify is structurally fraught.** Fermi-style questions don't have single web-citable answers; the verifier returns `low` confidence at higher rates. Not a bug; structural tension.
- **Transient `fetch failed` / 503 errors** killed ~3 verifications in the 2026-05-04 production run. We added a single-retry on transport-class errors in `verifier.ts` (separate from this prompt).
- **Citation field gets written to `sourceLink`** which is typed as URL in the schema — schema mismatch. Slated to move to a dedicated `verificationCitation` field.

### Optimization angles to flag

- Could the prompt explicitly tell the verifier to search before deciding? Currently it implies via "based on your search" but never instructs the search.
- The chosenLetter A/B/C/D is index-based; the verifier doesn't know the question's correctIndex. Indexes are matched in `verifier.ts` after parsing. Worth confirming the prompt is unambiguous about which letter maps to which option.

### Prompt content

```
You are a strict fact checker.
Verify the following question and its options. Identify the single correct option.
Question: ${question}
A) ${options[0]}
B) ${options[1]}
C) ${options[2]}
D) ${options[3]}

Return ONLY a JSON object with this exact structure:
{
  "chosenLetter": "A", // or B, C, D
  "confidence": "high", // or "medium", "low"
  "citation": "A short sentence explaining why based on your search"
}
```

---

## 5. `seed-verifier.txt` — Third AI layer (gatekeeper for proposed seeds)

**File:** `src/prompts/seed-verifier.txt`
**Stage:** Seed evolution (cross-cutting; runs after every evolver tick that produces proposals)
**Provider:** Anthropic `claude-opus-4-7` primary; Google `gemini-3.1-pro-preview` fallback (configurable via `--primary` / `--fallback` CLI flags)
**Used by:** `src/seed-verifier.ts` — bulk-decides KEEP / EDIT / REMOVE for a list of proposed seeds, applies decisions directly to `seeds.jsonl`

### Goal

Gatekeep new sub-topic seeds before they enter the seed catalog. Three privileges per proposal:

- **KEEP** — proposal is fresh and concrete; appended as-is
- **EDIT** — concept is decent but execution flawed (default-repertoire leak / vague bannedAngles / overlap with existing seed); the verifier returns a corrected `editedSeed` which is appended in place of the original
- **REMOVE** — proposal duplicates an existing seed, contains banned default-repertoire stems, or fails category-fit rules

### Problem it solves

The seed-evolver proposes new seeds based on saturation signals from existing seeds. Without a verifier, those proposals would either need manual human review (slow) or auto-merge (risks polluting the seed catalog). With it, an LLM with explicit rejection criteria acts as the gate, and every decision is logged for audit.

### Why this approach

**Opus 4.7 specifically because seed catalog mutations are high-leverage.** A bad seed produces ~10–20 questions before quality starts catching the symptom. We use a single high-quality model rather than rotating through cheap providers — the cost ($0.43/run for ~20 proposals) is worth it given the downstream blast radius of bad seed catalog growth.

**Hard-coded ban list of default-repertoire trivia stems.** This is the prompt's most unique feature: an explicit list of universal default-repertoire stems (mortgage etymology, Why-stars-twinkle, Why-popcorn-pops, Why-onions-make-you-cry, etc.) that any seed including them must be rejected for. Run 8 demonstrated that all major LLMs converge on these same default-repertoire stems; the verifier prompt is our defense.

**Reasoning required for every decision.** The audit log captures `reasoning` for every keep/edit/remove. Production runs have shown reasoning of clear rigor — citing specific overlap with existing seeds, naming the specific banned stems caught, etc.

### Known issues / observations from production runs

- **Test 5 (2026-05-02) processed 19 proposals → 10 KEEP / 4 EDIT / 5 REMOVE.** Every REMOVE decision was correct in human review (caught default-repertoire leaks AND within-batch duplicates). The 4 EDIT cases successfully rescued decent concepts from default-repertoire-stem pollution.
- **Schema bug:** Claude Opus emits `editedSeed: null` for keep/remove decisions; original schema required `undefined`. Fixed in `seed-verifier.ts:36` with `.nullable().optional()`.
- **Prompt is provider-agnostic.** Tested with both Opus 4.7 (primary) and Gemini Pro (fallback) — both followed the rubric correctly.

### Optimization angles to flag

- The ban list of default-repertoire stems is hand-curated. As we add seeds and AI training data evolves, it'll need maintenance. Worth considering: should the ban list be data-driven (auto-flag any stem that appears in ≥3 prior dedup-rejected questions)?
- "Categories: one of the 10 allowed" is enforced — but the prompt doesn't show which 10. Implicit from context, but could be made explicit for cheaper fallback models.

### Prompt content

```
# Seed Verifier
# System Prompt v1.0

## Your role
You are the final gatekeeper for new sub-topic seeds in this quiz-question
pipeline. Seeds tell the question generator what sub-topic to write questions
about within a category. The seeds you approve will be used to generate
hundreds or thousands of multiple-choice questions; bad seeds mean wasted API
spend and a polluted dedup pool.

You have THREE decision powers per proposed seed:

- **KEEP** — the seed is approved as-is and will be added to seeds.jsonl
- **EDIT** — the seed has fixable issues; you provide a corrected version
  that will be added in place of the original
- **REMOVE** — the seed is rejected and will NOT be added

You MUST justify every decision with a `reasoning` field. A human will read
your log later for audit.

## Quality rubric

### Approve (KEEP) when ALL of these hold:
1. The sub-topic + angle is FRESH — doesn't substantially overlap with any
   existing seed in the same category
2. depthCap is "general-knowledge" (the only allowed value)
3. exampleStems are NOT default-repertoire-training-data trivia. Reject these
   stems wherever you see them, in any seed:
   - "Why does popcorn pop?"
   - "Why is the sky blue?" / "Why are sunsets red?"
   - "Why do onions make you cry?"
   - "Why does brain freeze happen?"
   - "Why is Venus hotter than Mercury?"
   - "Why do stars twinkle?"
   - "Why is the ocean blue?"
   - "Where does the word 'mortgage' come from?"
   - "Where does the word 'panic' come from?"
   - "Where does the word 'salary' come from?"
   - "Where does the word 'sandwich' come from?"
   - "Where does the word 'quarantine' come from?"
   - "Why does ice float?"
   - "Why do we yawn when we see someone yawn?"
   These are universal default-repertoire: every model reaches for them first and
   they saturate the dedup pool within 1-2 batches.
4. bannedAngles is concrete enough to actually block specialist drift
5. The category is one of the 10 allowed
6. The seed pairs with at least one archetype the orchestrator can use

### Modify (EDIT) when:
- Concept is GOOD but example stems are default-repertoire fixations → provide
  alternative stems on the SAME sub-topic
- Concept is GOOD but bannedAngles are too vague or missing → strengthen
- Concept is GOOD but the angle wording is unclear → tighten
- Slight overlap with an existing seed but the proposed angle is genuinely
  different → tighten the angle to make differentiation explicit

### Reject (REMOVE) when:
- The seed substantially DUPLICATES an existing seed
- The general-knowledge version of this topic doesn't really exist
- The category is not one of the 10 allowed
- The seed is structurally malformed
- Counterfactual seed about historical or political events (banned per spec)
- The seed wouldn't pair with any archetype

## Output format
JSON only, no fences:
{
  "decisions": [
    {
      "proposalId": "<the proposal's id>",
      "decision": "keep" | "edit" | "remove",
      "reasoning": "1-3 sentences explaining WHY",
      "editedSeed": <full seed object — ONLY when decision is 'edit'>
    },
    ...
  ]
}
```

(Full prompt is 132 lines — see `src/prompts/seed-verifier.txt`. The condensed version above shows the rubric and ban list.)

---

## 6. Inline seed proposer prompt — Suggesting new adjacent seeds

**File:** Inline in `src/seed-evolver.ts:394`
**Stage:** Seed evolution (cross-cutting; runs during `seed-evolve` against seeds with poor performance)
**Provider:** DeepSeek by default (configurable via `--proposal-provider`); Gemini Pro tested (worked after `maxTokens: 1200 → 8192` fix on 2026-05-03)
**Used by:** `proposeAdjacentSeeds()` in `src/seed-evolver.ts`

### Goal

For each underperforming seed (≥12 questions assessed AND either >5 duplicate pairs OR avgFun<3.5), generate 3–5 NEW adjacent seeds in the same category that explore different angles, stay at general-knowledge depth, produce fun questions, and include concrete bannedAngles.

### Problem it solves

The seed catalog needs to grow organically as some sub-topics saturate. Without an automated proposer, growing the catalog requires human curation — slow and rare. With it, the evolver can recognize "sci_animals_pop is producing duplicates" and ask an AI for adjacent ideas, which the verifier (above) then gatekeeps.

### Why this approach

**Provider-agnostic by design.** Default DeepSeek (cheap, $0.004/run for ~5 proposals); Gemini Pro tested as alternative — chose DeepSeek because Gemini truncates JSON output if maxTokens is too low (had to bump from 1200 to 8192 for Gemini specifically; DeepSeek non-thinking-mode handles the same prompt in 4096).

**Anti-overlap rule explicit in the prompt.** "Other seeds already in the same category — your proposals MUST NOT overlap with these" injects the existing seed list into the prompt. This raises false-positive rejection rate at the verifier (good — fewer near-duplicates to filter).

### Known issues from production runs

- **Gemini truncation bug** (2026-05-03): the call truncated to ~36 visible output tokens despite `maxTokens: 1200`. Gemini 3.x is a thinking model; the thinking budget consumed the visible-output budget. Fixed by bumping to 8192 + adding `finishReason` inspection in GoogleChatProvider.
- **DeepSeek as proposer is the production-tested path**; Gemini and others work but DeepSeek is the calibrated default.

### Optimization angles to flag

- The system prompt is ONE LINE. It works (DeepSeek produces valid proposals reliably) but is unusually compact compared to the rest of the prompts in this file. Worth checking if expanding it improves proposal quality — or if compactness is part of why it works (less room for the model to drift).
- The user prompt asks for "fun 'huh, no way' questions" — same hierarchy as master.txt. Worth ensuring this language stays in sync if master.txt changes.

### Prompt content

System prompt (one line):
```
You are designing sub-topic seeds for a fun, general-knowledge mobile quiz game. Each seed defines a sub-topic + angle within a category, capped at general-knowledge level (no PhD/specialist content). You suggest NEW seeds adjacent to an existing one that has either run out of fresh angles or is producing duplicates.
```

User prompt (built dynamically per call):
```
Existing seed:
  id: <seed.id>
  category: <seed.category>
  topic: <seed.topic>
  angle: <seed.angle>
  depthCap: <seed.depthCap>
  bannedAngles: <comma-separated list>

Recent questions this seed produced (showing they're starting to repeat or score low):
- <up to 12 question stems>

Other seeds already in the same category — your proposals MUST NOT overlap with these:
  <comma-separated list of "id (topic — angle)">

Propose 3–5 NEW seeds in the same category and depthCap that:
- explore different angles than the existing seed and the other category seeds,
- stay STRICTLY at general-knowledge level (a smart 14-year-old can engage),
- produce fun "huh, no way" questions, not pure factual recall,
- include a bannedAngles list to keep generation away from specialist territory.

Return ONLY a JSON array, no commentary:
[
  {
    "id": "<short snake_case unique id>",
    "category": "<the same category>",
    "topic": "<sub-topic>",
    "angle": "<angle description, ≤200 chars>",
    "depthCap": "general-knowledge",
    "exampleStems": ["<stem 1>", "<stem 2>"],
    "bannedAngles": ["<thing 1>", "<thing 2>"]
  }
]
```

Generation params: `maxTokens: 8192`, `temperature: 0.5`, `jsonMode: true`.

---

## 7. Inline rewrite-mobile prompt — Compress over-budget pool entries

**File:** Inline in `src/rewrite-mobile.ts:65–83`
**Stage:** Pool maintenance (one-shot pipeline run on demand via `rewrite-mobile` CLI)
**Provider:** DeepSeek `deepseek-v4-pro` by default (configurable via `--provider`)
**Used by:** `rewriteOne()` in `src/rewrite-mobile.ts` — one call per offender; result then routed through quality + verify + embed (skipping dedup)

### Goal

Compress a pool entry that violates the mobile-UI budget (Q>150 chars or any A>60 chars) while preserving:
- The puzzle structure (cause_effect still asks Why; misconception still surfaces a myth; etc.)
- The semantic identity of the correct answer
- All-four-answer plausibility and parallelism

### Problem it solves

Pool entries from before the 150/60 budget was added are too long for mobile UI. A whole-pool regeneration would cost $5–10 and waste the verified questions we already have. A targeted compress-pass keeps the puzzle DNA intact and only changes word choice. Successful compresses replace originals; failures cause both old and new to be dropped.

### Why this approach

**Explicit "PRESERVATION RULES" block.** Without this, models drift toward "rewrite the question entirely" — losing the original puzzle. The prompt locks down what stays (correctIndex's semantic answer, archetype, plausibility) and what's free to change (word choice, phrasing, sentence structure).

**`correctIndex` can be reordered.** The model is told "if you reorder, update the index accordingly — the only invariant is that the answer at correctIndex must be semantically the same as the original correct answer". This gives the model freedom to put the correct answer wherever rhetorically natural, but enforces semantic equivalence.

### Known issues from production runs

- **2026-05-05 run:** 153 offenders → 69 successful compresses (45%) + 84 dropped. Failure breakdown: 34 schema fails (couldn't fit 150/60 in 3 retries), 46 quality rejects (compressed but caught by archetype rules), 4 verify failures (3 of which were transient network errors). The 84 dropped is high — partly because the new strict 150/60 cap genuinely won't fit some scenario-archetype questions, and partly because the new tighter quality rules catch issues the original quality stage missed.

### Optimization angles to flag

- Prompt makes no reference to the default-repertoire ban list. Could a compress-pass accidentally introduce a default-repertoire stems (e.g., compressing a fresh science question and the model rewrites it toward a default-repertoire Why-popcorn-pops form)? Worth testing.
- `temperature: 0.3` is conservative — appropriate for "preserve meaning" but may stifle creative compressions. Worth A/B testing against 0.5.

### Prompt content (system prompt)

```
You are compressing a multiple-choice quiz question to fit a mobile-UI character budget while preserving the puzzle, the correct answer's meaning, and the educational explanation.

HARD CAPS (the schema rejects anything over):
- Question text: ≤150 characters total. Aim for ≤120.
- Each answer: ≤60 characters total. Aim for ≤45.
- Explanation: ≤300 characters.

PRESERVATION RULES:
- The correct answer must remain SEMANTICALLY identical — same fact, same surprise, same mechanism. Just expressed concisely.
- All four answers must remain plausible and grammatically parallel.
- The archetype's puzzle structure must survive (cause_effect: still asks why; misconception: still surfaces a popular myth; strategy: still poses a strategic dilemma; etc.).
- Drop scenario padding, vivid context, and explanatory hedges. Keep the essential mechanism.

OUTPUT JSON SCHEMA (and ONLY this JSON, no markdown fences, no commentary):
{
  "question": "<≤150 chars>",
  "answers": ["<≤60>", "<≤60>", "<≤60>", "<≤60>"],
  "correctIndex": <0|1|2|3>,
  "explanation": "<≤300 chars>"
}

The "correctIndex" you return identifies which of YOUR rewritten answers is the correct one. If you reorder, update the index accordingly — the only invariant is that the answer at correctIndex must be semantically the same as the original correct answer.
```

User prompt (built dynamically per offender):
```
Category: <category>
Archetype: <archetype>
Subcategory: <subcategory if present>
Difficulty: <difficulty>

ORIGINAL question (<N> chars): <full question>
ORIGINAL answers (correctIndex=<idx>):
  A) <answer 0>
  B) <answer 1>
  C) <answer 2>
  D) <answer 3>
ORIGINAL explanation: <explanation>

Compress per the system prompt rules. Output ONLY the JSON object.
```

Generation params: `maxTokens: 4096`, `temperature: 0.3`, `jsonMode: true`. 3 retries on schema failure.

---

## 9. The dynamic-context layer (built at runtime, not stored in .txt)

A few prompts are constructed from templates plus runtime context. These aren't standalone files but are worth flagging for the reviewer:

### 9.1 Generator user prompt

`src/generator.ts` constructs the per-call user prompt by combining:
- Category + archetype + count
- Seed information (topic, angle, exampleStems, bannedAngles) when a seed is in scope
- Free-form fallback when no seed matches

### 9.2 Quality user prompt

`src/quality.ts:buildUserPrompt` injects per-call:
- A category-specific accessibility hint (`CATEGORY_HINTS` map — e.g., "Specialist History = regnal years")
- The archetype's specific rules (loaded from `archetypes/<name>.txt` and embedded verbatim)
- The question itself + 4 answers + correctIndex + explanation

The system prompt is `quality.txt`; the user prompt is the dynamic context. Combined, they let the assessor enforce archetype-specific rules — a major upgrade from the pre-2026-04 generic rubric.

### 9.3 Verifier user prompt

`src/verifier.ts` doesn't construct a user prompt — the verifier model receives only the inline prompt from `googleProvider.ts` (Section 4). The whole question + options interpolation happens inside the inline prompt template.

### 9.4 Seed-verifier user prompt

`src/seed-verifier.ts:buildUserPrompt` injects per-call:
- The full existing seed catalog (organized by category) — so the verifier can detect overlap
- The list of proposed seeds being evaluated

The system prompt is `seed-verifier.txt`; the user prompt is the dynamic context.

---

## 10. What's NOT a prompt but worth knowing for the audit

- **`src/embedder.ts:buildEmbedText`** — embeds `<question> || <correct answer>` (NOT distractors). This is a deterministic format string, not an AI prompt. But the **decision to exclude distractors** is load-bearing for dedup quality: paraphrased distractors don't dilute similarity, so two semantically-identical questions surface as nearest neighbours regardless of how distractors are worded.
- **`src/dedup.ts:promoteSurvivors`** — within-batch cluster-survivor logic. No AI involvement.
- **`provider-archetype-constraints.ts`** — the auto-disable layer that drops (provider, model, archetype) cells from the rotation when survival/quality thresholds are crossed across runs. No prompt; pure metric-tracking.
- **Schema validation (`src/schema.ts:GeneratedQuestionSchema`)** — the Zod schema is the runtime gate that rejects malformed AI output. Tightened 2026-05-05 to enforce the 150/60 mobile UI cap. Acts as a safety net for prompts that under-constrain length.

---

## Closing notes for the reviewer

If the reviewer should pick **one cross-cutting thing** to optimize, it's probably:

**Length-budget compliance across all 12 archetype prompts.** Only 4 of 12 currently have explicit length-budget sections (cause_effect, misconception, process_sequence, strategy — the worst offenders from the 2026-05-05 audit). The other 8 inherit master.txt's caps but evidence shows that's insufficient when the archetype itself biases toward verbosity (estimation Fermi-style answers, lateral_connection's "huh moment" reveals, vocab_context's contextual definitions). A blanket policy: every archetype prompt should have a 4–6 line length-budget block tailored to its specific verbosity pattern.

If the reviewer should pick **one stage to deeply audit**, it's the **quality assessor (`quality.txt`)**. It's the single highest-leverage prompt in the system: every generated question passes through it, and its decision rule directly determines what reaches the pool. The "binary masquerading as 4-option" rule is recent and may not be calibrated yet across all providers. The Examples section is excellent but Reject-heavy — worth A/B-testing whether more positive Keep examples raise the keep rate without dropping pool quality.

If the reviewer wants **a long-tail improvement**, audit the **inline prompts** (verifier in googleProvider.ts, seed proposer in seed-evolver.ts). They're shorter than the .txt prompts but get less attention because they're not in dedicated files. The verifier prompt in particular is 14 lines for a stage that gates ~80% of pool entry — almost certainly under-engineered relative to its leverage.

---

*Generated 2026-05-05 from current codebase state. Pool: 465 entries. Seeds: 59 active. 14 chat providers registered.*
