#!/usr/bin/env node
/**
 * Re-embed every question in data/finalized-pool.jsonl using the currently
 * configured embedder (set via PROVIDER_EMBEDDER + GOOGLE_API_KEY in .env).
 *
 * Run via tsx so .ts source imports resolve:
 *   npx tsx re-embed-pool.mjs
 *
 * Workflow:
 *  1. Backup current pool.
 *  2. Run `embedQuestions` with input=pool, output=pool.tmp.
 *  3. Atomic move pool.tmp → pool (replaces original).
 *  4. Clean up tmp + progress files.
 */
import { copyFile, rename, unlink, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const POOL_PATH = path.resolve('data/finalized-pool.jsonl');
const TMP_PATH = `${POOL_PATH}.tmp`;
const BACKUP_PATH = `${POOL_PATH}.pre-reembed-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;

if (!existsSync(POOL_PATH)) {
  console.error(`ERROR: ${POOL_PATH} not found.`);
  process.exit(1);
}

const poolStat = await stat(POOL_PATH);
console.log(`Pool: ${POOL_PATH} (${(poolStat.size / 1024 / 1024).toFixed(2)} MB)`);

// 1. Backup
await copyFile(POOL_PATH, BACKUP_PATH);
console.log(`Backup → ${BACKUP_PATH}`);

// 2. Re-embed via embedQuestions
const { embedQuestions } = await import('./src/embedder.ts');
console.log(`Re-embedding via configured embedder (PROVIDER_EMBEDDER) — this may take a few minutes...`);

const startTime = Date.now();
const result = await embedQuestions({
  inputPath: POOL_PATH,
  outputPath: TMP_PATH,
  batchSize: 32,
});
const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`Re-embedded ${result.embedded} questions in ${elapsedSec}s.`);

// 3. Atomic move
await rename(TMP_PATH, POOL_PATH);
console.log(`Replaced pool with re-embedded version.`);

// 4. Verify dimension on a sample question
const { readJsonl } = await import('./src/utils/jsonl.ts');
let sampleEmbedding = null;
for await (const q of readJsonl(POOL_PATH)) {
  sampleEmbedding = q.embedding;
  console.log(`Sample (id=${q.id?.slice(0, 8)}): embedding length = ${sampleEmbedding?.length}, first 4 values = ${sampleEmbedding?.slice(0, 4).map(n => n.toFixed(4)).join(', ')}`);
  break;
}

console.log(`\n✅ Done. Backup remains at ${BACKUP_PATH} — delete it once you've confirmed the smoke test works.`);
