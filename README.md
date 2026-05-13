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

→ Full thesis: [docs/DISTINCT_IDEAS_THESIS.md](./docs/DISTINCT_IDEAS_THESIS.md)
→ The reproducible matrices: [docs/IDEAS_MATRIX.md](./docs/IDEAS_MATRIX.md)
→ Full benchmark report: [docs/ANALYSIS.md](./docs/ANALYSIS.md)

## Headline numbers

After 14 days, 24 orchestrator runs, and 1,856 generations across the **headline scope** (the 10 models that hit ≥10 generation attempts in every archetype cell):

| Model | Survival % | $ / unique idea |
|---|---:|---:|
| ERNIE 4.5 300B-A47B | 13% | **$0.026** ← cheapest |
| Doubao 2.0 Pro (BytePlus) | 20% | $0.034 |
| Gemini 2.5 Pro (AI Studio) | 22% | $0.062 |
| DeepSeek V4-Pro | **40%** ← top survival (tied) | $0.069 |
| Qwen 3.6 Max | **47%** ← top survival | $0.079 |
| MiniMax M2.7 | 13% | $0.083 |
| GLM-5.1 (Z.ai) | 31% | $0.125 |
| GPT-5 | **40%** ← top survival (tied) | $0.128 |
| Kimi K2.6 | 38% | $0.299 |
| **Claude Opus 4.7** | **17%** ← worst survival | **$0.421** ← most expensive |

*Bold cells flag noteworthy extremes (best / worst per column). The spread between them is the finding.*

**16× cost-per-unique-idea spread between the cheapest and most expensive frontier model**, with quality-score *spread* across the table of only 0.28 on a 5-point scale (3.97 → 4.25). The differentiator is depth-of-novelty, not quality of any individual output. **Claude Opus 4.7 collapsed hardest among the premium models in this test** — that's an Opus-specific finding from our dataset, not a universal "bigger models are worse" claim. GPT-5 sits at the same top survival rate as DeepSeek V4-Pro (40%); model size alone does not predict novelty depth.

Confidence tiers (high ≥20 generations, medium 10–19) are documented per cell in `docs/IDEAS_MATRIX.md`. Methodology is reproducible; absolute numbers will vary ±5% per high-confidence cell on rerun.

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
