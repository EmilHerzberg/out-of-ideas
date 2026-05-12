# The default-repertoire-depth Matrix

*Quantifying "when does each AI start running out of ideas?" — measured across 11 frontier LLMs, 10 reported archetypes (2 archetypes had insufficient cross-provider data), 15 seeds, 1,476 generations.*

## Read this first — what the matrix measures

Each cell shows the **production survival rate** = (questions that passed all 6 pipeline stages including embedding-based dedup) / (questions generated). We use this as a **production proxy for default-repertoire depth** — how many distinct ideas the provider has for that cell before paraphrasing collapses survival. It is **not** a pure measure of canon depth (the Methodology section below explains what it conflates with and how to interpret edge cases).

- **High % = deep default repertoire for this cell.** The model has many distinct angles to surface before repeating itself.
- **Low % = shallow default repertoire for this cell.** The model paraphrases itself early; embedding dedup catches the repeats.
- **— = not tested, excluded by compatibility rules, or no usable sample.**
- Cells with **<6 generations** appear as raw fractions like `(1/5)` — treat these as **anecdotal**; the rate is noise-dominated below that floor.

### Confidence tiers used in this matrix

| Tier | Sample size | Reliability |
|---|---|---|
| **High** | ≥20 generations | Stable to ±5%. 38 cells qualify. |
| **Medium** | 6–19 generations | Stable to ±15%. Useful for direction, not absolute claims. |
| **Anecdotal** | <6 generations | Reported as raw fractions. Do not draw conclusions from a single cell. |

When the post or repo cites a number from this matrix, the underlying tier should always be checked.

---

## Matrix 1 — Provider × Archetype default-repertoire depth

The headline matrix. Read it as: "How many distinct ideas does each provider have for each question structure?"

| Provider | cause_effect | comparison | process_seq | misconception | etymology | estimation | lateral_conn | odd_one_out | vocab_ctx | strategy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **anthropic** (Opus 4.7) | 8% (4/48) | 17% (1/6) | 8% (1/12) | 33% (6/18) | — | — | 17% (3/18) | 33% (4/12) | — | — |
| **openai** (GPT-5) | 46% (11/24) | 14% (1/7) | — | — | 50% (3/6) | **60%** (18/30) | 33% (4/12) | **90%** (9/10) | — | — |
| **google** (Gemini 3.1 Pro) | 15% (7/47) | 25% (14/56) | — | 44% (16/36) | — | 14% (5/36) | **67%** (12/18) | 54% (21/39) | — | 47% (14/30) |
| **deepseek** (V4-Pro) | 26% (26/99) | 33% (5/15) | **54%** (15/28) | 34% (10/29) | **58%** (7/12) | 41% (13/32) | **57%** (16/28) | 50% (6/12) | — | 15% (2/13) |
| **zai** (GLM-5.1) | 42% (5/12) | **63%** (5/8) | 20% (3/15) | 24% (12/49) | (1/5) | 6% (1/17) | **69%** (11/16) | 50% (12/24) | 0% (0/6) | 29% (2/7) |
| **openrouter-qwen** (Qwen 3.6 Max) | 42% (5/12) | 32% (6/19) | — | **71%** (17/24) | — | 43% (13/30) | 48% (14/29) | **92%** (11/12) | 33% (2/6) | 44% (8/18) |
| **byteplus** (Doubao Seed 2.0 Pro) | 6% (1/18) | — | 0% (0/6) | 33% (2/6) | — | 0% (0/12) | **67%** (4/6) | 28% (5/18) | — | 33% (4/12) |
| **moonshot** (Kimi K2.6) | — | (0/3) | (0/1) | 46% (6/13) | — | (2/5) | 25% (2/8) | (0/2) | (1/5) | (0/3) |
| **openrouter-minimax** (M2.7) | 17% (1/6) | 13% (4/30) | 6% (1/18) | 8% (1/12) | 33% (4/12) | 21% (5/24) | 50% (6/12) | 29% (5/17) | 0% (0/6) | 8% (1/12) |
| **openrouter-ernie** (4.5-300b) | 9% (2/23) | 0% (0/6) | 17% (4/24) | 33% (4/12) | — | 0% (0/6) | 29% (7/24) | 13% (4/30) | — | 0% (0/12) |
| **openrouter-doubao** (Seed 1.6) | 33% (2/6) | — | 17% (1/6) | — | — | — | **100%** (6/6) | — | — | 8% (1/12) |

### How to read this

**Bold = ≥50% survival** — provider has deep default repertoire for that cell. These are the production-grade pairings.

The matrix is **not symmetric**. There is no "best provider":

- `cause_effect` ranges from 6% (BytePlus) to 46% (GPT-5) — a 7.7× spread on the SAME archetype.
- `odd_one_out` ranges from 13% (ERNIE) to 92% (Qwen) — a 7× spread.
- `estimation` ranges from 0% (BytePlus, ERNIE) to 60% (GPT-5) — some providers have zero default-repertoire depth for this cell at all.

**The right unit of optimization is the cell, not the provider.**

---

## Matrix 2 — Provider "breadth" score

How many cells does each provider have meaningful default-repertoire depth in?

| Provider | Cells tested (≥6 gen) | **Strong** (≥50% survival) | **Weak** (<20% survival) | Breadth verdict |
|---|---:|---:|---:|---|
| **deepseek** (V4-Pro) | 9 | **4** | 1 | Generalist. Wide default repertoire across structures. |
| **openai** (GPT-5) | 6 | **3** | 1 | Specialist. Wins in 3, hasn't been tested broadly. |
| **zai** (GLM-5.1) | 9 | 3 | 2 | Surprising depth on `comparison` and `lateral_connection`. |
| **google** (Gemini 3.1 Pro) | 7 | 2 | 2 | Reliable middle-ground; default-repertoire depth varies by cell. |
| **openrouter-qwen** | 8 | 2 | 0 | No weak cells. Robust across the board. |
| byteplus (Doubao Seed 2.0 Pro) | 7 | 1 | 3 | Narrative writer; fails strict-format cells. |
| openrouter-doubao | 4 | 1 | 2 | Limited sample. |
| openrouter-minimax (M2.7) | 10 | 1 | 6 | Broad but shallow default repertoire. |
| **anthropic** (Opus 4.7) | 6 | **0** | 4 | **Worst breadth in the test.** default-repertoire collapses early. |
| openrouter-ernie (4.5-300b) | 8 | 0 | 6 | default-repertoire depth too low for production use. |
| moonshot (Kimi K2.6) | 2 | 0 | 0 | Insufficient data — k2.6 model id may be invalid. |

### The surprising outlier — Opus 4.7

In this dataset, premium frontier models did not reliably have deeper default repertoires. **Opus 4.7 was a notable outlier**: high writing quality, but low breadth across the cells we tested — 0 cells with strong default-repertoire depth, 4 cells with weak depth. Its qualityScore (4.15/5) is on par with everyone else. The model writes excellent questions. It just writes the *same* excellent questions over and over within any given cell.

This is **not** a claim that all premium models behave this way — our sample includes only one Anthropic flagship at one point in time, and we did not control for prompt sensitivity or model versioning. It **is** a claim that, for this constrained-creative-generation task, premium pricing did not automatically buy deeper default repertoires. At $0.39 per shipped question, Opus was 17× more expensive than the cheapest provider in the test for output that scored the same on quality.

---

## Matrix 3 — Seed × Provider — distinct ideas per topic

For the 15 most-mined seeds, how many survivors did each provider contribute? **Each number = the count of distinct ideas that provider was able to produce on that topic before saturating.**

| Seed | anthropic | byteplus | deepseek | google | moonshot | openai | or-ernie | or-minimax |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `tech_algorithms_pop` | 1 | 2 | **5** | **5** | 0 | 2 | 1 | 0 |
| `hist_everyday_life_pop` | 2 | 0 | 7 | **12** | 0 | 0 | 1 | 0 |
| `pop_music_pop` | 1 | 0 | **11** | 5 | 1 | 0 | 0 | 2 |
| `tech_security_pop` | 0 | 1 | **9** | 3 | 1 | 1 | 0 | 0 |
| `sci_tech_myths` (AI-discovered) | 0 | 0 | **7** | 4 | 1 | 3 | 1 | 0 |
| `sci_animals_pop` | 0 | 0 | 6 | **9** | 0 | 1 | 0 | 0 |
| `tech_invent_pop` | 1 | 2 | **5** | **5** | 0 | 3 | 0 | 0 |
| `sci_space_pop` | 1 | 0 | 6 | **8** | 0 | 0 | 0 | 0 |
| `pop_videogames_pop` | 0 | 1 | **6** | 4 | 0 | 0 | 0 | 1 |
| `pop_movies_pop` | 0 | 2 | **6** | 3 | 2 | 1 | 0 | 2 |
| `sci_weather_pop` | 0 | 0 | 6 | **9** | 0 | 0 | 0 | 0 |
| `geo_landmarks_pop` | 2 | 0 | 4 | **7** | 0 | 0 | 0 | 0 |
| `hist_explorers_pop` | 1 | 0 | 5 | **8** | 0 | 0 | 0 | 0 |
| `sport_records_pop` | 0 | 0 | **5** | **5** | 1 | 1 | 0 | 0 |
| `sci_human_body_pop` | 1 | 0 | 5 | **6** | 0 | 1 | 0 | 0 |

### The pattern

For most science seeds, **Google has the deepest default repertoire** (sci_animals 9, sci_space 8, sci_weather 9, sci_human_body 6, hist_explorers 8, geo_landmarks 7). For media/tech seeds, **DeepSeek dominates** (pop_music 11, tech_security 9, sci_tech_myths 7).

**Different training corpora → different default-repertoire depths per topic.** Google's strong on the Wikipedia-natural-history axis; DeepSeek's strong on the developer-and-pop-media axis. This isn't a "better model" story — it's a topical-coverage story.

### Practical implication for production

If your task is "generate 100 questions about animal behavior," the right provider is Google. If your task is "generate 100 questions about programming algorithms," the right provider is DeepSeek. **Not because one model is better than the other** — because each model's training data has more variation in that topic.

This is why provider-rotation matters more than provider-selection. The portfolio of non-overlapping default repertoires is what gives you scale.

---

## Methodology — what production survival rate measures vs what it doesn't

**Production survival rate = (questions kept after all stages) / (questions generated)**. The pipeline drops questions for three reasons, in this order:

1. **Quality reject** (~25% of generated, varies by archetype): the question violates structural rules (length-tells, non-defeatable distractors, archetype-specific rule failures, Wikipedia-extractable trivia, no reasoning hook). This measures *craftsmanship*, not default-repertoire depth.
2. **Verification fail** (~5%): the web-grounded fact check disagreed with the AI's correct answer. This is rare and noise-dominated; not a default-repertoire-depth signal.
3. **Dedup reject** (~30-40% of generated): cosine similarity ≥ 0.84 against the pool OR within-batch. **This is the default-repertoire-depth signal.** A question rejected here is one the AI already produced in a different phrasing.

Production survival rate conflates (1) + (3), which is exactly what makes it a **proxy** rather than a pure canon-depth measure. Splitting them cleanly requires controlled pinned-cell experiments. We did this for `sci_space_pop` in early testing: the dedup-only rejection rate accounted for ~80% of total rejection on saturated cells and ~30% on fresh cells. So **on saturated cells, production survival rate is dominated by default-repertoire depth; on fresh cells, it's a mix of craft + default repertoire**.

Treat the matrix as a **production-grade signal**: it tells you which (provider × archetype) cells reliably ship usable outputs, not which cells have the largest theoretical idea space.

Future work to tighten this metric:

1. **Separate dedup-only survival from quality-only survival** in the run logs. The data exists per batch but isn't currently aggregated this way.
2. **Run controlled pinned-cell experiments** for every cell, not just `sci_space_pop`. Cost: ~$3 per cell × 132 cells = $400 for a complete default-repertoire-depth atlas.
3. **Compare across provider pairs on the same cell** to compute idea-overlap directly via embedding similarity between provider outputs. This would let us quantify the "different providers have different default repertoires" claim with a real Jaccard distance.

---

*Generated 2026-05-12 from `data/finalized-pool.jsonl` (618 questions) and `data/auto-runs/*/run.log.jsonl` (17 runs, 332 batches). Reproducible via `node compute-ideas-matrix.mjs`.*
