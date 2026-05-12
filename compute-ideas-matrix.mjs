#!/usr/bin/env node
// Compute the (Provider × Archetype) "distinct ideas yield" matrix.
// Run AFTER analyze-all.mjs (consumes its data/_analysis_raw.json output).
//   node analyze-all.mjs
//   node compute-ideas-matrix.mjs
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const RAW_PATH = join(ROOT, 'data/_analysis_raw.json');

if (!existsSync(RAW_PATH)) {
  console.error(`ERROR: ${RAW_PATH} not found.`);
  console.error('Run `node analyze-all.mjs` first to produce it.');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(RAW_PATH, 'utf8'));

// 1. (Provider × Archetype) survival matrix
const archetypes = ['cause_effect','comparison','process_sequence','misconception','etymology','estimation','lateral_connection','odd_one_out','counterfactual','vocab_context','strategy','spatial'];
const providers = Object.keys(raw.providerRunStats);

const matrix = {};
for (const p of providers) {
  matrix[p] = {};
  for (const a of archetypes) {
    const key = `${p}|${a}`;
    const s = raw.providerArchetypeRunStats[key];
    if (s && s.gen > 0) {
      matrix[p][a] = {
        gen: s.gen,
        surv: s.surv,
        rate: s.surv / s.gen,
        cost: s.cost,
        $per: s.surv ? s.cost / s.surv : null,
      };
    } else {
      matrix[p][a] = null;
    }
  }
}

// 2. (Provider × Seed) — "distinct ideas per seed" from pool data
const pool = readFileSync(join(ROOT, 'data/finalized-pool.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const providerSeedSurv = {};
for (const q of pool) {
  const k = `${q.generationProvider}|${q.seedId || 'no-seed'}`;
  providerSeedSurv[k] = (providerSeedSurv[k] || 0) + 1;
}

// Print matrix
const cell = (m) => {
  if (!m) return '   —   ';
  if (m.gen < 6) return `(${m.surv}/${m.gen})`;
  const r = (m.rate * 100).toFixed(0);
  return `${r}% (${m.surv}/${m.gen})`;
};

console.log('=== (PROVIDER × ARCHETYPE) DISTINCT-IDEAS YIELD MATRIX ===\n');
const header = ['provider'.padEnd(22)].concat(archetypes.map(a => a.slice(0,9).padStart(11)));
console.log(header.join(' | '));
console.log('-'.repeat(header.join(' | ').length));
for (const p of providers.sort()) {
  const row = [p.padEnd(22)];
  for (const a of archetypes) {
    row.push(cell(matrix[p][a]).padStart(11));
  }
  console.log(row.join(' | '));
}

// Per-provider summary: how many archetypes does this provider have >50% yield in?
console.log('\n=== PROVIDER "BREADTH" SCORE — number of archetypes ≥50% survival (≥6 gen) ===\n');
const breadth = [];
for (const p of providers) {
  const cells = Object.values(matrix[p]).filter(c => c && c.gen >= 6);
  const strong = cells.filter(c => c.rate >= 0.5).length;
  const weak = cells.filter(c => c.rate < 0.2).length;
  const tested = cells.length;
  breadth.push({ p, strong, weak, tested });
}
breadth.sort((a,b) => b.strong - a.strong);
console.log('provider'.padEnd(22) + ' | ' + 'tested cells'.padStart(13) + ' | ' + 'strong (≥50%)'.padStart(15) + ' | ' + 'weak (<20%)'.padStart(13));
for (const b of breadth) {
  console.log(b.p.padEnd(22) + ' | ' + String(b.tested).padStart(13) + ' | ' + String(b.strong).padStart(15) + ' | ' + String(b.weak).padStart(13));
}

// (Provider × Seed) "distinct ideas per seed" — top 10 seeds, show which providers contributed
console.log('\n=== (SEED × PROVIDER) — DISTINCT IDEAS YIELD PER SEED ===\n');
// Pick top 10 seeds by total contributions
const seedTotals = {};
for (const [k, v] of Object.entries(providerSeedSurv)) {
  const [p, s] = k.split('|');
  if (s === 'no-seed') continue;
  seedTotals[s] = (seedTotals[s] || 0) + v;
}
const topSeeds = Object.entries(seedTotals).sort((a,b) => b[1]-a[1]).slice(0,15).map(x => x[0]);
const seedProviders = providers.slice(0, 8);  // top 8 providers
console.log('seed'.padEnd(28) + ' | ' + seedProviders.map(p => p.slice(0,9).padStart(9)).join(' | '));
console.log('-'.repeat(28 + 12 * seedProviders.length));
for (const s of topSeeds) {
  const row = [s.padEnd(28)];
  for (const p of seedProviders) {
    const k = `${p}|${s}`;
    const n = providerSeedSurv[k] || 0;
    row.push(String(n).padStart(9));
  }
  console.log(row.join(' | '));
}

// Save structured data
writeFileSync(join(ROOT, 'data/_matrix_data.json'), JSON.stringify({ matrix, breadth, providerSeedSurv, topSeeds }, null, 2));
console.log('\n[wrote data/_matrix_data.json]');
