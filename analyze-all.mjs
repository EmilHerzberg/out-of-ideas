#!/usr/bin/env node
// One-shot analyzer: pool + all auto-runs → consolidated stats.
// Run from the repo root: `node analyze-all.mjs`
// Reads from ./data/ (gitignored — populated by running the pipeline locally).
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const POOL = join(ROOT, 'data/finalized-pool.jsonl');
const RUNS_DIR = join(ROOT, 'data/auto-runs');
const SEEDS = join(ROOT, 'seeds/seeds.jsonl');

if (!existsSync(POOL)) {
  console.error(`ERROR: ${POOL} not found.`);
  console.error('Run the pipeline first to generate data/ — e.g.:');
  console.error('  npm run cli -- auto-generate --target 50 --budget 5');
  process.exit(1);
}

// ---------- 1. POOL ANALYSIS ----------
const poolLines = readFileSync(POOL, 'utf8').trim().split('\n');
const pool = poolLines.map(l => JSON.parse(l));

const byProvider = {};
const byProviderModel = {};
const byCategory = {};
const byArchetype = {};
const bySeed = {};
const byProviderArchetype = {};
const byProviderSeed = {};

function bump(map, key) {
  if (!map[key]) map[key] = { count: 0, fun: [], qual: [], learn: [] };
  map[key].count++;
}
function bumpScores(map, key, q) {
  if (!map[key]) map[key] = { count: 0, fun: [], qual: [], learn: [] };
  map[key].count++;
  if (q.qualityAssessment) {
    map[key].fun.push(q.qualityAssessment.funScore);
    map[key].qual.push(q.qualityAssessment.qualityScore);
    map[key].learn.push(q.qualityAssessment.learningValue);
  }
}

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

for (const q of pool) {
  const p = q.generationProvider || 'unknown';
  const m = q.generationModel || 'unknown';
  bumpScores(byProvider, p, q);
  bumpScores(byProviderModel, `${p}|${m}`, q);
  bumpScores(byCategory, q.category || 'unknown', q);
  bumpScores(byArchetype, q.archetype || 'unknown', q);
  bumpScores(bySeed, q.seedId || 'no-seed', q);
  bumpScores(byProviderArchetype, `${p}|${q.archetype}`, q);
  bumpScores(byProviderSeed, `${p}|${q.seedId}`, q);
}

// ---------- 2. AUTO-RUNS ANALYSIS ----------
const runs = readdirSync(RUNS_DIR).filter(d => d.startsWith('2026')).sort();
const runSummaries = [];
const providerRunStats = {};  // provider → {gen, surv, cost, batches}
const providerArchetypeRunStats = {};
const categoryRunStats = {};
let totalRuns = 0, totalBatches = 0, totalGenerated = 0, totalSurvived = 0, totalCost = 0;

function ensure(map, key, init = { gen: 0, surv: 0, cost: 0, batches: 0 }) {
  if (!map[key]) map[key] = { ...init };
  return map[key];
}

for (const runId of runs) {
  const runDir = join(RUNS_DIR, runId);
  const logPath = join(runDir, 'run.log.jsonl');
  const summaryPath = join(runDir, 'summary.json');
  if (!existsSync(logPath)) continue;

  totalRuns++;
  const lines = readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
  let runGen = 0, runSurv = 0, runCost = 0, runBatches = 0;
  const runProviders = {};

  for (const line of lines) {
    let b;
    try { b = JSON.parse(line); } catch { continue; }
    if (!b.triple) continue;
    runBatches++;
    const provider = b.triple.provider;
    const archetype = b.triple.archetype;
    const category = b.triple.category;
    const gen = b.generation?.succeeded ?? 0;
    const surv = b.appended ?? 0;
    const cost = (b.generation?.cost ?? 0) + (b.quality?.cost ?? 0) + (b.verify?.cost ?? 0) + (b.embed?.cost ?? 0);

    runGen += gen;
    runSurv += surv;
    runCost += cost;

    const p = ensure(providerRunStats, provider);
    p.gen += gen; p.surv += surv; p.cost += cost; p.batches++;

    const pa = ensure(providerArchetypeRunStats, `${provider}|${archetype}`);
    pa.gen += gen; pa.surv += surv; pa.cost += cost; pa.batches++;

    const c = ensure(categoryRunStats, category);
    c.gen += gen; c.surv += surv; c.cost += cost; c.batches++;

    if (!runProviders[provider]) runProviders[provider] = 0;
    runProviders[provider]++;
  }

  totalBatches += runBatches;
  totalGenerated += runGen;
  totalSurvived += runSurv;
  totalCost += runCost;

  let summary = null;
  if (existsSync(summaryPath)) {
    try { summary = JSON.parse(readFileSync(summaryPath, 'utf8')); } catch {}
  }

  runSummaries.push({
    runId,
    startedAt: summary?.startedAt || runId,
    durationMs: summary?.durationMs,
    batches: runBatches,
    generated: runGen,
    survived: runSurv,
    cost: runCost,
    survRate: runGen ? runSurv / runGen : 0,
    poolStart: summary?.totals?.poolSizeStart,
    poolEnd: summary?.totals?.poolSizeEnd,
    stopReason: summary?.stopReason,
    providers: summary?.config?.providers,
    rotation: summary?.config?.rotation,
    concurrent: summary?.config?.concurrentBatches,
  });
}

// ---------- 3. SEEDS ----------
const seedLines = readFileSync(SEEDS, 'utf8').trim().split('\n');
const seeds = seedLines.map(l => JSON.parse(l));
const seedStats = {
  total: seeds.length,
  active: seeds.filter(s => s.status === 'active').length,
  demoted: seeds.filter(s => s.status === 'demoted').length,
  byCategory: {},
};
for (const s of seeds) {
  if (!seedStats.byCategory[s.category]) seedStats.byCategory[s.category] = { total: 0, active: 0, demoted: 0 };
  seedStats.byCategory[s.category].total++;
  if (s.status === 'active') seedStats.byCategory[s.category].active++;
  if (s.status === 'demoted') seedStats.byCategory[s.category].demoted++;
}

// ---------- 4. OUTPUT ----------
function tableRow(...cols) { return cols.join('\t'); }
function pct(n) { return (n * 100).toFixed(1) + '%'; }
function $(n) { return '$' + n.toFixed(4); }

const out = {
  poolSize: pool.length,
  scoredQuestions: pool.filter(q => q.qualityAssessment).length,
  overallAvgFun: avg(pool.filter(q => q.qualityAssessment).map(q => q.qualityAssessment.funScore)),
  overallAvgQual: avg(pool.filter(q => q.qualityAssessment).map(q => q.qualityAssessment.qualityScore)),
  overallAvgLearn: avg(pool.filter(q => q.qualityAssessment).map(q => q.qualityAssessment.learningValue)),
  byProvider, byProviderModel, byCategory, byArchetype, bySeed,
  runs: { totalRuns, totalBatches, totalGenerated, totalSurvived, totalCost },
  runSummaries, providerRunStats, providerArchetypeRunStats, categoryRunStats, seedStats,
};

console.log('=== POOL ===');
console.log(`Pool size: ${out.poolSize} questions`);
console.log(`With quality assessment: ${out.scoredQuestions}`);
console.log(`Avg Fun: ${out.overallAvgFun.toFixed(2)}, Quality: ${out.overallAvgQual.toFixed(2)}, Learning: ${out.overallAvgLearn.toFixed(2)}`);

console.log('\n=== POOL BY PROVIDER ===');
console.log('provider\tcount\tavgFun\tavgQual\tavgLearn');
for (const [p, s] of Object.entries(byProvider).sort((a, b) => b[1].count - a[1].count)) {
  console.log(tableRow(p, s.count, avg(s.fun).toFixed(2), avg(s.qual).toFixed(2), avg(s.learn).toFixed(2)));
}

console.log('\n=== POOL BY PROVIDER+MODEL ===');
console.log('provider|model\tcount\tavgFun\tavgQual\tavgLearn');
for (const [pm, s] of Object.entries(byProviderModel).sort((a, b) => b[1].count - a[1].count)) {
  console.log(tableRow(pm, s.count, avg(s.fun).toFixed(2), avg(s.qual).toFixed(2), avg(s.learn).toFixed(2)));
}

console.log('\n=== POOL BY CATEGORY ===');
console.log('category\tcount\tavgFun\tavgQual\tavgLearn');
for (const [c, s] of Object.entries(byCategory).sort((a, b) => b[1].count - a[1].count)) {
  console.log(tableRow(c, s.count, avg(s.fun).toFixed(2), avg(s.qual).toFixed(2), avg(s.learn).toFixed(2)));
}

console.log('\n=== POOL BY ARCHETYPE ===');
console.log('archetype\tcount\tavgFun\tavgQual\tavgLearn');
for (const [a, s] of Object.entries(byArchetype).sort((b, c) => c[1].count - b[1].count)) {
  console.log(tableRow(a, s.count, avg(s.fun).toFixed(2), avg(s.qual).toFixed(2), avg(s.learn).toFixed(2)));
}

console.log('\n=== TOP 15 SEEDS BY POOL CONTRIBUTION ===');
const topSeeds = Object.entries(bySeed).sort((a, b) => b[1].count - a[1].count).slice(0, 15);
for (const [s, st] of topSeeds) {
  console.log(tableRow(s, st.count, avg(st.fun).toFixed(2), avg(st.qual).toFixed(2)));
}

console.log('\n=== RUNS OVERVIEW ===');
console.log(`Total auto-runs: ${out.runs.totalRuns}, batches: ${out.runs.totalBatches}, generated: ${out.runs.totalGenerated}, survived: ${out.runs.totalSurvived} (${pct(out.runs.totalSurvived/out.runs.totalGenerated)}), spent: ${$(out.runs.totalCost)}`);

console.log('\n=== RUN-BY-RUN SUMMARY ===');
console.log('runId\tbatches\tgen\tsurv\tsurv%\tcost\tpoolGrowth\tstop');
for (const r of runSummaries) {
  const poolDelta = (r.poolStart != null && r.poolEnd != null) ? `${r.poolStart}→${r.poolEnd}` : '?';
  console.log(tableRow(r.runId.slice(0, 19), r.batches, r.generated, r.survived, pct(r.survRate), $(r.cost), poolDelta, r.stopReason || '?'));
}

console.log('\n=== AGGREGATED PROVIDER STATS (across all 17 runs) ===');
console.log('provider\tbatches\tgenerated\tsurvived\tsurv%\ttotalCost\t$/survivor');
for (const [p, s] of Object.entries(providerRunStats).sort((a, b) => b[1].gen - a[1].gen)) {
  const dollarPerSurv = s.surv ? s.cost / s.surv : Infinity;
  console.log(tableRow(p, s.batches, s.gen, s.surv, pct(s.surv/s.gen), $(s.cost), s.surv ? $(dollarPerSurv) : '∞'));
}

console.log('\n=== AGGREGATED CATEGORY STATS ===');
console.log('category\tbatches\tgenerated\tsurvived\tsurv%\t$/surv');
for (const [c, s] of Object.entries(categoryRunStats).sort((a, b) => b[1].gen - a[1].gen)) {
  console.log(tableRow(c, s.batches, s.gen, s.surv, pct(s.surv/s.gen), s.surv ? $(s.cost/s.surv) : '∞'));
}

console.log('\n=== PROVIDER × ARCHETYPE MATRIX (top weak/strong cells) ===');
const paArr = Object.entries(providerArchetypeRunStats).filter(([k, s]) => s.gen >= 6).map(([k, s]) => ({ k, ...s, sr: s.surv/s.gen }));
paArr.sort((a, b) => b.sr - a.sr);
console.log('--- TOP 10 STRONGEST cells ---');
for (const r of paArr.slice(0, 10)) console.log(tableRow(r.k, r.gen, r.surv, pct(r.sr), $(r.cost)));
console.log('--- BOTTOM 10 WEAKEST cells (≥6 gen) ---');
for (const r of paArr.slice(-10).reverse()) console.log(tableRow(r.k, r.gen, r.surv, pct(r.sr), $(r.cost)));

console.log('\n=== SEEDS ===');
console.log(`Total seeds: ${seedStats.total} (active: ${seedStats.active}, demoted: ${seedStats.demoted})`);
console.log('Seeds per category (active/total):');
for (const [c, s] of Object.entries(seedStats.byCategory)) {
  console.log(tableRow(c, `${s.active}/${s.total}`));
}

// also dump raw JSON for the next steps
import { writeFileSync } from 'fs';
writeFileSync(join(ROOT, 'data/_analysis_raw.json'), JSON.stringify(out, null, 2));
console.log('\n[wrote data/_analysis_raw.json]');
