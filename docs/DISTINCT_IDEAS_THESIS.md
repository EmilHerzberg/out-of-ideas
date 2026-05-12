# Can We Measure in a Quantitative Way When an AI Runs Out of Ideas?

*A short note on what we accidentally measured while trying to ship a quiz game.*

---

## The question nobody is asking

Every frontier LLM, asked the same generic question, produces variations of the same underlying ideas. Ask 5 different models for "fun science questions" and you get 5× the same default-repertoire trivia, with different phrasing.

This is intuitively obvious to anyone who has tried it. **But until now, nobody had a number for it.**

The AI industry measures quality (MMLU, HumanEval, GPQA), speed (tokens/sec), cost (per token), and capability (context length, multi-modal). None of these answer the question that production teams actually face when generating creative output at scale:

> *How many distinct ideas does this model have for the task in front of me, before it starts paraphrasing itself?*

We built a pipeline that, as a side effect of solving our own problem, answers that question quantitatively.

## The thesis

**The differentiator between frontier LLMs in production is not "which model writes the best output." It's how many distinct ideas each model has for a given cell before it starts paraphrasing itself.**

A "cell" is whatever unit of variation your task generates against. For us: (seed × archetype) — a specific sub-topic + a specific question structure. For other production tasks, it might be (customer segment × email type), (product category × ad headline), (legal area × clause type).

When you ask a frontier LLM for output in a single cell repeatedly, three things happen in sequence:

1. **Batches 1–3:** Distinct, high-quality ideas. The model surfaces its top-N "default-repertoire" answers from training data.
2. **Batches 4–6:** Paraphrases start appearing. Same underlying idea, different wording. Embedding-based dedup catches them.
3. **Batches 7+:** Effective output collapses. The cell is saturated for *this provider*.

The number of distinct ideas before saturation is the metric we're calling **default-repertoire depth**. It's measurable, reproducible, and varies dramatically by (provider × cell).

## What we measured

After 1,476 generations across 11 frontier LLMs and 17 orchestrator runs, the numbers are clear:

### Finding 1 — default-repertoire depth is finite and consistent per cell

For a typical (seed × archetype) cell, frontier models exhaust **3–5 distinct ideas** before paraphrasing kicks in. This number is roughly constant across providers — it's the structural size of the model's training-data default repertoire for that cell, not a quality signal.

### Finding 2 — Premium pricing did not reliably buy deeper default repertoires

In this dataset, premium frontier models did not reliably have deeper default repertoires. **Opus 4.7 was a notable outlier** — high writing quality, but narrow across the cells we tested. From a controlled pinned-seed test on the same Science seed:

- **Claude Opus 4.7:** 8 out of 8 generations collapsed to a single fixation ("Why do stars twinkle?"). default-repertoire depth: 1.
- **Claude Sonnet 4.6:** Same seed, same prompt, produced 3 distinct angles. default-repertoire depth: 3.
- **GPT-5:** 5 out of 8 twinkle, then mixed (Pluto, moon shape). default-repertoire depth: 4.
- **DeepSeek V4-Pro:** 6 out of 8 moon-horizon, 2 twinkle — a *different* fixation entirely. default-repertoire depth: 2 (but oriented elsewhere).

This is **not** a general claim that all premium models behave this way — our sample includes one Anthropic flagship at one point in time. What it **does** show: paying premium per-token does not guarantee deeper novelty per-cell. For tasks where unique outputs matter more than peak craft on a single output, cheaper-tier or differently-trained models can outperform their premium counterparts on this specific dimension.

### Finding 3 — Different providers have DIFFERENT default repertoires

A cell exhausted on Provider A still has 3-5 fresh ideas left on Provider B. We verified this by switching providers mid-run on saturated seeds:

- `sci_space_pop` saturated on Anthropic → switched to Google → 8 new distinct ideas surfaced
- `lang_etymology_pop` saturated on Gemini → switched to DeepSeek → different fixation (`panic` vs `mortgage`)
- `hist_inventions_pop` saturated on every US provider → Chinese providers (Qwen, BytePlus) produced different angles

**The training-data default repertoires of US and Chinese frontier models do not fully overlap.** This is not a coincidence — it's a function of how different the underlying training corpora are.

### Finding 4 — default-repertoire depth is measurable per (provider × cell)

The matrix in `IDEAS_MATRIX.md` shows the survival-rate-as-a-proxy for default-repertoire depth across all 132 (provider × archetype) cells in our dataset. Sample:

```
                  cause_effect   misconception   odd_one_out   estimation
DeepSeek V4-Pro       26%            34%            50%           41%
Opus 4.7               8%            33%            33%            —
Google Gemini Pro     15%            44%            54%           14%
OpenAI GPT-5          46%             —             90%           60%
Qwen 3.6 Max          42%            71%            92%           43%
```

Read this as: "Of every 100 questions generated by OpenAI GPT-5 in the `odd_one_out` cell, 90 are distinct enough to ship." Or: "Anthropic Opus 4.7's default-repertoire depth for `cause_effect` is roughly 8% of generations — it paraphrases very aggressively in that cell."

## Why this matters

If you're building anything that requires LLM output at scale with novelty as a requirement — content generation, synthetic data, simulation, creative pipelines, training-data augmentation, anything where the same prompt runs more than ~30 times — **default-repertoire depth is the binding constraint, not cost or quality**.

You will hit default-repertoire-output collapse before you hit cost limits.

The architecture that handles this:

1. **Multi-provider rotation by default.** Treat providers as a portfolio with non-overlapping idea-spaces, not a vendor selection.
2. **Measure per-cell yield, not per-provider yield.** A provider can be a top-3 performer for one cell and a bottom-3 performer for another.
3. **Auto-disable saturated cells, not saturated providers.** A 16% survival rate on (Provider X, Cell Y) is a signal about *that combination*, not Provider X overall.
4. **Build for diversity at the input layer.** Anti-examples and negative prompts fight the symptom. Seed steering (positive anchoring) plus provider rotation address the cause.

## The matrices

Two reproducible artifacts ground this thesis:

- **`IDEAS_MATRIX.md`** — Provider × Archetype yield matrix (11 providers × 12 archetypes) plus Seed × Provider distinct-ideas count for the 15 most-used seeds.
- **`PUBLIC_ANALYSIS.md`** — full benchmark report with $/survivor numbers, saturation curves, methodology.

Both reproduce from `data/finalized-pool.jsonl` and `data/auto-runs/*/run.log.jsonl`. Run `node analyze-all.mjs` to verify.

---

*Project: out-of-ideas. 618 questions, 17 orchestrator runs, 11 frontier LLMs, $30.32 total spend. May 2026.*
