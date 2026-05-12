# Sample questions

`sample-questions.jsonl` contains **100 production-grade quiz questions** sampled from the full 618-question pool. Diverse across all 10 categories, 10 of 12 archetypes, and 9 frontier LLM providers.

## Coverage

| Category | Count | Archetype | Count | Provider | Count |
|---|---:|---|---:|---|---:|
| History | 19 | cause_effect | 21 | deepseek (V4-Pro) | 38 |
| Science | 17 | misconception | 19 | google (Gemini 3.1 Pro) | 31 |
| Tech | 13 | lateral_connection | 18 | openrouter-qwen (Qwen 3.6 Max) | 11 |
| Sports | 11 | comparison | 12 | anthropic (Opus 4.7) | 9 |
| Pop Culture | 8 | strategy | 10 | zai (GLM-5.1) | 4 |
| Food & Drink | 7 | odd_one_out | 9 | openai (GPT-5) | 3 |
| General | 7 | estimation | 7 | openrouter-ernie (4.5-300b) | 2 |
| Geography | 6 | process_sequence | 2 | openrouter-minimax (M2.7) | 1 |
| Arts | 6 | vocab_context | 1 | moonshot (Kimi K2.6) | 1 |
| Language | 6 | etymology | 1 | | |

**Quality averages (1-5 scale):** Fun 4.11 · Quality 4.67 · Learning 4.15

These are top-quality survivors — every question passed all six pipeline stages including web-grounded fact verification and embedding-based deduplication against the full pool.

## Schema (per question)

```json
{
  "id": "uuid",
  "question": "string, ≤150 chars",
  "answers": ["≤60 chars", "≤60 chars", "≤60 chars", "≤60 chars"],
  "correctIndex": 0|1|2|3,
  "category": "Science | History | Geography | Pop Culture | Sports | Language | Tech | Food & Drink | Arts | General",
  "subcategory": "narrower topic (optional)",
  "archetype": "cause_effect | comparison | misconception | …",
  "difficulty": "easy | medium | hard",
  "explanation": "≤30 words, teaches the REASON",
  "tags": ["3-7 lowercase keywords"],
  "generationProvider": "anthropic | openai | google | deepseek | …",
  "generationModel": "exact model id (e.g. claude-opus-4-7, gpt-5)",
  "seedId": "sub-topic seed that steered generation",
  "qualityAssessment": {
    "accessibilityTier": "beginner | enthusiast | specialist",
    "funScore": 1-5,
    "qualityScore": 1-5,
    "learningValue": 1-5,
    "decision": "keep | review | reject",
    "reasoning": "1-2 sentences"
  },
  "verificationStatus": "passed | failed"
}
```

The 768-dimensional embedding vector is **stripped from the samples** for readability — the embedding-based dedup happens during pipeline execution and isn't needed downstream.

## Browsing

JSONL is one question per line. Quick peek with any of:

```bash
# Pretty-print the first question
head -1 sample-questions.jsonl | jq

# Pick a random question
shuf -n 1 sample-questions.jsonl | jq

# All History questions
grep '"category":"History"' sample-questions.jsonl | jq

# All questions from Claude Opus 4.7
grep '"generationProvider":"anthropic"' sample-questions.jsonl | jq
```

## What this sample is NOT

- **Not the full pool.** The full 618-question pool plus all 17 orchestrator run logs stay private. This sample is a curated cross-section for demonstration.
- **Not a benchmark dataset.** For benchmark claims see `docs/IDEAS_MATRIX.md` and `docs/ANALYSIS.md`. The numbers there are computed over the full pool + run logs, not this 100-question subset.
- **Not bias-corrected.** The provider distribution reflects which providers contributed the most high-quality survivors to the pool — not equal representation. DeepSeek V4-Pro and Google Gemini 3.1 Pro dominate because they're the cheapest providers with the highest survival rates.

---

*These samples are part of the **out-of-ideas** project, copyright (c) 2026 Emil Herzberg and Anton Herzberg. Licensed under [Apache-2.0](../LICENSE).*
