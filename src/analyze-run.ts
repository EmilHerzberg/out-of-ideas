import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Standard post-run report generator. Reads an auto-generate run directory
 * (`data/auto-runs/<ts>/`) and produces `report.md` with the per-provider
 * spend, per-category cost-degradation trajectories, per-seed cost bands,
 * and switch-threshold flags — i.e. all the analytical views we'd otherwise
 * compute ad-hoc per run.
 *
 * Called automatically at the end of every `auto-generate` run; can also be
 * re-run manually via `npm run cli -- analyze-run <path>`.
 */

interface BatchLogLine {
  ts: string;
  batchIdx: number;
  triple: { category: string; archetype: string; provider: string; model: string };
  generation: { requested: number; succeeded: number; parseFailures: number; cost: number };
  quality: { keep: number; review: number; reject: number; avgFun: number | null; avgQual: number | null; avgLearning: number | null; cost: number };
  verify: { passed: number; failed: number; cost: number };
  embed: { count: number; cost: number };
  dedup: { autoReject: number; rejectLog: number; flagReview: number; related: number; unique: number; vsPool: number; vsBatch: number };
  appended: number;
  cumulativeCost: number;
  cumulativeSurvivors: number;
  poolSizeAfter: number;
  durationMs: number;
}

interface SummaryShape {
  startedAt: string;
  endedAt: string;
  durationMs: number;
  config: Record<string, unknown>;
  totals: {
    batchesRun: number;
    questionsGenerated: number;
    questionsSurvived: number;
    totalCost: number;
    poolSizeStart: number;
    poolSizeEnd: number;
  };
  stopReason: string;
}

export async function analyzeRun(runDir: string): Promise<{ reportPath: string }> {
  const logPath = path.join(runDir, 'run.log.jsonl');
  const summaryPath = path.join(runDir, 'summary.json');
  if (!existsSync(logPath)) {
    throw new Error(`Not a run directory (missing run.log.jsonl): ${runDir}`);
  }

  const lines = (await readFile(logPath, 'utf8')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as BatchLogLine);

  // If summary.json doesn't exist (run was interrupted or hasn't finished),
  // synthesize a partial summary from the run-log entries so the report can
  // still produce its tables.
  let summary: SummaryShape;
  if (existsSync(summaryPath)) {
    summary = JSON.parse(await readFile(summaryPath, 'utf8')) as SummaryShape;
  } else {
    const totalGenerated = lines.reduce((a, l) => a + l.generation.succeeded, 0);
    const totalSurvived = lines.reduce((a, l) => a + l.appended, 0);
    const totalCost = lines.reduce(
      (a, l) => a + l.generation.cost + l.quality.cost + l.verify.cost + l.embed.cost,
      0,
    );
    const last = lines[lines.length - 1];
    const first = lines[0];
    summary = {
      startedAt: first?.ts ?? '(unknown)',
      endedAt: last?.ts ?? '(unknown — run incomplete)',
      durationMs: first && last ? new Date(last.ts).getTime() - new Date(first.ts).getTime() : 0,
      config: {},
      totals: {
        batchesRun: lines.length,
        questionsGenerated: totalGenerated,
        questionsSurvived: totalSurvived,
        totalCost,
        poolSizeStart: 0,
        poolSizeEnd: last?.poolSizeAfter ?? 0,
      },
      stopReason: 'INTERRUPTED (no summary.json — partial-run analysis)',
    };
  }

  const md: string[] = [];
  md.push(`# Run report — ${path.basename(runDir)}`);
  md.push('');
  md.push(`Started: ${summary.startedAt}`);
  md.push(`Ended:   ${summary.endedAt}`);
  md.push(`Duration: ${(summary.durationMs / 60000).toFixed(1)} min`);
  md.push(`Stop reason: \`${summary.stopReason}\``);
  md.push('');

  // ----- Headline -----------------------------------------------------------
  md.push(`## Headline`);
  md.push('');
  md.push('| Metric | Value |');
  md.push('|---|---|');
  md.push(`| Batches run | ${summary.totals.batchesRun} |`);
  md.push(`| Questions generated | ${summary.totals.questionsGenerated} |`);
  md.push(`| Survivors | **${summary.totals.questionsSurvived}** |`);
  md.push(`| Overall survival | ${((summary.totals.questionsSurvived / Math.max(1, summary.totals.questionsGenerated)) * 100).toFixed(1)}% |`);
  md.push(`| Total cost | **$${summary.totals.totalCost.toFixed(4)}** |`);
  md.push(`| $/survivor | $${(summary.totals.totalCost / Math.max(1, summary.totals.questionsSurvived)).toFixed(4)} |`);
  md.push(`| Pool growth | ${summary.totals.poolSizeStart} → ${summary.totals.poolSizeEnd} |`);
  md.push('');

  // ----- Per-provider spend ------------------------------------------------
  type ProvStats = { batches: number; gen: number; kept: number; genCost: number; qualCost: number; verifyCost: number; embedCost: number; sumFun: number; sumQual: number; n: number };
  const byProv: Record<string, ProvStats> = {};
  for (const l of lines) {
    const p = l.triple.provider;
    if (!byProv[p]) byProv[p] = { batches: 0, gen: 0, kept: 0, genCost: 0, qualCost: 0, verifyCost: 0, embedCost: 0, sumFun: 0, sumQual: 0, n: 0 };
    byProv[p].batches++;
    byProv[p].gen += l.generation.succeeded;
    byProv[p].kept += l.appended;
    byProv[p].genCost += l.generation.cost;
    byProv[p].qualCost += l.quality.cost;
    byProv[p].verifyCost += l.verify.cost;
    byProv[p].embedCost += l.embed.cost;
    if (l.quality.avgFun != null) {
      byProv[p].sumFun += l.quality.avgFun;
      byProv[p].sumQual += l.quality.avgQual ?? 0;
      byProv[p].n++;
    }
  }

  md.push(`## Per-provider spend`);
  md.push('');
  md.push('| Provider | Batches | Gen | Kept | Surv% | Avg fun | Avg qual | Gen cost | $/gen-q | **$/survivor** |');
  md.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const [p, s] of Object.entries(byProv).sort((a, b) => b[1].kept - a[1].kept)) {
    const surv = s.gen > 0 ? Math.round((100 * s.kept) / s.gen) : 0;
    const fun = s.n > 0 ? (s.sumFun / s.n).toFixed(2) : '—';
    const qual = s.n > 0 ? (s.sumQual / s.n).toFixed(2) : '—';
    const dollarPerGen = s.gen > 0 ? `$${(s.genCost / s.gen).toFixed(5)}` : '—';
    const dollarPerSurv = s.kept > 0 ? `$${(s.genCost / s.kept).toFixed(4)}` : '∞';
    md.push(`| **${p}** | ${s.batches} | ${s.gen} | ${s.kept} | ${surv}% | ${fun} | ${qual} | $${s.genCost.toFixed(4)} | ${dollarPerGen} | **${dollarPerSurv}** |`);
  }
  md.push('');

  // Stage costs (verify + quality + embed are typically single-provider)
  let totalQuality = 0, totalVerify = 0, totalEmbed = 0;
  for (const s of Object.values(byProv)) {
    totalQuality += s.qualCost;
    totalVerify += s.verifyCost;
    totalEmbed += s.embedCost;
  }
  md.push(`### Stage costs (non-generation)`);
  md.push('');
  md.push(`- Quality: $${totalQuality.toFixed(4)}`);
  md.push(`- Verify:  $${totalVerify.toFixed(4)}`);
  md.push(`- Embed:   $${totalEmbed.toFixed(4)}`);
  md.push('');

  // ----- Per-category cost trajectory -------------------------------------
  md.push(`## Per-category cost trajectory`);
  md.push('');
  md.push('Cumulative $/survivor across batches in each category. Saturation onset = batch where the rolling cost crosses ~$0.10 and keeps climbing.');
  md.push('');

  type CatRow = { batchInCat: number; gen: number; kept: number; cost: number; survRate: number; dPerSurv: number | null };
  const cumCat: Record<string, { gen: number; kept: number; cost: number; batchN: number }> = {};
  const catTrace: Record<string, CatRow[]> = {};
  for (const l of lines) {
    const c = l.triple.category;
    if (!cumCat[c]) cumCat[c] = { gen: 0, kept: 0, cost: 0, batchN: 0 };
    cumCat[c].batchN++;
    cumCat[c].gen += l.generation.succeeded;
    cumCat[c].kept += l.appended;
    cumCat[c].cost += l.generation.cost + l.quality.cost + l.verify.cost + l.embed.cost;
    if (!catTrace[c]) catTrace[c] = [];
    catTrace[c].push({
      batchInCat: cumCat[c].batchN,
      gen: cumCat[c].gen,
      kept: cumCat[c].kept,
      cost: cumCat[c].cost,
      survRate: cumCat[c].gen > 0 ? cumCat[c].kept / cumCat[c].gen : 0,
      dPerSurv: cumCat[c].kept > 0 ? cumCat[c].cost / cumCat[c].kept : null,
    });
  }
  for (const c of Object.keys(catTrace).sort()) {
    md.push(`### ${c} (${catTrace[c].length} batches)`);
    md.push('');
    md.push('| Batch # | Cum gen | Cum kept | Surv% | Cum cost | $/survivor |');
    md.push('|---|---|---|---|---|---|');
    for (const r of catTrace[c]) {
      md.push(`| ${r.batchInCat} | ${r.gen} | ${r.kept} | ${(r.survRate * 100).toFixed(0)}% | $${r.cost.toFixed(3)} | ${r.dPerSurv ? `$${r.dPerSurv.toFixed(3)}` : '—'} |`);
    }
    md.push('');
  }

  // ----- Per-seed cost bands ---------------------------------------------
  md.push(`## Per-seed cost bands`);
  md.push('');
  md.push('Per-seed $/survivor (cost split evenly across the seeds used in each batch).');
  md.push('');

  type SeedStats = { gen: number; kept: number; cost: number };
  const seedStats: Record<string, SeedStats> = {};
  for (const l of lines) {
    const idx = String(l.batchIdx).padStart(3, '0');
    const genFile = path.join(runDir, `batch-${idx}`, 'generated.jsonl');
    const dedupFile = path.join(runDir, `batch-${idx}`, 'dedup.json');
    if (!existsSync(genFile)) continue;
    const generated = (await readFile(genFile, 'utf8')).trim().split('\n').filter(Boolean).map((x) => JSON.parse(x));
    if (generated.length === 0) continue;
    const batchCost = l.generation.cost + l.quality.cost + l.verify.cost + l.embed.cost;
    const perQCost = batchCost / generated.length;

    let survivorIds = new Set<string>();
    if (existsSync(dedupFile)) {
      try {
        const d = JSON.parse(await readFile(dedupFile, 'utf8')) as { records: Array<{ questionId: string; decision: string }> };
        survivorIds = new Set(d.records.filter((r) => r.decision === 'unique' || r.decision === 'related').map((r) => r.questionId));
      } catch { /* ignore */ }
    }
    for (const q of generated) {
      const seedId = (q as { seedId?: string }).seedId;
      if (!seedId) continue;
      if (!seedStats[seedId]) seedStats[seedId] = { gen: 0, kept: 0, cost: 0 };
      seedStats[seedId].gen++;
      seedStats[seedId].cost += perQCost;
      if (survivorIds.has((q as { id: string }).id)) seedStats[seedId].kept++;
    }
  }

  type SeedView = { id: string; gen: number; kept: number; cost: number; dPerSurv: number };
  const seedArr: SeedView[] = Object.entries(seedStats).map(([id, s]) => ({
    id,
    gen: s.gen,
    kept: s.kept,
    cost: s.cost,
    dPerSurv: s.kept > 0 ? s.cost / s.kept : Infinity,
  }));

  // Bucket by band
  const bands = {
    PRODUCTIVE: seedArr.filter((s) => s.dPerSurv >= 0 && s.dPerSurv <= 0.10),
    WARNING: seedArr.filter((s) => s.dPerSurv > 0.10 && s.dPerSurv <= 0.20),
    SATURATED: seedArr.filter((s) => s.dPerSurv > 0.20 && s.dPerSurv <= 0.30),
    EXPENSIVE: seedArr.filter((s) => s.dPerSurv > 0.30 && isFinite(s.dPerSurv)),
    DEAD: seedArr.filter((s) => !isFinite(s.dPerSurv)),
  };

  for (const [band, items] of Object.entries(bands)) {
    if (items.length === 0) continue;
    const desc: Record<string, string> = {
      PRODUCTIVE: '$0.04–$0.10/surv — keep using',
      WARNING: '$0.10–$0.20/surv — saturation onset',
      SATURATED: '$0.20–$0.30/surv — diminishing returns',
      EXPENSIVE: '> $0.30/surv — switch the seed',
      DEAD: '∞ — zero survivors',
    };
    md.push(`### ${band} — ${desc[band]}`);
    md.push('');
    md.push('| Seed | Gen | Kept | Surv% | $/surv |');
    md.push('|---|---|---|---|---|');
    items.sort((a, b) => a.dPerSurv - b.dPerSurv).forEach((s) => {
      const surv = s.gen > 0 ? Math.round((100 * s.kept) / s.gen) : 0;
      const dps = isFinite(s.dPerSurv) ? `$${s.dPerSurv.toFixed(3)}` : '∞';
      md.push(`| ${s.id} | ${s.gen} | ${s.kept} | ${surv}% | ${dps} |`);
    });
    md.push('');
  }

  // ----- Threshold flags --------------------------------------------------
  md.push(`## Switch-threshold flags`);
  md.push('');
  md.push('Categories that crossed the **Yellow** threshold (rolling $/survivor > $0.15) and the **Orange** threshold (> $0.30) at any point during the run:');
  md.push('');
  md.push('| Category | Final $/surv | Yellow? | Orange? |');
  md.push('|---|---|---|---|');
  for (const c of Object.keys(catTrace).sort()) {
    const last = catTrace[c][catTrace[c].length - 1];
    const dPerSurv = last.dPerSurv;
    if (dPerSurv == null) {
      md.push(`| ${c} | — (no survivors) | — | — |`);
      continue;
    }
    const yellow = dPerSurv > 0.15 ? 'YES' : 'no';
    const orange = dPerSurv > 0.30 ? 'YES' : 'no';
    md.push(`| ${c} | $${dPerSurv.toFixed(3)} | ${yellow} | ${orange} |`);
  }
  md.push('');

  // ----- Bug surface ------------------------------------------------------
  const parseFails = lines.reduce((a, l) => a + l.generation.parseFailures, 0);
  const errorEvents = summary.totals.questionsGenerated > 0 ?
    `${parseFails} generation parse failures across ${summary.totals.questionsGenerated} attempts (${((parseFails / Math.max(1, parseFails + summary.totals.questionsGenerated)) * 100).toFixed(1)}%)` :
    'n/a';
  md.push(`## Bug surface`);
  md.push('');
  md.push(`- Generation parse failures: ${errorEvents}`);
  md.push('');

  const reportPath = path.join(runDir, 'report.md');
  await writeFile(reportPath, md.join('\n'), 'utf8');
  return { reportPath };
}
