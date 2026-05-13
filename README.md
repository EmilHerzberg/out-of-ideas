# out-of-ideas

> **Can we measure in a quantitative way when an AI runs out of ideas?**
>
> An **open-source LLM pipeline + open methodology** for measuring *default-repertoire depth* — how many distinct ideas each frontier model can produce in a given **archetype cell** (a fixed combination of sub-topic seed and question structure) before it starts paraphrasing itself.
>
> **10 frontier LLMs · 1,856 generations · $69 of API spend · 538 unique production-grade ideas (avg $0.128 each)** · every model ≥10 generation attempts in every one of the 10 archetype cells.

A two-person research project by Emil Herzberg and Anton Herzberg, May 2026.

## What this is

A 5-stage local pipeline (Node + TypeScript) that generates, quality-rates, fact-checks, embeds, and de-duplicates quiz questions across 10 production-grade frontier LLMs. Four more providers were configured but did not reach the ≥10-attempts floor — listed in the appendix of `docs/IDEAS_MATRIX.md`. The architecture generalises to any creative-generation task with structural constraints and a deduplication requirement (synthetic data, content pipelines, training-data augmentation, simulation prompts).

> A sample of **100 production-grade questions** is included in [`samples/`](./samples/sample-questions.jsonl) — diverse across categories and archetypes, embeddings stripped for readability.

```
generate  →  quality   →  verify    →  embed     →  dedup
   ↓            ↓            ↓            ↓            ↓
 (seed-      (Bjork-     (web-        (768-d      (HNSW
  steered    influenced   grounded     multi-      cosine
  master +   rubric +     fact-        lingual     bands
  archetype  archetype    check)       embed)      ≥0.84
  prompt)    rules)                                auto-rej)

 surviving questions are then appended to the finalized pool
```

Plus three **meta-AI loops**: an evolver that mutates the seed catalog based on production stats, an Opus-4.7-powered seed gatekeeper that audits seed proposals for over-canonical trivia stems (mortgage, panic, why-popcorn-pops, why-stars-twinkle), and a rewrite-mobile compressor for output that exceeds UI character budgets.

## The thesis

The pipeline was originally built to solve a quiz-game problem. As a side effect, it produced the cleanest cross-model comparison we could find under uniform production constraints — open-ended generation, hard structural rules (4 options, ±20% length, defeatable distractors), web-grounded verification, embedding-based deduplication. Standard benchmarks (MMLU, HumanEval, GPQA) grade pass/fail on a fixed answer key; this measures yield curves under diversity pressure.

The single most actionable finding:

> **The differentiator between frontier LLMs in production is not "which model writes the best output." It's how many distinct ideas each model has for a given cell before it starts paraphrasing itself.**

## Where to read what

| Doc | What's in it | When to open it |
|---|---|---|
| **[docs/IDEAS_MATRIX.md](./docs/IDEAS_MATRIX.md)** | All six matrices (generation attempts, survival rate, $/unique idea, combined, quality per cell, saturation decay) + methodology + confidence tiers + excluded-model appendix | You want the full numerical picture or a specific (model × archetype) cell |
| **[docs/DISTINCT_IDEAS_THESIS.md](./docs/DISTINCT_IDEAS_THESIS.md)** | The conceptual argument: what default-repertoire depth is, why it matters, what we measured, the four findings that ground the thesis | You want to understand *why* this is the right metric, not just the numbers |
| **[docs/ANALYSIS.md](./docs/ANALYSIS.md)** | Full benchmark report — five findings hiding in the per-model table, (category × archetype) saturation curves, architectural decisions, run-by-run appendix | You want the long-form report with operational recommendations |
| **[docs/PROMPTS.md](./docs/PROMPTS.md)** | All 17 AI prompts (generator, 12 archetype variants, quality, verifier, seed-evolver, seed-verifier) with reasoning per prompt | You want to copy a prompt, audit our exact wording, or fork the pipeline |

If you're going to skim only one thing past this README, make it the matrix in `IDEAS_MATRIX.md` — it's the closest thing to a quantitative TL;DR.

## Headline numbers

After 14 days, 24 orchestrator runs, and 1,856 generations across the **headline scope** (the 10 models that hit ≥10 generation attempts in every archetype cell):

| Model | Survival % | $ / unique idea |
|---|---:|---:|
| ERNIE 4.5 300B-A47B | 13% | **$0.026** ← cheapest |
| Doubao 2.0 Pro (BytePlus) | 20% | $0.034 |
| Gemini 2.5 Pro (AI Studio) | 22% | $0.062 |
| DeepSeek V4-Pro | 40% | $0.069 |
| Qwen 3.6 Max | **47%** ← best survival | $0.079 |
| MiniMax M2.7 | **12%** ← worst survival | $0.083 |
| GLM-5.1 (Z.ai) | 31% | $0.125 |
| GPT-5 | 40% | $0.128 |
| Kimi K2.6 | 38% | $0.299 |
| **Claude Opus 4.7** | 17% | **$0.421** ← most expensive |

*Bold cells flag noteworthy extremes (lowest / highest per column). The spread between them is the finding.*

**16× cost-per-unique-idea spread between the cheapest and most expensive frontier model**, with quality-score *spread* across the table of only 0.28 on a 5-point scale (3.97 → 4.25). The differentiator is depth-of-novelty, not quality of any individual output. **Claude Opus 4.7 collapsed hardest among the premium models in this test** (17% survival at $0.421 per unique idea) — that's an Opus-specific finding from our dataset, not a universal "bigger models are worse" claim. GPT-5 ties DeepSeek V4-Pro at 40% survival, only 7 points behind Qwen's matrix-leading 47%; model size alone does not predict novelty depth.

Confidence tiers (high ≥20 generations, medium 10–19) are documented per cell in `docs/IDEAS_MATRIX.md`. Methodology is reproducible; absolute numbers will vary ±5% per high-confidence cell on rerun.

## The three matrices that carry the story

The full six-matrix breakdown (generation attempts, combined view, quality per cell, methodology, confidence tiers, excluded-model appendix) lives in `docs/IDEAS_MATRIX.md`. Three of them carry the headline story and are inlined here so you don't have to click through.

### 1 — Survival rate per (model × archetype)

How many distinct ideas does each model have for each question structure before paraphrase collapse kicks in?

| Model | cause_eff | comparison | process_seq | misconception | etymology | estimation | lateral_conn | odd_one_out | vocab_ctx | strategy | **Ø** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Claude Opus 4.7** | 8% | 8% | 8% | 33% | 22% | 50% | 16% | 22% | 8% | 8% | **17%** |
| **GPT-5** | 41% | 21% | **83%** | 16% | 38% | **60%** | 38% | 50% | 16% | 25% | **40%** |
| **Gemini 2.5 Pro** | 38% | 14% | 38% | 16% | 33% | 4% | 33% | 33% | 11% | 5% | **22%** |
| **DeepSeek V4-Pro** | 22% | 46% | **63%** | 41% | 41% | 40% | **57%** | 25% | 12% | 45% | **40%** |
| **GLM-5.1** | 43% | 50% | 23% | 24% | 16% | 5% | **68%** | 50% | 0% | 25% | **31%** |
| **Kimi K2.6** | 45% | 26% | 38% | 46% | 38% | 45% | 42% | 43% | 9% | 38% | **38%** |
| **Doubao 2.0 Pro** | 5% | 33% | 8% | 16% | 33% | 0% | 33% | 27% | 8% | 33% | **20%** |
| **Qwen 3.6 Max** | 38% | 31% | 41% | **70%** | 50% | 43% | 48% | **72%** | 25% | 44% | **47%** |
| **ERNIE 4.5** | 8% | 0% | 16% | 33% | 16% | 8% | 29% | 13% | 8% | 0% | **13%** |
| **MiniMax M2.7** | 16% | 13% | 0% | 8% | 33% | 27% | 16% | 0% | 0% | 8% | **12%** |
| **Column Ø** | 25% | 23% | 32% | 31% | 32% | 31% | 40% | 34% | **9%** | 23% | **28%** |

Cell-level spread is huge — `cause_effect` ranges 5% (Doubao) to 45% (Kimi), `odd_one_out` ranges 0% (MiniMax) to 72% (Qwen), `process_sequence` ranges 0% (MiniMax) to 83% (GPT-5). No model is uniformly best. The `vocab_context` column is matrix-wide weak (Ø 9%, no model >25%) — flag for archetype-prompt redesign.

### 2 — $ per unique idea per (model × archetype)

The production-economics view. Cost per attempt is a vendor-marketing number; cost per *unique idea that survives downstream filtering* is the real production cost — and it spreads 16× across models that all pass the same quality bar.

| Model | cause_eff | comparison | process_seq | misconception | etymology | estimation | lateral_conn | odd_one_out | vocab_ctx | strategy | **Ø** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Claude Opus 4.7** | $0.63 | $0.89 | $0.67 | $0.26 | $0.38 | $0.15 | $0.56 | $0.28 | $0.85 | $0.90 | **$0.421** |
| **GPT-5** | $0.09 | $0.58 | $0.07 | $0.22 | $0.10 | $0.05 | $0.12 | $0.11 | $0.27 | $0.14 | **$0.128** |
| **Gemini 2.5 Pro** | $0.02 | $0.04 | $0.04 | $0.04 | $0.09 | $0.40 | $0.08 | $0.02 | $0.07 | $0.24 | **$0.062** |
| **DeepSeek V4-Pro** | $0.07 | $0.03 | $0.03 | $0.01 | $0.04 | $0.04 | $0.02 | $0.05 | $1.06 | $0.16 | **$0.069** |
| **GLM-5.1** | $0.07 | $0.23 | $0.14 | $0.08 | $0.32 | $0.24 | $0.05 | $0.06 | ∞ | $0.22 | **$0.125** |
| **Kimi K2.6** | $0.18 | $0.82 | $0.09 | $0.06 | $0.25 | $0.18 | $0.13 | $0.81 | $0.84 | $0.22 | **$0.299** |
| **Doubao 2.0 Pro** | $0.10 | $0.03 | $0.08 | $0.05 | $0.03 | ∞ | $0.02 | $0.02 | $0.12 | $0.01 | **$0.034** |
| **Qwen 3.6 Max** | $0.09 | $0.14 | $0.09 | $0.04 | $0.08 | $0.07 | $0.06 | $0.09 | $0.12 | $0.11 | **$0.079** |
| **ERNIE 4.5** | $0.04 | ∞ | $0.01 | $0.01 | $0.03 | $0.04 | $0.01 | $0.02 | $0.14 | ∞ | **$0.026** |
| **MiniMax M2.7** | $0.06 | $0.05 | ∞ | $0.07 | $0.02 | $0.06 | $0.07 | ∞ | ∞ | $0.09 | **$0.083** |

`∞` = cell produced 0 unique ideas → infinite cost-per-unique. The cell simply does not yield shippable output at any budget for that (model × archetype) pairing. Even within a single model, the spread is large: Opus produces unique `estimation` ideas at $0.15 and unique `comparison` ideas at $0.89 — a 6× internal spread.

### 3 — Saturation decay over time (do models actually "run out of ideas"?)

The static survival rate above averages across every batch. The diagnostic question is: **does each model's survival rate drop as it keeps running on the same archetype-mix?** Each model's batches sorted chronologically, bucketed into first 5 / middle 5 / last 5.

| Model | 1st 5 batches | mid 5 batches | last 5 batches | Δ first→last |
|---|---|---|---|---:|
| **Qwen 3.6 Max** | **73%** (22/30) | 60% (18/30) | **33%** (10/30) | **−40 pp** |
| **GPT-5** | **50%** (14/28) | 42% (11/26) | **13%** (4/29) | **−37 pp** |
| **GLM-5.1** | 39% (9/23) | 26% (4/15) | 13% (3/23) | **−26 pp** |
| **Doubao 2.0 Pro** | 36% (11/30) | 16% (5/30) | 10% (3/30) | **−26 pp** |
| **ERNIE 4.5** | 30% (9/30) | 10% (3/30) | 6% (2/30) | **−24 pp** |
| **Claude Opus 4.7** | 16% (5/30) | 13% (4/30) | 6% (2/30) | −10 pp |
| **DeepSeek V4-Pro** | 25% (7/27) | 53% (14/26) | 32% (8/25) | **+7 pp** |
| **MiniMax M2.7** | 10% (3/30) | 13% (4/30) | 4% (1/24) | −6 pp |
| Gemini 2.5 Pro † | 0% (0/15) | 40% (12/30) | 6% (2/30) | n/a (cold start) |
| Kimi K2.6 † | 0% (0/8) | 45% (5/11) | 37% (11/29) | n/a (model-id fix mid-experiment) |

**Seven of ten models show clear default-repertoire-collapse decay over time.** Qwen and GPT-5 fall hardest (−40 pp, −37 pp). Opus only drops −10 pp because it had nowhere left to fall — its default repertoire collapsed before the experiment began. **DeepSeek V4-Pro is the only model that did NOT decay** (+7 pp) — likely because the seed-evolver kept feeding it freshly-discovered seeds where its training corpus has unmined depth.

The full six matrices (including generation attempts, the combined surv/gen+$/uniq view, and per-cell quality scores that prove "unique" ≠ "low quality") plus the global saturation curve are in **[docs/IDEAS_MATRIX.md](./docs/IDEAS_MATRIX.md)**.

### A note on Claude Opus 4.7 as the seed-quality gatekeeper

This repo uses Opus 4.7 to audit *seed* proposals from the AI seed-evolver — despite Opus showing the worst survival rate (17%) and highest cost per idea ($0.421) in the same matrix. That choice is deliberate, and it's a meta-finding: **quality-judgment converges across these 10 models** (spread 0.28 on a 5-point scale), while *idea-novelty* does not (spread 35 percentage points on survival rate). Opus is strong at structural auditing — its bottleneck is fresh-idea generation, not evaluation. The matrix doesn't say "Opus is a bad model"; it says "Opus is in a different cell of the model-capability matrix than the leaders."

## Provider matrix

The pipeline supports 14 chat providers across US, Chinese, and Google partner tiers:

| Tier | Providers |
|---|---|
| US frontier | `anthropic` (Opus 4.7), `openai` (GPT-5) |
| Google | `google` (Gemini 3.1 Pro) + 3 Vertex Model Garden partners (`vertex-mistral`, `vertex-ai21`, `vertex-grok`) |
| Chinese (direct) | `deepseek` (V4-Pro), `dashscope` (Qwen-Max), `zai` (GLM-5.1), `moonshot` (Kimi K2.6), `byteplus` (Doubao Seed 2.0 Pro) |
| Chinese (OpenRouter) | `openrouter-qwen`, `openrouter-minimax`, `openrouter-ernie`, `openrouter-doubao` |

Auto-shadowing rule: direct vendor keys override OpenRouter routes for the same vendor (DashScope hides `openrouter-qwen`; BytePlus hides `openrouter-doubao`).

## Quickstart

```bash
git clone https://github.com/EmilHerzberg/out-of-ideas
cd out-of-ideas
npm install
cp .env.example .env   # then add API keys for whichever providers you want

# Generate 100 questions, $10 budget cap, all configured providers in rotation
npm run cli -- auto-generate --target 100 --budget 10

# Inspect the run log
ls data/auto-runs/<timestamp>/
cat data/auto-runs/<timestamp>/summary.json
```

The pipeline creates `data/` on first run; everything (intermediate JSONL files, embeddings, run logs, the finalized pool) lives there.

## What's in this repo

```
src/                              # the pipeline (TypeScript)
├── cli.ts                        # commander entry point
├── orchestrator.ts               # auto-generate scheduler
├── generator.ts                  # seed-aware generation
├── quality.ts                    # multi-dim quality runner
├── verifier.ts                   # web-grounded fact check
├── embedder.ts                   # 768-d multilingual embeddings
├── dedup.ts                      # HNSW cosine bands
├── seeds.ts                      # seed loader / sampler
├── seed-evolver.ts               # per-seed stats + new-seed proposals
├── seed-verifier.ts              # Opus-4.7 gatekeeper for proposals
├── rewrite-mobile.ts             # compress over-budget questions
├── schema.ts                     # Zod schemas
├── providers/                    # 14 provider adapters
└── prompts/                      # master + 12 archetype prompts
        + quality + seed-verifier + default-repertoire

seeds/seeds.jsonl                 # 59 curated sub-topic seeds
web/review.html                   # local HTML reviewer for flagged questions

samples/
├── sample-questions.jsonl        # 100 production-grade sample questions
└── README.md                     # coverage matrix + schema

docs/
├── DISTINCT_IDEAS_THESIS.md      # the headline thesis
├── IDEAS_MATRIX.md                # six (model × archetype) matrices — gen, survival, $/unique, combined, quality, saturation
├── ANALYSIS.md                    # full benchmark report
├── PROMPTS.md                     # every AI prompt with reasoning
└── PROMPT_AUDIT.md                # prompt-optimization audit

analyze-all.mjs                   # reproducibility script — pool + run logs → tables
compute-ideas-matrix.mjs          # the default-repertoire-depth matrix computation
```

## Data — what's intentionally not in this repo

We ship the **pipeline and the methodology**, not the raw question dataset. The `data/` directory is gitignored. It contains:

- `data/finalized-pool.jsonl` — 802 surviving questions + 768-d embeddings (~9 MB). Of those, **586 are from the 10 headline-scope models**; the other 216 come from model variants that did not reach the ≥10-attempts floor (see `docs/IDEAS_MATRIX.md` appendix). Of the 586, **538 are attributable to logged auto-runs with full per-batch cost tracking** — the rest predate the cost-tracking layer.
- `data/auto-runs/<ts>/` — full logs of every orchestrator run (~25 MB total)
- `data/_analysis_raw.json` — output of `analyze-all.mjs`

The question dataset is not shipped publicly because the canonical use-case is a competitive quiz game where shipping the answers undermines the product. If you want to verify the benchmark numbers in `docs/ANALYSIS.md`, run the pipeline yourself for ~$69 of API spend. **The methodology is open and reproducible; the dataset is private** — together that makes this an open-source pipeline + open-methodology benchmark, not an open-dataset release.

The analysis docs (`docs/ANALYSIS.md`, `docs/IDEAS_MATRIX.md`, `docs/DISTINCT_IDEAS_THESIS.md`) report the *results* of analysis; the raw data files are kept private.

## Architectural decisions

A short list of what we'd carry into any future LLM pipeline. Each one is grounded in production evidence from running the pipeline at scale.

1. **Embed `<question> ‖ <correct answer>` only.** Distractors are arbitrary noise. Embedding them dilutes the similarity signal.
2. **Include the new batch in the dedup index.** Within-batch duplicates were the dominant failure mode in early runs.
3. **Cluster-survivor promotion.** When two new questions form a ≥0.84 cluster, keep one; pool members are never promoted.
4. **Stratified within-batch sampling beats random.** With 4 seeds and 10 questions, random sampling gives you a 5/0/0/0 distribution one batch in three.
5. **Top-tier ≠ best for diversity.** Smaller models often produce more diverse output once a seed is saturated — once the pool already contains the top-N canonical angles, smaller models surface adjacent angles where bigger ones double down on the canon. Reproducibly observed on controlled re-runs of the same seed.
6. **Auto-disable on (provider × model × archetype), keyed by model id.** Upgrading the configured model resets evidence — the new model gets a clean slate.
7. **Concurrent batches with provider-uniqueness guarantee.** 2.00× speedup with zero race conditions.
8. **The verifier is the most under-invested stage.** Our verifier prompt is 14 lines and rejects roughly 80% of questions before they reach the finalized pool — the dominant filter, but the least-invested-in component.

## Setup detail

### API key locations
- Anthropic: https://console.anthropic.com/settings/keys
- OpenAI: https://platform.openai.com
- DeepSeek: https://platform.deepseek.com/api_keys
- DashScope (Alibaba — Qwen): https://dashscope.console.aliyun.com (CN) or https://www.alibabacloud.com/product/modelstudio (intl)
- Z.ai (ZhipuAI — GLM): https://z.ai (intl) or https://open.bigmodel.cn (cn)
- Moonshot (Kimi): https://platform.moonshot.ai (intl) or https://platform.moonshot.cn (cn)
- BytePlus (ByteDance — Doubao Seed 2.0 Pro): https://www.byteplus.com
- OpenRouter (gateway for Qwen / MiniMax / ERNIE / Doubao): https://openrouter.ai
- Voyage (alternative embedder): https://dash.voyageai.com

### Google Cloud / Vertex AI

Two ways to authenticate:

1. **Service account JSON**: drop a service-account JSON in the repo root and point `GOOGLE_APPLICATION_CREDENTIALS=./service-account.json` in `.env`. Service account needs the `Vertex AI User` role. Set `GOOGLE_CLOUD_PROJECT=<project-id>`. The file is gitignored.
2. **gcloud Application Default Credentials**: `gcloud auth application-default login`, then set `GOOGLE_CLOUD_PROJECT=<project-id>` in `.env`.

### Vertex Model Garden partner models

Three providers piggyback on Google service-account credentials — `vertex-mistral`, `vertex-ai21`, `vertex-grok`. Before first use, enable the partner model in *Cloud Console → Vertex AI → Model Garden → publisher → Enable*. The endpoint returns 404 until enabled.

## Citation

If you use this dataset or replicate the methodology in academic or industry work, please cite:

```bibtex
@misc{herzberg2026outofideas,
  author = {Emil Herzberg and Anton Herzberg},
  title  = {out-of-ideas: Measuring default-repertoire depth in Frontier LLMs via Production Quiz Generation},
  year   = {2026},
  url    = {https://github.com/EmilHerzberg/out-of-ideas}
}
```

## License

**[Apache License 2.0](./LICENSE)** — see also [NOTICE](./NOTICE).

Copyright (c) 2026 Emil Herzberg and Anton Herzberg.

You may freely use, modify, distribute, and build commercial products on top of this software, provided you preserve the copyright notice and the Apache-2.0 license text. The license includes an explicit patent grant, making it safe for enterprise adoption.

If you use the software, the dataset, or the methodology in academic or industry work, please cite this repository (see [Citation](#citation) above) — attribution is appreciated but not required.

## What this pipeline does NOT do

- It does not write to Firebase or any cloud database (output is local JSONL).
- It does not run on a schedule — operator runs each command manually or via the `auto-generate` orchestrator.
- It is not a general-purpose LLM benchmark suite — it's a working production pipeline that *happens* to produce comparable benchmark data as a side effect.
- It does not use anti-example / negative prompting (tried, didn't work — see `docs/ANALYSIS.md`).

## Contact

Issues + PRs welcome. For replication help, collaboration, consulting, or hiring: open an issue, reach out via [LinkedIn](https://linkedin.com/in/emilherzberg), or email **emil.herzberg.eh@gmail.com**.
