# How Hard Is It to Generate Unique Quiz Questions With AI?

## A multi-provider, multi-stage pipeline that turned a "5-minute prompt" into a measurable benchmark across 10 frontier LLMs

> A standalone analysis from the out-of-ideas pipeline — what we built, what the numbers showed, and what the AI industry can learn from running the same prompt across every major frontier model in production. Headline scope: 10 frontier LLMs, each tested with ≥10 generation attempts in every one of 10 archetype cells.

**TL;DR.** I asked 10 frontier LLMs to do something that sounds trivial — write 20 fun quiz questions. They produced ~5 duplicates each. Building a pipeline that *forces* originality at scale revealed the cleanest model-quality benchmark I've seen published: **$ per unique idea differs by 16× across same-quality models**, and the most expensive model in the test (Claude Opus 4.7 at $0.421 per unique idea) collapsed harder onto training-data default repertoire than the cheaper ones. The dataset below is fully reproducible.

---

## 1. The deceptively simple problem

The target is a **competitive 1v1 mobile quiz game** — 10 categories, 12 question archetypes (cause-effect, comparison, misconception, etymology, estimation, etc.), 7th–9th grade reading level, mobile-UI hard caps (question ≤150 chars, each answer ≤60 chars), TikTok-native 14-30 audience. The core thesis is **fun > educational > factual** — a correct-but-boring question is worse than no question.

So we did the obvious thing: ask Claude / GPT / Gemini for 20 questions. And the result was the same every time:

- Ask for 20 "fun science questions" → get 8 unique ones and 12 paraphrases of the same 5 ideas: *Why is Venus hotter than Mercury? Why do stars twinkle? Why do pandas have a thumb?*
- Switch model → same 5 ideas, different wording.
- Switch provider entirely → same 5 ideas.
- Add seeds → unblocks new topics but each (seed, archetype) cell still produces 3-5 "default-repertoire" angles before saturating.
- Add anti-examples to the prompt → token bloat scales linearly with pool size; doesn't catch within-batch duplicates; LLMs ignore "don't generate X" half the time.

**The core mechanic.** Every frontier model has roughly the same "general-knowledge default repertoire" baked into its training data. When you ask the question generically, all of them reach for the same crowd-pleasing trivia. That's what we call **default-repertoire collapse**: the universal subset of training data that everyone surfaces first.

The naive fix — "just write a better prompt" — does not solve this. We tried. Repeatedly.

---

## 2. What we actually built

A 6-stage local pipeline running in pure Node/TypeScript. No Firebase, no cloud orchestrator — every artifact is a JSONL file we can grep, diff, and reproduce.

```
generate → quality → verify → embed → dedup → finalize
   ↓          ↓         ↓        ↓       ↓
 (seed-    (Bjork    (web-    (768-d  (HNSW
  steered  rubric +  grounded multi-   cosine
  master + archetype fact-    lingual  bands
  arche-   rules)    check)   embed)  ≥0.84
  type)                                auto-rej)
```

Plus three **meta-AI loops** that turned out to matter more than the base pipeline:

1. **Seed evolver** — tracks per-(seed, provider, model) stats; demotes seeds that drop below 50% survival; proposes new adjacent sub-topics every 30 batches.
2. **Seed verifier** — Claude Opus 4.7 reviews each new seed proposal with a hard ban list of universally default-repertoire trivia stems (mortgage / panic / why-popcorn-pops / why-stars-twinkle). KEEP / EDIT / REMOVE per proposal, with the rationale logged to an audit JSONL.
3. **Rewrite-mobile** — when pool entries exceed mobile UI caps, an AI compresses them through the full pipeline. The 2026-05-05 audit found 28% of pool entries violated the new 150/60 char cap; rewrite-mobile recovered 69 and dropped 84.

The pipeline rotates across **14 configured chat providers** (US, Chinese, Vertex Model Garden partners). 10 of those produced enough data to meet the ≥10-attempts-per-archetype floor and form the headline matrix; the other 4 (or model variants thereof — Vertex's `gemini-3.1-pro-preview`, `deepseek-chat` legacy, `seed-1.6`, `gemini-2.5-flash`) are documented in `IDEAS_MATRIX.md`'s appendix. The weighted scheduler auto-throttles expensive providers based on measured $/unique-idea and auto-disables (provider × model × archetype) cells that drop below 20% survival or quality<2.5 after ≥20 samples.

---

## 3. The headline dataset

14 days of orchestrator runs, May 2026. Every batch logged with cost-per-stage, quality scores, dedup breakdown, and saturation flags. All numbers below are pulled from `data/finalized-pool.jsonl` and `data/auto-runs/<ts>/run.log.jsonl` — no manual editing. The headline dataset is the **10-model scope**: 10 production-grade models, each with ≥10 generation attempts in every one of 10 archetype cells. Models that fell short of this floor (e.g., Vertex's `gemini-3.1-pro-preview` after API access ended mid-month) are listed in `IDEAS_MATRIX.md`'s appendix but not in the headline.

| Metric | Value |
|---|---|
| **Total auto-runs** | 24 |
| **Batches in 10-model scope** | 366 |
| **Questions generated (10-model scope)** | **1,856** |
| **Questions that survived all 6 stages** | **538** |
| **Pool size in 10-model scope** | **586 unique questions** (802 total in `finalized-pool.jsonl`, 216 of which are from excluded-model rows) |
| **Overall survival rate** | 29.0% |
| **Total spend across the 10-model scope** | **$69.04** |
| **Average $/unique idea** | **$0.128** |
| **$/unique idea — cheapest to most expensive** | **$0.026 (ERNIE) → $0.421 (Claude Opus 4.7)** — 16× spread |
| **Active seeds** | 57 (40 hand-curated + 19 AI-discovered, gatekept by Opus 4.7) |
| **Demoted seeds** | 2 (`sci_weather_pop` 62% reject, `hist_inventions_pop` 67% reject) |
| **Frontier LLMs in headline matrix** | **10** (each ≥10 attempts × 10 archetypes = 100 cells covered) |

The peak production run used `--concurrent-batches 2` (textbook 2.00× speedup, zero race conditions) and an A/B-quality pipeline (DeepSeek V4-Pro as primary + V4-Flash as alt, 241 paired decisions). After Vertex `gemini-3.1-pro-preview` access ended on May 12, Google's `gemini-2.5-pro` was wired in via AI Studio to keep Google representation in the matrix. The final run stopped with `stopReason: all_saturated` — the default-repertoire-depth signal we set out to detect.

---

## 4. The model benchmark

This is the part nobody publishes because it's expensive to generate. **Same prompt, same archetypes, same quality rubric, same dedup pool — measured on identical conditions across 10 production-grade models.** Per-cell breakdown is in `IDEAS_MATRIX.md`; below is the per-model rollup.

### Per-model results (aggregated across the 10-model scope, 366 batches)

| Model | Generated | Surviving unique ideas | Survival % | Total Cost | **$/unique idea** |
|---|---:|---:|---:|---:|---:|
| **DeepSeek V4-Pro** | 227 | 91 | 40% | $6.25 | **$0.069** |
| **GLM-5.1** (Z.ai) | 215 | 67 | 31% | $8.35 | $0.125 |
| **GPT-5** (OpenAI) | 201 | 81 | **40%** | $10.40 | $0.128 |
| **Gemini 2.5 Pro** (Google, AI Studio) | 198 | 44 | 22% | $2.73 | **$0.062** |
| **Claude Opus 4.7** (Anthropic) | 192 | 32 | 17% | $13.48 | **$0.421** |
| **Qwen 3.6 Max** (OpenRouter) | 192 | 92 | **47%** | $7.27 | $0.079 |
| **ERNIE 4.5 300B-A47B** (OpenRouter) | 185 | 25 | 13% | $0.64 | **$0.026** |
| **Kimi K2.6** (Moonshot) | 152 | 58 | 38% | $17.37 | $0.299 |
| **MiniMax M2.7** (OpenRouter) | 150 | 19 | 13% | $1.57 | $0.083 |
| **Doubao 2.0 Pro** (BytePlus, direct) | 144 | 29 | 20% | $0.98 | $0.034 |
| **TOTAL** | **1,856** | **538** | **29%** | **$69.04** | **$0.128** |

### The five findings hiding in this table

**Finding 1 — A 16× cost-per-unique-idea spread across frontier models.** Cheapest unique idea ($0.026 on ERNIE 4.5) vs most expensive ($0.421 on Opus 4.7). Same input prompts, same downstream filtering, same target output. Both models are top-tier on benchmarks. The price-to-output gap is purely a production reality, not an academic benchmark artifact.

**Finding 2 — Anthropic Opus 4.7 had the worst survival rate of any premium model in this test (17%).** This is counterintuitive — it's the most expensive and most "premium" provider per token. The reason isn't quality (its avg qualityScore is 4.17, on par with everyone else — see Matrix E in `IDEAS_MATRIX.md`). The reason is **default-repertoire collapse**: when asked to generate a "Why does X happen?" question, Opus 4.7 reaches for the same training-data default-repertoire stems (twinkling stars, popcorn pops, sky is blue) more rigidly than smaller models do. We verified this in a controlled pinned-seed run — Opus 4.7 produced 8/8 "stars twinkle" variations from a 4-seed Science batch.

**Finding 3 — OpenAI GPT-5 ties DeepSeek for highest overall survival (40%) but at 2× the cost** ($10.40 vs $6.25). GPT-5 bills internal thinking tokens as output, making it more expensive per call than its survival rate justifies in bulk. Useful surgically (it owns `process_sequence` at 83% survival, `estimation` at 60%); punishing as a default workhorse.

**Finding 4 — DeepSeek V4-Pro is the new default workhorse.** 40% survival at $0.069/unique idea, and the only model in the test that did NOT show saturation decay over time (see Matrix F in `IDEAS_MATRIX.md`). The V4-Pro upgrade in early May moved it from "cheap-but-acceptable" to "cheap-and-best." We A/B-tested V4-Pro vs V4-Flash at the quality-judge stage on 241 paired decisions — they agree 64.7% overall but diverge sharply on complex archetypes (`process_sequence` only 36% agreement, `strategy` 48%). V4-Flash falls back to mechanical rule-checking; V4-Pro retains nuance.

**Finding 5 — Chinese-origin models performed competitively where they were tested.** Qwen 3.6 Max via OpenRouter had the highest survival rate of any model (47%) and 3 of the top archetype-cell results in the matrix (misconception 70%, odd_one_out 72%, etymology 50%). GLM-5.1 hit the highest survival on `lateral_connection` (68%). BytePlus's Doubao 2.0 Pro has the cheapest unit cost ($0.034/unique idea) but trails on survival rate (20%). **No model is uniformly best; every model has archetypes where it shines and archetypes where it fails.**

### Quality scores — surprisingly converged

| Model | Avg Fun (1-5) | Avg Quality (1-5) | Avg Learning (1-5) |
|---|---:|---:|---:|
| Kimi K2.6 | 3.39 | **4.25** | 3.72 |
| GPT-5 | 3.19 | **4.23** | 3.62 |
| DeepSeek V4-Pro | 3.55 | 4.20 | 3.78 |
| GLM-5.1 | **3.62** | 4.19 | 3.79 |
| Qwen 3.6 Max | 3.49 | 4.17 | 3.75 |
| Claude Opus 4.7 | **3.65** | 4.12 | **3.79** |
| Doubao 2.0 Pro | 3.38 | 4.03 | 3.52 |
| Gemini 2.5 Pro | 3.41 | 4.00 | **3.80** |
| MiniMax M2.7 | 3.19 | 4.00 | 3.56 |
| ERNIE 4.5 | 3.38 | 3.97 | 3.62 |
| **Pool avg** | **3.43** | **4.13** | **3.69** |

Once you reach the surviving 29%, **all 10 models produce questions of comparable craftsmanship** (qualityScore spread of only 0.28 across the entire table — 3.97 to 4.25 on a 1–5 scale). The differentiator is not "which model writes the best question" — it's **how many unique ideas each model has** for a given (seed, archetype) cell before it starts paraphrasing itself. Survival rate spreads 12–47% (a 35-point range) while quality stays within 0.28 points — that's the proof that the survival rate isn't a quality proxy.

---

## 5. The (Model × Archetype) heat map

Ten archetypes × ten production-grade models = 100 cells, every one with ≥10 generation attempts. (Some seed × archetype combos are forbidden by the compatibility matrix — etymology only works in Language, etc.) The full per-cell matrices are in `IDEAS_MATRIX.md`; below is the headline strongest / weakest.

### Strongest 10 cells (survival rate)

| Cell | Generated | Surviving unique | Survival | $/unique |
|---|---:|---:|---:|---:|
| GPT-5 × process_sequence | 12 | 10 | **83%** | $0.07 |
| Qwen 3.6 Max × odd_one_out | 18 | 13 | **72%** | $0.09 |
| Qwen 3.6 Max × misconception | 24 | 17 | **70%** | $0.04 |
| GLM-5.1 × lateral_connection | 16 | 11 | 68% | $0.05 |
| DeepSeek V4-Pro × process_sequence | 22 | 14 | 63% | $0.03 |
| GPT-5 × estimation | 30 | 18 | 60% | $0.05 |
| DeepSeek V4-Pro × lateral_connection | 28 | 16 | 57% | $0.02 |
| GLM-5.1 × comparison | 20 | 10 | 50% | $0.23 |
| GLM-5.1 × odd_one_out | 24 | 12 | 50% | $0.06 |
| Qwen 3.6 Max × etymology | 12 | 6 | 50% | $0.08 |

### Weakest 10 cells (≥10 generated — all cells in the headline matrix)

| Cell | Generated | Surviving unique | Survival |
|---|---:|---:|---:|
| ERNIE 4.5 × strategy | 24 | 0 | **0%** |
| ERNIE 4.5 × comparison | 12 | 0 | 0% |
| MiniMax M2.7 × process_sequence | 12 | 0 | 0% |
| MiniMax M2.7 × odd_one_out | 12 | 0 | 0% |
| MiniMax M2.7 × vocab_context | 18 | 0 | 0% |
| GLM-5.1 × vocab_context | 15 | 0 | 0% |
| Doubao 2.0 Pro × estimation | 12 | 0 | 0% |
| Gemini 2.5 Pro × estimation | 24 | 1 | 4% |
| Gemini 2.5 Pro × strategy | 18 | 1 | 5% |
| GLM-5.1 × estimation | 17 | 1 | 5% |

**Pattern: narrative-style models (MiniMax, ERNIE) fail strict-format archetypes systematically.** Their generations are substantively fine but violate the "±20% answer length" and "compressed noun-phrase mechanism" rules we use for mobile UI. Same root cause as the V4-Pro vs V4-Flash divergence on `process_sequence`: rules-light models default to essay-form output. **Separately, the entire `vocab_context` column is structurally weak** (pool-wide 9% survival, no model >25%) — a flag that the archetype prompt itself needs redesign, independent of model choice.

### Auto-disabled cells (provider × model × archetype) after threshold crossings

After ≥20 questions assessed AND (survival < 20% OR avg qualityScore < 2.5), the orchestrator permanently blocks that cell from future rotation. Currently disabled (cells in the headline matrix only):

```
google | gemini-3.1-pro-preview | estimation       — 24 assessed, 8% surv, avgQ 2.44  (excluded model — appendix only)
openrouter-minimax | minimax-m2.7 | comparison     — 24 assessed, 8% surv, avgQ 2.06
openrouter-ernie | ernie-4.5-300b | odd_one_out    — 24 assessed, 8% surv, avgQ 2.58
```

Notable: **the auto-disabled `gemini-3.1-pro × estimation` cell** is the same model that was lost to Vertex API-access changes mid-month. Its archetype mismatch with `estimation` (consistently misreading "Fermi-style ballpark" prompts as "recall-of-a-statistic") was a real production constraint, not a vendor regression — that's why model-archetype fit, not model selection, is the unit of optimization.

---

## 6. The (Category × Archetype) saturation curve

| Category | Batches | Generated | Survived | Survival % | $/survivor |
|---|---:|---:|---:|---:|---:|
| **History** | 25 | 131 | 59 | **45.0%** | $0.028 |
| Tech | 52 | 227 | 88 | 38.8% | $0.052 |
| Science | 29 | 164 | 60 | 36.6% | $0.027 |
| Sports | 49 | 187 | 61 | 32.6% | $0.067 |
| Language | 29 | 140 | 42 | 30.0% | $0.083 |
| Pop Culture | 41 | 171 | 51 | 29.8% | $0.065 |
| Arts | 26 | 115 | 29 | 25.2% | $0.111 |
| General | 36 | 142 | 35 | 24.6% | $0.100 |
| Food & Drink | 36 | 146 | 34 | 23.3% | $0.116 |
| **Geography** | 9 | 53 | 9 | **17.0%** | $0.105 |

The category-level pattern matches a textbook saturation curve. **Fresh categories** (History, Tech, Science) cross batch 4 at $0.05/survivor. **Mined categories** (Geography, Food & Drink, Arts) sit at $0.10-0.12 because the default-repertoire "extremes" and "origins" angles are already in the pool.

Saturation isn't binary — it's a slow drift from $0.025 to $0.15 per shipped question over ~30 questions per category. Once a category passes ~$0.15, you either change the seeds (the AI-driven seed-evolver does this every 30 batches) or accept that the category is mature.

---

## 7. The (Category × Model) cost-per-unique-idea pivot

What we measured changes who you should use for what. **There is no universally best model; the right choice depends on which archetype/category you're mining and how saturated it already is.** Concrete recommendations distilled from the run logs:

- **Bulk filler for fresh categories** → DeepSeek V4-Pro or Gemini 2.5 Pro ($0.06–0.07/unique idea band, broad seed coverage).
- **Hard-stuck saturated seed (3 consecutive zero-survivor batches)** → switch surgically to GPT-5 or Qwen 3.6 Max to surface fresh angles. GPT-5 burns budget at scale but is the breakthrough tool. Avoid Claude Opus 4.7 — it has the worst saturation decay among premium models.
- **`misconception` archetype** → Qwen 3.6 Max (70% survival, $0.04/unique).
- **`lateral_connection` archetype** → GLM-5.1 (68%, $0.05) or DeepSeek V4-Pro (57%, $0.02).
- **`process_sequence` archetype** → GPT-5 (83%, $0.07) — by far the top performer.
- **`estimation` archetype** → GPT-5 only (60%, $0.05). Gemini 2.5 Pro is structurally weak here (4%); Doubao auto-disables (0%).
- **`odd_one_out` archetype** → Qwen 3.6 Max (72%, $0.09) or GLM-5.1 (50%, $0.06).
- **`vocab_context` archetype** → none of the 10 models clears 25%. Redesign the archetype prompt before scaling.

This is the operational outcome of the benchmark — not "which model is best" but **which (model, archetype, category) cells are worth running**.

---

## 8. Seed exhaustion — when models run out of ideas

We hand-curated 40 sub-topic seeds across 10 categories. After running them through the pipeline, the seed-evolver computes per-(seed, provider, model) saturation flags. Once a (seed, provider) pair crosses ≥10 questions assessed AND (50% reject rate OR ≥5 within-batch duplicates), it's flagged. The AI seed-verifier (Opus 4.7) then proposes adjacent seeds to refresh the catalog.

### Top 15 seeds by pool contribution

| Seed | Contributions | Avg Fun | Avg Quality |
|---|---:|---:|---:|
| `tech_algorithms_pop` | 24 | 3.21 | 4.08 |
| `hist_everyday_life_pop` | 22 | 3.68 | 4.09 |
| `pop_music_pop` | 21 | 3.52 | **4.33** |
| `tech_security_pop` | 21 | 3.24 | 4.33 |
| `sci_tech_myths` (AI-proposed) | 21 | 3.14 | 4.33 |
| `sci_animals_pop` | 18 | **3.83** | 4.17 |
| `tech_invent_pop` | 18 | 3.67 | 4.28 |
| `sci_space_pop` | 16 | 3.63 | 3.94 |
| `pop_videogames_pop` | 16 | 3.63 | 4.13 |
| `pop_movies_pop` | 16 | 3.75 | 4.00 |

### Demoted seeds (rejected by sampler)

- `sci_weather_pop` — 62% reject rate (default repertoire-stuck on hailstorms, thunder)
- `hist_inventions_pop` — 67% reject rate (default repertoire-stuck on Edison/Ford)

The AI-discovered seeds (`sci_tech_myths`, `sci_senses_quirks`, etc.) are now contributing 19% of all new survivors. The Opus 4.7 verifier's reject decisions were unanimously correct in the surgical Test 5 inspection — every REMOVE caught a real default-repertoire leak (e.g., proposed seed `sci_physics_pop` → "What makes popcorn pop?" → REMOVED).

---

## 9. The architectural decisions that mattered

These are the lessons we'd carry into any future LLM pipeline, in rough order of impact:

1. **Embed `<question> ‖ <correct answer>` only, never distractors.** Wrong-answer wording is arbitrary noise that varies sharply between semantically identical questions. Embedding distractors dilutes the similarity signal. Switching to question+answer-only dropped within-batch false-uniqueness from ~30% to ~5%.

2. **Include the new batch in the dedup index.** Within-batch duplicates were the dominant failure mode (two near-identical "brain freeze" questions in the same 5-question batch). Building the HNSW index from `[pool ...newQuestions]` and querying each new question against the full index makes within-batch dupes surface as nearest neighbors.

3. **Cluster-survivor promotion.** When two new questions form a 0.84+ cluster, raw thresholding would auto-reject both. The promoteSurvivors pass keeps one survivor per cluster (highest qualityScore wins; pool members are never promoted). This single fix went from "30% of clusters lose all members" to "every cluster contributes its best member."

4. **Stratified within-batch sampling beats random.** With 4 seeds and 10 questions, random sampling gives you 5/0/0/0 distribution one batch in three. A round-robin sampler that visits each seed at least once before any seed is used twice gives you 3/3/2/2 reliably. Same total questions, 2× the seed coverage.

5. **Top-tier ≠ best for diversity.** Smaller models (Sonnet 4.6 over Opus 4.7, gpt-5-mini over gpt-5) often produce more diverse output on a pinned-saturated seed. Bigger models have richer fluency but narrower training-data default repertoire at the "general-knowledge" depth we're targeting. Counterintuitive; reproducibly measured.

6. **Auto-disable on (provider × model × archetype) keyed by model id.** Upgrading the configured model resets evidence. Stale evidence on old model ids stays attributed to the old key. This prevented us from carrying over an irrelevant "DeepSeek V4-Flash failed at process_sequence" verdict to V4-Pro, which actually excels there (62.5%).

7. **Concurrent batches with provider-uniqueness guarantee.** `--concurrent-batches 2` gives textbook 2.00× speedup with zero race conditions, as long as the scheduler enforces "no two concurrent batches use the same provider." Anthropic and OpenAI have per-account concurrency caps that breaks at 3+.

8. **The verifier is the bottleneck nobody invests in.** Our verifier prompt is 14 lines and gates 80% of pool entry. The audit flagged it as structurally underinvested; expanding it to ~30 lines (explicit search instruction for thinking models, archetype-aware confidence calibration, proper system+user split) is the highest-leverage next change.

---

## 10. What we'd publish about LLM benchmarking

We started this project to build a quiz game. We ended up with **the cleanest model-quality benchmark we could find in production conditions**, because the quiz-generation task happens to require:

- **Open-ended generation** (no single correct answer to grade against)
- **Hard structural constraints** (4 options, ±20% length, defeatable distractors)
- **Subjective quality** (fun, learning value, accessibility tier)
- **Diversity at scale** (forced novelty across thousands of outputs)
- **Cross-model portability** (the prompt must work on Opus, GPT-5, Gemini 2.5 Pro, DeepSeek V4-Pro, Qwen, GLM, Kimi, Doubao, MiniMax, ERNIE in parallel — the exact 10 models in the headline matrix)

These are precisely the conditions academic benchmarks (MMLU, HumanEval, GPQA) miss. Standard benchmarks are pass/fail on a fixed answer key; production quality is a multi-dimensional yield curve with **$-per-unique-idea** as the y-axis.

If you're choosing a model for any production task involving creative generation + structural constraints + dedup, the **survival-rate × $/unique-idea matrix is the metric that matters**, not benchmark scores. The two are surprisingly poorly correlated.

---

## 11. Reproducibility

All code is at `github.com/EmilHerzberg/out-of-ideas`. The pipeline is pure Node — no infra, no cloud orchestrator, no external database. Drop in API keys for whichever providers you want to test, run `npm run cli -- auto-generate --target 100 --budget 10`, and inspect `data/auto-runs/<ts>/run.log.jsonl` for the same data shapes shown above. The schema is Zod-validated; the JSONL format is human-greppable.

Every number in this analysis is computed from the operator's local `data/finalized-pool.jsonl` and `data/auto-runs/*/summary.json` files. The analyzer script (`analyze-all.mjs`) is in the repo — run it on your own pipeline output to compute the same tables.

---

## Appendix A — what's NOT in this dataset

To avoid misleading anyone reading these numbers:

- **No reasoning-mode variants** were tested (Grok-reasoning, GPT-5-thinking-only, etc.). All providers ran in default chat-completion mode.
- **No Llama / no Cohere.** Meta and Cohere were excluded — Llama isn't a hosted MaaS on Vertex (would need self-deployed GPUs); Cohere wasn't differentiated enough from existing rotation for v1.
- **No ERNIE 5.0** — the actual frontier Baidu model (2.4T params, 8th on LMArena) is locked behind a Hong Kong phone requirement for Qianfan account verification. We're stuck at ERNIE 4.5 family via OpenRouter.
- **Token-level cost breakdown is summarized, not itemized.** The cost numbers above include generation + quality + verify + embed stages combined per batch.
- **All embeddings are Google's `text-multilingual-embedding-002`.** Vector spaces aren't interchangeable; the dedup thresholds here are calibrated for this embedder. Switching to Voyage-3-large would require recalibrating thresholds upward.

---

*Project: out-of-ideas · Authors: Emil Herzberg and Anton Herzberg · License: Apache-2.0 · Analysis date: 2026-05-13*
