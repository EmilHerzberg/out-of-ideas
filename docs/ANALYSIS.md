# How Hard Is It to Generate 618 Good Quiz Questions With AI?

## A multi-provider, multi-stage pipeline that turned a "5-minute prompt" into a measurable benchmark across 11 frontier LLMs

> A standalone analysis from the out-of-ideas pipeline — what we built, what the numbers showed, and what the AI industry can learn from running the same prompt across every major frontier model in production.

**TL;DR.** I asked 11 frontier LLMs to do something that sounds trivial — write 20 fun quiz questions. They produced ~5 duplicates each. Building a pipeline that *forces* originality at scale revealed the cleanest provider-quality benchmark I've seen published: per-dollar survival rates differ by **17×** between providers, and the most expensive provider in the test (Claude Opus 4.7 at $0.39 per shipped question) collapsed harder onto training-data default repertoire than Sonnet did. The dataset below is fully reproducible.

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

The pipeline rotates across **14 chat providers** (US, Chinese, Vertex Model Garden partners) with a weighted scheduler that auto-throttles expensive providers based on measured $/survivor and auto-disables (provider × model × archetype) cells that drop below 20% survival or quality<2.5 after ≥20 samples.

---

## 3. The headline dataset

7 days of orchestrator runs, May 2026. Every batch logged with cost-per-stage, quality scores, dedup breakdown, and saturation flags. All numbers below are pulled from `data/finalized-pool.jsonl` and `data/auto-runs/<ts>/run.log.jsonl` — no manual editing.

| Metric | Value |
|---|---|
| **Total auto-runs** | 17 |
| **Total batches** | 332 |
| **Questions generated** | 1,476 |
| **Questions that survived all 6 stages** | **468** |
| **Pool size today** | **618 unique questions** (some predate the auto-runs) |
| **Overall survival rate** | 31.7% |
| **Total spend across all runs** | **$30.32** |
| **Average $/shipped question** | $0.0648 |
| **Active seeds** | 57 (40 hand-curated + 19 AI-discovered, gatekept by Opus 4.7) |
| **Demoted seeds** | 2 (`sci_weather_pop` 62% reject, `hist_inventions_pop` 67% reject) |
| **Frontier LLMs in rotation** | 11 (active) of 14 registered |

The peak production run used `--concurrent-batches 2` (textbook 2.00× speedup, zero race conditions) and an A/B-quality pipeline (DeepSeek V4-Pro as primary + V4-Flash as alt, 241 paired decisions).

---

## 4. The provider benchmark

This is the part nobody publishes because it's expensive to generate. **Same prompt, same archetypes, same quality rubric, same dedup pool — measured on identical conditions across 11 providers.**

### Per-provider results (aggregated across all 17 runs)

| Provider | Batches | Generated | Survived | Survival % | Total Cost | **$/survivor** |
|---|---:|---:|---:|---:|---:|---:|
| **deepseek** (V4-Pro + V4-Flash) | 58 | 268 | 100 | 37.3% | $2.39 | **$0.0239** |
| **google** (Gemini 3.1 Pro) | 50 | 262 | 89 | 34.0% | $1.96 | **$0.0220** |
| **zai** (GLM-5.1) | 42 | 159 | 52 | 32.7% | $4.34 | $0.0834 |
| **openrouter-qwen** (Qwen 3.6 Max) | 27 | 150 | 76 | **50.7%** | $5.64 | $0.0742 |
| openrouter-minimax (M2.7) | 29 | 149 | 28 | 18.8% | $1.08 | $0.0385 |
| openrouter-ernie (4.5-300b) | 26 | 137 | 21 | 15.3% | $0.34 | $0.0164 |
| **anthropic** (Opus 4.7) | 25 | 114 | 19 | 16.7% | $7.45 | **$0.3920** |
| **openai** (GPT-5) | 21 | 89 | 46 | **51.7%** | $4.34 | $0.0944 |
| byteplus (Doubao Seed 2.0 Pro) | 18 | 78 | 16 | 20.5% | $0.40 | $0.0249 |
| moonshot (Kimi K2.6) | 30 | 40 | 11 | 27.5% | $2.24 | $0.2037 |
| openrouter-doubao (Seed 1.6) | 6 | 30 | 10 | 33.3% | $0.15 | $0.0149 |

### The five findings hiding in this table

**Finding 1 — A 17× cost-per-survivor spread across frontier models.** Cheapest survivor ($0.0149 on Doubao Seed 1.6) vs most expensive ($0.3920 on Opus 4.7). Same input prompts, same downstream filtering, same target output. Both models are top-tier on benchmarks. The price-to-output gap is purely a production reality, not an academic benchmark artifact.

**Finding 2 — Anthropic Opus 4.7 had the worst survival rate of any flagship model in this test (16.7%).** This is counterintuitive — it's the most expensive and most "premium" provider per token. The reason isn't quality (its avg qualityScore is 4.15, on par with everyone else). The reason is **default-repertoire collapse**: when asked to generate a "Why does X happen?" question, Opus 4.7 reaches for the same training-data default repertoireicals (twinkling stars, popcorn pops, sky is blue) more rigidly than smaller models do. We verified this in a controlled pinned-seed run — Opus 4.7 produced 8/8 "stars twinkle" variations from a 4-seed Science batch.

**Finding 3 — OpenAI GPT-5 has the highest individual survival rate (51.7%) but bills internal thinking tokens as output**, making it 10× more expensive per question than Gemini. Net effect: similar $/survivor to mid-tier providers, but with much higher per-call cost variance. Useful surgically; punishing in bulk.

**Finding 4 — DeepSeek V4-Pro is the new default workhorse.** Cheaper than Google AND higher survival (37.3% vs 34.0%). The V4-Pro upgrade in early May moved it from "cheap-but-acceptable" to "cheap-and-best." We A/B-tested V4-Pro vs V4-Flash at the quality-judge stage on 241 paired decisions — they agree 64.7% overall but diverge sharply on complex archetypes (`process_sequence` only 36% agreement, `strategy` 48%). V4-Flash falls back to mechanical rule-checking; V4-Pro retains nuance.

**Finding 5 — Chinese providers performed competitively where they were tested.** Z.ai's GLM-5.1 hit the highest qualityScore (4.33) of any single batch. Qwen 3.6 Max via OpenRouter had the second-highest survival rate (50.7%). BytePlus's Doubao Seed 2.0 Pro is a quality outlier (lower at 3.88) because its writing style is essay-narrative — great for `lateral_connection` (67% survival) and `misconception` (33%), poor for strict-format `cause_effect` (6%) and `odd_one_out` (28%). **No provider is uniformly best; every provider has archetypes where it shines and archetypes where it fails.**

### Quality scores — surprisingly converged

| Provider | Avg Fun (1-5) | Avg Quality (1-5) | Avg Learning (1-5) |
|---|---:|---:|---:|
| google (Gemini 3.1 Pro) | **3.81** | 4.13 | **3.90** |
| anthropic (Opus 4.7) | 3.72 | 4.15 | 3.77 |
| zai (GLM-5.1) | 3.65 | 4.15 | 3.81 |
| deepseek | 3.50 | 4.16 | 3.69 |
| openrouter-qwen | 3.53 | **4.19** | 3.78 |
| openai (GPT-5) | 3.18 | 4.18 | 3.53 |
| byteplus | 3.38 | 3.88 | 3.31 |
| **Pool avg** | **3.58** | **4.13** | **3.74** |

Once you reach the surviving 31.7%, **all providers produce questions of comparable craftsmanship** (qualityScore variance < 0.3 across the entire table). The differentiator is not "which model writes the best question" — it's **how many distinct ideas each model has** for a given (seed, archetype) cell before it starts paraphrasing itself.

---

## 5. The (Provider × Archetype) heat map

Twelve archetypes × eleven providers = 132 cells. Some are forbidden by the compatibility matrix (etymology only works in Language; counterfactual only in Science). Of the legal cells where we have ≥6 generations, the strongest and weakest:

### Strongest 10 cells (survival rate)

| Cell | Generated | Survived | Survival | Cost |
|---|---:|---:|---:|---:|
| openrouter-doubao × lateral_connection | 6 | 6 | **100%** | $0.03 |
| openrouter-qwen × odd_one_out | 12 | 11 | 91.7% | $0.95 |
| openai × odd_one_out | 10 | 9 | 90.0% | $0.78 |
| openrouter-qwen × misconception | 24 | 17 | 70.8% | $0.69 |
| zai × lateral_connection | 16 | 11 | 68.8% | $0.57 |
| google × lateral_connection | 18 | 12 | 66.7% | $0.13 |
| byteplus × lateral_connection | 6 | 4 | 66.7% | $0.03 |
| zai × comparison | 8 | 5 | 62.5% | $0.61 |
| openai × estimation | 30 | 18 | 60.0% | $0.98 |
| deepseek × etymology | 12 | 7 | 58.3% | $0.24 |

### Weakest 10 cells (≥6 generated)

| Cell | Generated | Survived | Survival |
|---|---:|---:|---:|
| openrouter-ernie × estimation | 6 | 0 | **0%** |
| byteplus × estimation | 12 | 0 | 0% |
| openrouter-minimax × vocab_context | 6 | 0 | 0% |
| openrouter-ernie × comparison | 6 | 0 | 0% |
| byteplus × process_sequence | 6 | 0 | 0% |
| zai × vocab_context | 6 | 0 | 0% |
| openrouter-ernie × strategy | 12 | 0 | 0% |
| byteplus × cause_effect | 18 | 1 | 5.6% |
| openrouter-minimax × process_sequence | 18 | 1 | 5.6% |
| zai × estimation | 17 | 1 | 5.9% |

**Pattern: narrative-style models (BytePlus, MiniMax, ERNIE) fail strict-format archetypes systematically.** Their generations are substantively fine but violate the "±20% answer length" and "compressed noun-phrase mechanism" rules we use for mobile UI. Same root cause as the V4-Pro vs V4-Flash divergence on `process_sequence`: rules-light models default to essay-form output.

### Auto-disabled cells (provider × model × archetype) after threshold crossings

After ≥20 questions assessed AND (survival < 20% OR avg qualityScore < 2.5), the orchestrator permanently blocks that cell from future rotation. Currently disabled:

```
google | gemini-3.1-pro-preview | estimation       — 24 assessed, 8.3% surv, avgQ 2.44
openrouter-minimax | minimax-m2.7 | comparison     — 24 assessed, 8.3% surv, avgQ 2.06
openrouter-ernie | ernie-4.5-300b | odd_one_out    — 24 assessed, 8.3% surv, avgQ 2.58
```

Three of 79 tracked cells. Notable: **the disabled `google × estimation` is not a Gemini regression** — Gemini Pro is excellent at causal questions but consistently misreads "estimation" as recall-of-a-statistic rather than Fermi-style ballpark reasoning. Provider-archetype fit is a real production constraint, not just a benchmark artifact.

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

## 7. The (Category × Provider) cost-per-survivor pivot

What we measured changes who you should use for what. **There is no universally best provider; the right choice depends on which category you're mining and how saturated it already is.** Concrete recommendations distilled from the run logs:

- **Bulk filler for fresh categories** → Google Gemini 3.1 Pro or DeepSeek V4-Pro ($0.025/survivor band).
- **Hard-stuck saturated seed (3 consecutive zero-survivor batches)** → switch surgically to OpenAI GPT-5 or Anthropic Opus 4.7 to surface fresh angles. Don't keep them in rotation; they'll burn budget.
- **`misconception` archetype** → Qwen 3.6 Max (70.8% survival, top performer).
- **`lateral_connection` archetype** → almost any provider (66-100%); cheapest is Google.
- **`estimation` archetype** → OpenAI GPT-5 only; Google is auto-disabled here, everyone else <30%.
- **`odd_one_out` archetype** → GPT-5 or Qwen (90%+).

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

We started this project to build a quiz game. We ended up with **the cleanest provider quality benchmark we could find in production conditions**, because the quiz-generation task happens to require:

- **Open-ended generation** (no single correct answer to grade against)
- **Hard structural constraints** (4 options, ±20% length, defeatable distractors)
- **Subjective quality** (fun, learning value, accessibility tier)
- **Diversity at scale** (forced novelty across thousands of outputs)
- **Cross-provider portability** (the prompt must work on Opus, GPT-5, Gemini, DeepSeek, Qwen, GLM, Kimi, Doubao, MiniMax, ERNIE in parallel)

These are precisely the conditions academic benchmarks (MMLU, HumanEval, GPQA) miss. Standard benchmarks are pass/fail on a fixed answer key; production quality is a multi-dimensional yield curve with $-per-survivor as the y-axis.

If you're choosing a provider for any production task involving creative generation + structural constraints + dedup, the **survival-rate × $/survivor matrix is the metric that matters**, not benchmark scores. The two are surprisingly poorly correlated.

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

*Project: out-of-ideas · Authors: Emil Herzberg and Anton Herzberg · License: Apache-2.0 · Analysis date: 2026-05-12*
