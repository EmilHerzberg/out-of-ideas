# The default-repertoire-depth Matrix

*Quantifying "when does each AI start running out of ideas?" — measured across **10 frontier models** that each ran ≥10 generation attempts in every one of 10 archetype cells. 15 seeds, **1,856 generations**, **538 surviving unique ideas**, **$69 of API spend**.*

## Read this first — what the matrix measures

A **unique idea** in this pipeline is a question that passes all 6 stages: generate → quality → verify → embed → dedup (cosine ≥ 0.84 against the pool + within-batch) → finalize. The dedup stage is the load-bearing one: a question rejected for being a near-paraphrase of an existing one is the default-repertoire-collapse signal we set out to measure.

We report this view across six matrices:

- **A — generation attempts** (volume)
- **B — survival rate** (what % of attempts produced unique ideas)
- **C — $ per unique idea** (the production-economics view)
- **D — combined** (survival fraction + $/unique per cell)
- **E — quality score** (proof that "unique" is not just "low quality")
- **F — saturation decay** (proof that "running out of ideas" is a real temporal phenomenon)

**Confidence rule for all cell-level matrices below:**

- Cells with **≥20 generations** are bolded → high confidence (±5%)
- Cells with **10–19 generations** are unbolded → medium confidence (±15%)
- No cell in the headline matrix has <10 generations — that's the gating rule for inclusion. Models that did not reach this floor in every archetype are listed in the appendix.

---

## Matrix A — Generation attempts per cell

The raw "how much did we test each (model × archetype) pair?" view. This is the floor metric: every cell here is ≥10 by design.

| Model | cause_effect | comparison | process_seq | misconception | etymology | estimation | lateral_conn | odd_one_out | vocab_ctx | strategy | **TOTAL** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Claude Opus 4.7** (anthropic) | **48** | **24** | 12 | 18 | 18 | 12 | 18 | 18 | 12 | 12 | **192** |
| **GPT-5** (openai) | **36** | **23** | 12 | 18 | 18 | **30** | 18 | **22** | 12 | 12 | **201** |
| **Gemini 2.5 Pro** (google, AI Studio) | **21** | **21** | 18 | **24** | 18 | **24** | 18 | 18 | 18 | 18 | **198** |
| **DeepSeek V4-Pro** | **35** | 13 | **22** | **24** | **24** | **27** | **28** | 16 | 16 | **22** | **227** |
| **GLM-5.1** (Z.ai) | **23** | **20** | **21** | **49** | 18 | 17 | 16 | **24** | 15 | 12 | **215** |
| **Kimi K2.6** (Moonshot) | **20** | 15 | 13 | 13 | **21** | 11 | 14 | 16 | 11 | 18 | **152** |
| **Doubao 2.0 Pro** (BytePlus) | 18 | 12 | 12 | 18 | 12 | 12 | 18 | 18 | 12 | 12 | **144** |
| **Qwen 3.6 Max Preview** | 18 | 19 | 12 | **24** | 12 | **30** | **29** | 18 | 12 | 18 | **192** |
| **ERNIE 4.5 300B-A47B** | **23** | 12 | **24** | 12 | 12 | 12 | **24** | **30** | 12 | **24** | **185** |
| **MiniMax M2.7** | 12 | **30** | 12 | 12 | 12 | 18 | 12 | 12 | 18 | 12 | **150** |
| **COLUMN TOTAL** | **254** | **189** | **158** | **212** | **165** | **193** | **195** | **192** | **138** | **160** | **1,856** |

42 of 100 cells are ≥20 (high confidence); the other 58 are 10–19 (medium confidence). The most-saturated cells are GLM-5.1 × misconception (49) and Claude Opus 4.7 × cause_effect (48) — both used as deep default-repertoire-depth probes.

---

## Matrix B — Survival rate (unique ideas / generations)

The headline matrix. Read it as: "Out of every 100 questions this model produced in this cell, how many were unique enough to ship after dedup?"

| Model | cause_eff | comparison | process_seq | misconception | etymology | estimation | lateral_conn | odd_one_out | vocab_ctx | strategy | **Row Ø** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Claude Opus 4.7** | **8%** | **8%** | 8% | 33% | 22% | 50% | 16% | 22% | 8% | 8% | **17%** |
| **GPT-5** | **41%** | **21%** | 83% | 16% | 38% | **60%** | 38% | **50%** | 16% | 25% | **40%** |
| **Gemini 2.5 Pro** | **38%** | **14%** | 38% | **16%** | 33% | **4%** | 33% | 33% | 11% | 5% | **22%** |
| **DeepSeek V4-Pro** | **22%** | 46% | **63%** | **41%** | **41%** | **40%** | **57%** | 25% | 12% | **45%** | **40%** |
| **GLM-5.1** | **43%** | **50%** | **23%** | **24%** | 16% | 5% | 68% | **50%** | 0% | 25% | **31%** |
| **Kimi K2.6** | **45%** | 26% | 38% | 46% | **38%** | 45% | 42% | 43% | 9% | 38% | **38%** |
| **Doubao 2.0 Pro** | 5% | 33% | 8% | 16% | 33% | 0% | 33% | 27% | 8% | 33% | **20%** |
| **Qwen 3.6 Max** | 38% | 31% | 41% | **70%** | 50% | **43%** | **48%** | 72% | 25% | 44% | **47%** |
| **ERNIE 4.5** | **8%** | 0% | **16%** | 33% | 16% | 8% | **29%** | **13%** | 8% | **0%** | **13%** |
| **MiniMax M2.7** | 16% | **13%** | 0% | 8% | 33% | 27% | 16% | 0% | 0% | 8% | **12%** |
| **Column Ø** | 25% | 23% | 32% | 31% | 32% | 31% | 40% | 34% | **9%** | 23% | **28%** |

**What the matrix says:**

- **No model is uniformly best.** Qwen tops the table at 47% Ø but loses to GPT-5 on `process_sequence` (83% vs 41%) and to GLM-5.1 on `lateral_connection` (68% vs 48%).
- **Cell-level spread is huge:** `cause_effect` ranges 5% (Doubao) to 45% (Kimi) — a 9× spread on the SAME archetype across same-budget models.
- **`odd_one_out` ranges 0% (MiniMax) to 72% (Qwen)** — a 72-point gap that is impossible to predict from MMLU or pricing.
- **`vocab_context` is the matrix-wide weak point** (Ø 9%) — no model exceeds 25%. This is likely a prompt/archetype-design issue rather than a model-capability issue; flagged for redesign.

---

## Matrix C — $ per unique idea

The production-economics view. **This is the metric that matters when you scale.** Cost per attempt is a vendor-marketing number; cost per *unique idea that survives downstream filtering* is the real production cost — and it spreads 16× across models that all pass the same quality bar.

| Model | cause_eff | comparison | process_seq | misconception | etymology | estimation | lateral_conn | odd_one_out | vocab_ctx | strategy | **Row Ø** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Claude Opus 4.7** | **$0.63** | **$0.89** | $0.67 | $0.26 | $0.38 | $0.15 | $0.56 | $0.28 | $0.85 | $0.90 | **$0.421** |
| **GPT-5** | **$0.09** | **$0.58** | $0.07 | $0.22 | $0.10 | **$0.05** | $0.12 | **$0.11** | $0.27 | $0.14 | **$0.128** |
| **Gemini 2.5 Pro** | **$0.02** | **$0.04** | $0.04 | **$0.04** | $0.09 | **$0.40** | $0.08 | $0.02 | $0.07 | $0.24 | **$0.062** |
| **DeepSeek V4-Pro** | **$0.07** | $0.03 | **$0.03** | **$0.01** | **$0.04** | **$0.04** | **$0.02** | $0.05 | $1.06 | **$0.16** | **$0.069** |
| **GLM-5.1** | **$0.07** | **$0.23** | **$0.14** | **$0.08** | $0.32 | $0.24 | $0.05 | **$0.06** | ∞ | $0.22 | **$0.125** |
| **Kimi K2.6** | **$0.18** | $0.82 | $0.09 | $0.06 | **$0.25** | $0.18 | $0.13 | $0.81 | $0.84 | $0.22 | **$0.299** |
| **Doubao 2.0 Pro** | $0.10 | $0.03 | $0.08 | $0.05 | $0.03 | ∞ | $0.02 | $0.02 | $0.12 | $0.01 | **$0.034** |
| **Qwen 3.6 Max** | $0.09 | $0.14 | $0.09 | **$0.04** | $0.08 | **$0.07** | **$0.06** | $0.09 | $0.12 | $0.11 | **$0.079** |
| **ERNIE 4.5** | **$0.04** | ∞ | **$0.01** | $0.01 | $0.03 | $0.04 | **$0.01** | **$0.02** | $0.14 | **∞** | **$0.026** |
| **MiniMax M2.7** | $0.06 | **$0.05** | ∞ | $0.07 | $0.02 | $0.06 | $0.07 | ∞ | ∞ | $0.09 | **$0.083** |

**∞** = cell has 0 survivors → infinite cost per unique idea (this combination simply does not produce shippable output, at any budget).

**The 16× spread.** ERNIE 4.5 ships unique ideas at **$0.026 each**; Claude Opus 4.7 at **$0.421 each**. Same prompts, same downstream filtering, same target output. The premium model is 16× more expensive per unique idea than the cheapest model that passes the same quality bar.

**The asymmetry inside Opus.** Opus produces unique ideas in `estimation` for $0.15 and in `comparison` for $0.89 — a 6× internal spread. Even when buying the same premium model, the cell you point it at decides whether you're paying $0.15 or $0.89 for the same kind of output.

---

## Matrix D — Combined view: `surv/gen   $/uniq`

For when you want all three numbers in one cell. Format: `survivors/generations   $/unique_idea`.

| Model | cause_eff | comparison | process_seq | misconception | etymology |
|---|---|---|---|---|---|
| **Claude Opus 4.7** | **4/48** $0.63 | **2/24** $0.89 | 1/12 $0.67 | 6/18 $0.26 | 4/18 $0.38 |
| **GPT-5** | **15/36** $0.09 | **5/23** $0.58 | 10/12 $0.07 | 3/18 $0.22 | 7/18 $0.10 |
| **Gemini 2.5 Pro** | **8/21** $0.02 | **3/21** $0.04 | 7/18 $0.04 | **4/24** $0.04 | 6/18 $0.09 |
| **DeepSeek V4-Pro** | **8/35** $0.07 | 6/13 $0.03 | **14/22** $0.03 | **10/24** $0.01 | **10/24** $0.04 |
| **GLM-5.1** | **10/23** $0.07 | **10/20** $0.23 | **5/21** $0.14 | **12/49** $0.08 | 3/18 $0.32 |
| **Kimi K2.6** | **9/20** $0.18 | 4/15 $0.82 | 5/13 $0.09 | 6/13 $0.06 | **8/21** $0.25 |
| **Doubao 2.0 Pro** | 1/18 $0.10 | 4/12 $0.03 | 1/12 $0.08 | 3/18 $0.05 | 4/12 $0.03 |
| **Qwen 3.6 Max** | 7/18 $0.09 | 6/19 $0.14 | 5/12 $0.09 | **17/24** $0.04 | 6/12 $0.08 |
| **ERNIE 4.5** | **2/23** $0.04 | 0/12 — | **4/24** $0.01 | 4/12 $0.01 | 2/12 $0.03 |
| **MiniMax M2.7** | 2/12 $0.06 | **4/30** $0.05 | 0/12 — | 1/12 $0.07 | 4/12 $0.02 |

| Model | estimation | lateral_conn | odd_one_out | vocab_ctx | strategy |
|---|---|---|---|---|---|
| **Claude Opus 4.7** | 6/12 $0.15 | 3/18 $0.56 | 4/18 $0.28 | 1/12 $0.85 | 1/12 $0.90 |
| **GPT-5** | **18/30** $0.05 | 7/18 $0.12 | **11/22** $0.11 | 2/12 $0.27 | 3/12 $0.14 |
| **Gemini 2.5 Pro** | **1/24** $0.40 | 6/18 $0.08 | 6/18 $0.02 | 2/18 $0.07 | 1/18 $0.24 |
| **DeepSeek V4-Pro** | **11/27** $0.04 | **16/28** $0.02 | 4/16 $0.05 | 2/16 $1.06 | **10/22** $0.16 |
| **GLM-5.1** | 1/17 $0.24 | 11/16 $0.05 | **12/24** $0.06 | 0/15 — | 3/12 $0.22 |
| **Kimi K2.6** | 5/11 $0.18 | 6/14 $0.13 | 7/16 $0.81 | 1/11 $0.84 | 7/18 $0.22 |
| **Doubao 2.0 Pro** | 0/12 — | 6/18 $0.02 | 5/18 $0.02 | 1/12 $0.12 | 4/12 $0.01 |
| **Qwen 3.6 Max** | **13/30** $0.07 | **14/29** $0.06 | 13/18 $0.09 | 3/12 $0.12 | 8/18 $0.11 |
| **ERNIE 4.5** | 1/12 $0.04 | **7/24** $0.01 | **4/30** $0.02 | 1/12 $0.14 | **0/24** — |
| **MiniMax M2.7** | 5/18 $0.06 | 2/12 $0.07 | 0/12 — | 0/18 — | 1/12 $0.09 |

(Split into two side-by-side tables for legibility; same data as Matrices A+B+C combined.)

---

## Matrix E — Avg quality score per cell (proof that "unique" ≠ "low-quality")

The natural critique of "we measured unique ideas as the production-grade signal" is: maybe survival rate is just measuring **quality**, and the dedup stage is irrelevant. So we report the avg `qualityScore` (1–5 scale) of all **surviving** questions in each cell. If quality were the dominant signal in the survival-rate matrix, you'd expect avg-quality to track avg-survival closely. It doesn't.

| Model | cause_eff | comparison | process_seq | misconception | etymology | estimation | lateral_conn | odd_one_out | vocab_ctx | strategy | **Row Ø** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Claude Opus 4.7** | 4.09 | 3.92 | — | 4.38 | 4.00 | 4.00 | 5.00 | 4.17 | 4.00 | 4.00 | **4.17** |
| **GPT-5** | 4.20 | 4.20 | 4.20 | 4.33 | 4.20 | 4.33 | 4.00 | 4.18 | 4.00 | 4.67 | **4.23** |
| **Gemini 2.5 Pro** | 4.12 | 3.67 | 4.00 | 4.50 | 3.67 | 4.00 | 4.17 | 3.83 | 4.00 | 4.00 | **4.00** |
| **DeepSeek V4-Pro** | 4.15 | 4.00 | 4.00 | 4.36 | 3.73 | 4.58 | 4.29 | 4.00 | 4.50 | 4.31 | **4.19** |
| **GLM-5.1** | 4.25 | 4.30 | 4.00 | 4.40 | 3.67 | 4.00 | 4.45 | 3.92 | — | 4.00 | **4.11** |
| **Kimi K2.6** | 4.33 | 4.25 | 4.40 | 4.40 | 4.12 | 4.20 | 4.33 | 4.14 | 4.00 | 4.14 | **4.23** |
| **Doubao 2.0 Pro** | 4.00 | 4.50 | 5.00 | 4.00 | 4.00 | — | 3.83 | 4.00 | 4.00 | 3.75 | **4.12** |
| **Qwen 3.6 Max** | 4.20 | 4.17 | 4.20 | 4.00 | 4.00 | 4.17 | 4.22 | 4.23 | 4.67 | 4.29 | **4.21** |
| **ERNIE 4.5** | 4.50 | — | 4.00 | 3.75 | 3.50 | 4.00 | 4.00 | 4.00 | 4.00 | — | **3.97** |
| **MiniMax M2.7** | 4.50 | 3.75 | — | 4.00 | 4.00 | 4.00 | 4.00 | — | — | 4.00 | **4.04** |
| **Pool Ø** | | | | | | | | | | | **4.13** |

`—` = cell has 0 survivors, so no quality score to average.

**Quality is converged. Survival is not.**

- Row averages range **3.97 (ERNIE) to 4.23 (GPT-5 / Kimi)** — a spread of **0.26 points** on a 5-point scale.
- Compare with Matrix B row averages: **12% (MiniMax) to 47% (Qwen)** — a spread of **35 percentage points**.
- The model with the worst survival rate in the test (MiniMax at 12%) still produces quality-4.04 questions when it does survive. ERNIE at 13% survival is quality-3.97. **The survival rate is measuring something other than quality.**

This is the core load-bearing claim of the entire benchmark: the differentiator between frontier LLMs in production is **default-repertoire depth** (how many distinct ideas before paraphrase collapse), not **quality** (how well-formed the average output is). The two correlate only weakly.

---

## Matrix F — Saturation decay (proof that "running out of ideas" is real)

The static survival rate in Matrix B is the average across all batches each model ran. But the truly diagnostic question is: **does survival rate drop as a model keeps running on the same archetype-mix?** If "default-repertoire collapse" is real, models should show a downward arc over time.

Each model's batches sorted chronologically, then bucketed into first 5 / middle 5 / last 5 by timestamp.

| Model | 1st 5 batches | mid 5 batches | last 5 batches | total batches | Δ first→last |
|---|---|---|---|---:|---:|
| **GPT-5** | **50%** (14/28) | 42% (11/26) | **13%** (4/29) | 36 | **−37 pp** |
| **Qwen 3.6 Max** | **73%** (22/30) | 60% (18/30) | **33%** (10/30) | 33 | **−40 pp** |
| **GLM-5.1** | 39% (9/23) | 26% (4/15) | 13% (3/23) | 52 | **−26 pp** |
| **Doubao 2.0 Pro** | 36% (11/30) | 16% (5/30) | 10% (3/30) | 24 | **−26 pp** |
| **ERNIE 4.5** | 30% (9/30) | 10% (3/30) | 6% (2/30) | 31 | **−24 pp** |
| **Claude Opus 4.7** | 16% (5/30) | 13% (4/30) | 6% (2/30) | 32 | −10 pp |
| **DeepSeek V4-Pro** | 25% (7/27) | 53% (14/26) | 32% (8/25) | 46 | +7 pp |
| **MiniMax M2.7** | 10% (3/30) | 13% (4/30) | 4% (1/24) | 26 | −6 pp |
| Gemini 2.5 Pro † | 0% (0/15) | 40% (12/30) | 6% (2/30) | 38 | (n/a) |
| Kimi K2.6 † | 0% (0/8) | 45% (5/11) | 37% (11/29) | 48 | (n/a) |

**The clean cases — 7 of 10 models show clear default-repertoire-collapse decay over time:**

- **Qwen and GPT-5 have the most dramatic arcs** (−40 pp, −37 pp). Both started near 70% / 50% survival and ended near 33% / 13%. The strongest evidence in this dataset that even high-depth models exhaust their distinct ideas at the (seed × archetype) cell level.
- **GLM-5.1, Doubao, ERNIE** all decay −24 pp to −26 pp — the prototypical saturation curve.
- **Opus 4.7 only drops −10 pp because it already started at 16%** — there's not far to fall. Its default repertoire collapsed before the experiment began.
- **DeepSeek V4-Pro is the only model that did NOT decay** (+7 pp). It is also the workhorse with the broadest seed coverage (227 generations). Likely explanation: DeepSeek's deeper default repertoire kept rotating through the pipeline's freshly-injected AI-discovered seeds (`sci_tech_myths`, `pop_music_pop`, `tech_security_pop`) where it has top contribution. The seed-evolver "freshening" trick works for models with deep default repertoires.
- **MiniMax** never had room to decay — its first-batch survival was already 10%.

**The two anomalies (†):**

- **Gemini 2.5 Pro** was introduced May 12 (after Vertex `gemini-3.1-pro-preview` access ended). Its first 5 batches scored 0% survival — they were "cold start" batches during initial prompt-tuning. After warmup it climbed to 40%, then saturated to 6%. The decay arc is real (40 → 6 = −34 pp) but the "first batch" baseline isn't comparable to models that ran for 14 days.
- **Kimi K2.6** started 0% because of an early model-id misconfiguration. Once fixed, it produced 45% in mid-experiment then ended at 37% — a milder decay.

### Global pooled curve (all 366 batches across the 10 models, binned)

| Bucket (chronological) | Batches | Survival % |
|---|---:|---:|
| 1 (oldest) | 45 | **35%** |
| 2 | 46 | 22% |
| 3 | 46 | 33% |
| 4 | 46 | 30% |
| 5 | 45 | 29% |
| 6 | 46 | **35%** |
| 7 | 46 | 23% |
| 8 (newest) | 46 | **21%** |

The pooled curve isn't monotonic because **seed-evolver injections in early May refreshed the canon mid-experiment** (the bucket-6 spike to 35% coincides with the AI-discovered seed batch). But the trend from bucket-1 (35%) to bucket-8 (21%) is a **−14 percentage point global drop** — exactly the trajectory you'd expect when each successive batch competes against a larger dedup pool.

---

## Methodology — what survival rate measures vs what it doesn't

**Survival rate = (questions kept after dedup) / (questions generated)**. The pipeline drops questions for three reasons, in this order:

1. **Quality reject** (~25% of generated, varies by archetype): the question violates structural rules (length-tells, non-defeatable distractors, archetype-specific rule failures, Wikipedia-extractable trivia, no reasoning hook). This measures *craftsmanship*, not default-repertoire depth.
2. **Verification fail** (~5%): the web-grounded fact check disagreed with the AI's correct answer. This is rare and noise-dominated; not a default-repertoire-depth signal.
3. **Dedup reject** (~30–40% of generated): cosine similarity ≥ 0.84 against the pool OR within-batch. **This is the default-repertoire-depth signal.** A question rejected here is one the AI already produced in a different phrasing.

The survival rate above conflates (1) + (3), which is what makes it a proxy rather than a pure measure. Matrix E (quality scores per cell) is the diagnostic that separates the two: if survival were dominated by quality, the quality scores per cell would correlate with survival. They don't. Quality across models is ±0.26 of 5.0; survival is ±35 percentage points.

### Confidence tiers (used throughout)

| Tier | Sample size | Reliability |
|---|---|---|
| **High** | ≥20 generations | Stable to ±5%. 42 cells qualify. |
| **Medium** | 10–19 generations | Stable to ±15%. Useful for direction, not absolute claims. 58 cells qualify. |
| **Below floor** | <10 generations | Excluded from the headline matrix by construction. |

When the post or repo cites a number from this matrix, the underlying tier should always be checked.

### What we'd do next

1. **Separate dedup-only survival from quality-only survival** in the run logs. The data exists per batch but isn't currently aggregated this way; would isolate the default-repertoire-depth signal from the craftsmanship signal cleanly.
2. **Inter-model default-repertoire overlap.** Compare embedding clusters of two models' outputs on the same cell to get a real Jaccard score — would directly quantify the "different models have different default repertoires" claim.
3. **Pinned-cell controlled runs.** Hold the seed fixed, run each model 30 times in a row, log batch-by-batch survival. Cost: ~$3 per cell × 100 cells = $300 for a complete default-repertoire-depth atlas at higher confidence.

---

## Appendix — models excluded from the headline matrix

These models were tested but did not meet the ≥10-attempts-per-archetype floor across all 10 archetypes. Their data is retained in `data/auto-runs/` and the raw `provider-archetype-stats.json`, but is not part of the headline default-repertoire-depth claims.

| Model | Reason for exclusion | Total attempts |
|---|---|---:|
| `google \| gemini-3.1-pro-preview` (Vertex) | API access ended mid-month before 3 archetypes (etymology, process_sequence, vocab_context) reached the floor. Replaced by `gemini-2.5-pro` via AI Studio. | 262 |
| `deepseek \| deepseek-chat` (pre-V4-Pro) | Legacy variant before the V4-Pro upgrade; 7 of 10 cells under the floor. | 98 |
| `bytedance-seed/seed-1.6` (OpenRouter route to Doubao) | Only 4 cells touched at all; 6 cells empty. | 30 |
| `minimax/minimax-m2.7-20260318` (snapshot) | Dated snapshot superseded by the unpinned `minimax-m2.7` id. | 29 |
| `google \| gemini-2.5-flash` | Configured but barely rotated (5 cells touched, all <4 attempts). | 12 |
| `baidu/ernie-4.5-21b-a3b-thinking` | Configured but never produced output in any cell. | 0 |
| `byteplus \| doubao-seed-2-0-pro` (direct, not `260328`) | Configured but never produced output — superseded by the dated `seed-2-0-pro-260328` model id. | 0 |

---

*Generated 2026-05-13 from `data/finalized-pool.jsonl` (802 questions total, **586 in the 10-model headline scope**) and `data/auto-runs/*/run.log.jsonl` (24 logged runs, 366 batches in the 10-model scope). Reproducible via `node analyze-all.mjs` followed by `node compute-ideas-matrix.mjs`.*
