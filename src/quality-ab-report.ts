import path from 'node:path';
import { existsSync } from 'node:fs';
import { readJsonl } from './utils/jsonl.js';
import type { Question, QualityDecision } from './schema.js';

/**
 * Read a quality.jsonl (or any JSONL of question records that carry both
 * `qualityAssessment` and `qualityAssessmentAlt`) and produce a confusion
 * matrix telling us how often the alt model agrees with the primary.
 *
 * Used to evaluate whether DEEPSEEK_QUALITY_MODEL=deepseek-v4-pro (current
 * default, ~6× cost vs flash) is producing meaningfully different
 * decisions than deepseek-chat (V4-Flash). If the alt agrees on >95% of
 * decisions, V4-Flash is sufficient and we can revert to save cost.
 */

interface CellSummary {
  decisionMatrix: Record<QualityDecision, Record<QualityDecision, number>>;
  totalAssessed: number;
  totalWithAlt: number;
  agreementRate: number; // decision-level agreement
  primaryQualScoreSum: number;
  primaryQualScoreCount: number;
  altQualScoreSum: number;
  altQualScoreCount: number;
  primaryFunScoreSum: number;
  primaryFunScoreCount: number;
  altFunScoreSum: number;
  altFunScoreCount: number;
  /** Per-archetype agreement breakdown — useful for spotting "alt is fine on
   *  cause_effect but disagrees often on misconception" patterns. */
  byArchetype: Record<string, { total: number; agree: number; primaryRejects: number; altRejects: number }>;
  primaryModel: string | null;
  altModel: string | null;
  /** Sample of disagreement cases for human eyeballing. */
  disagreementSample: Array<{ id: string; archetype: string; question: string; primaryDecision: QualityDecision; altDecision: QualityDecision; primaryReason?: string; altReason?: string }>;
}

const EMPTY_DECISION_MATRIX = (): Record<QualityDecision, Record<QualityDecision, number>> => ({
  keep: { keep: 0, review: 0, reject: 0 },
  review: { keep: 0, review: 0, reject: 0 },
  reject: { keep: 0, review: 0, reject: 0 },
});

export async function buildAbReport(qualityJsonlPath: string, sampleLimit = 12): Promise<CellSummary> {
  const decisionMatrix = EMPTY_DECISION_MATRIX();
  let totalAssessed = 0;
  let totalWithAlt = 0;
  let primaryQualScoreSum = 0;
  let primaryQualScoreCount = 0;
  let altQualScoreSum = 0;
  let altQualScoreCount = 0;
  let primaryFunScoreSum = 0;
  let primaryFunScoreCount = 0;
  let altFunScoreSum = 0;
  let altFunScoreCount = 0;
  const byArchetype: CellSummary['byArchetype'] = {};
  const disagreementSample: CellSummary['disagreementSample'] = [];
  let primaryModel: string | null = null;
  let altModel: string | null = null;

  if (!existsSync(qualityJsonlPath)) {
    throw new Error(`Quality JSONL not found: ${qualityJsonlPath}`);
  }

  for await (const q of readJsonl<Question>(qualityJsonlPath)) {
    const primary = q.qualityAssessment;
    const alt = q.qualityAssessmentAlt;
    if (!primary) continue;
    totalAssessed += 1;

    primaryQualScoreSum += primary.qualityScore;
    primaryQualScoreCount += 1;
    primaryFunScoreSum += primary.funScore;
    primaryFunScoreCount += 1;

    if (!alt) continue;
    totalWithAlt += 1;
    altModel = altModel ?? q.qualityAltModel ?? null;
    primaryModel = primaryModel ?? q.qualityProvider ?? null;

    altQualScoreSum += alt.qualityScore;
    altQualScoreCount += 1;
    altFunScoreSum += alt.funScore;
    altFunScoreCount += 1;

    decisionMatrix[primary.decision][alt.decision] += 1;

    const arch = q.archetype ?? 'unknown';
    const a = byArchetype[arch] ?? { total: 0, agree: 0, primaryRejects: 0, altRejects: 0 };
    a.total += 1;
    if (primary.decision === alt.decision) a.agree += 1;
    if (primary.decision === 'reject') a.primaryRejects += 1;
    if (alt.decision === 'reject') a.altRejects += 1;
    byArchetype[arch] = a;

    if (primary.decision !== alt.decision && disagreementSample.length < sampleLimit) {
      disagreementSample.push({
        id: q.id,
        archetype: arch,
        question: q.question.slice(0, 120),
        primaryDecision: primary.decision,
        altDecision: alt.decision,
        primaryReason: primary.reasoning?.slice(0, 200),
        altReason: alt.reasoning?.slice(0, 200),
      });
    }
  }

  let agreed = 0;
  let totalDecisionPairs = 0;
  for (const p of ['keep', 'review', 'reject'] as const) {
    for (const a of ['keep', 'review', 'reject'] as const) {
      const n = decisionMatrix[p][a];
      totalDecisionPairs += n;
      if (p === a) agreed += n;
    }
  }

  return {
    decisionMatrix,
    totalAssessed,
    totalWithAlt,
    agreementRate: totalDecisionPairs > 0 ? agreed / totalDecisionPairs : 0,
    primaryQualScoreSum,
    primaryQualScoreCount,
    altQualScoreSum,
    altQualScoreCount,
    primaryFunScoreSum,
    primaryFunScoreCount,
    altFunScoreSum,
    altFunScoreCount,
    byArchetype,
    primaryModel,
    altModel,
    disagreementSample,
  };
}

export function formatAbReport(s: CellSummary, sourcePath: string): string {
  const lines: string[] = [];
  lines.push(`# Quality A/B report — ${path.basename(sourcePath)}`);
  lines.push('');
  lines.push(`Primary model: ${s.primaryModel ?? '(unknown)'}`);
  lines.push(`Alt model:     ${s.altModel ?? '(no alt assessments found)'}`);
  lines.push('');
  lines.push(`Total questions assessed by primary: ${s.totalAssessed}`);
  lines.push(`Of those, also assessed by alt:      ${s.totalWithAlt}`);
  lines.push('');
  if (s.totalWithAlt === 0) {
    lines.push('No A/B data found. Did you pass `--quality-alt-model <name>` on the run?');
    return lines.join('\n');
  }
  lines.push(`**Decision-level agreement: ${(s.agreementRate * 100).toFixed(1)}%** (${s.totalWithAlt} pairs)`);
  lines.push('');
  lines.push('## Confusion matrix (rows=primary, cols=alt)');
  lines.push('');
  lines.push('| primary \\ alt | keep | review | reject |');
  lines.push('|---|---:|---:|---:|');
  for (const p of ['keep', 'review', 'reject'] as const) {
    const r = s.decisionMatrix[p];
    lines.push(`| ${p} | ${r.keep} | ${r.review} | ${r.reject} |`);
  }
  lines.push('');
  if (s.primaryQualScoreCount > 0 && s.altQualScoreCount > 0) {
    const pq = s.primaryQualScoreSum / s.primaryQualScoreCount;
    const aq = s.altQualScoreSum / s.altQualScoreCount;
    const pf = s.primaryFunScoreSum / s.primaryFunScoreCount;
    const af = s.altFunScoreSum / s.altFunScoreCount;
    lines.push(`## Score averages`);
    lines.push('');
    lines.push(`| Metric | primary | alt | Δ |`);
    lines.push('|---|---:|---:|---:|');
    lines.push(`| qualityScore | ${pq.toFixed(2)} | ${aq.toFixed(2)} | ${(aq - pq).toFixed(2)} |`);
    lines.push(`| funScore     | ${pf.toFixed(2)} | ${af.toFixed(2)} | ${(af - pf).toFixed(2)} |`);
    lines.push('');
  }
  lines.push('## Per-archetype agreement');
  lines.push('');
  lines.push(`| Archetype | n | agree | agree% | primary-reject | alt-reject |`);
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const [arch, a] of Object.entries(s.byArchetype).sort()) {
    const ar = a.total > 0 ? (a.agree / a.total) * 100 : 0;
    lines.push(`| ${arch} | ${a.total} | ${a.agree} | ${ar.toFixed(0)}% | ${a.primaryRejects} | ${a.altRejects} |`);
  }
  lines.push('');
  if (s.disagreementSample.length > 0) {
    lines.push('## Sample disagreements');
    lines.push('');
    for (const d of s.disagreementSample) {
      lines.push(`- **${d.archetype}** | primary=${d.primaryDecision}, alt=${d.altDecision}`);
      lines.push(`  Q: ${d.question}`);
      if (d.primaryReason) lines.push(`  primary: ${d.primaryReason}`);
      if (d.altReason) lines.push(`  alt:     ${d.altReason}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}
