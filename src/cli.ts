#!/usr/bin/env node
import { Command } from 'commander';
import { costLogger } from './cost-logger.js';
import type { ChatProviderName, VerifierProviderName } from './providers/types.js';
import type { Archetype } from './schema.js';

const program = new Command();

program
  .name('question-pipeline')
  .description('Local AI tooling for quiz question generation, verification, embedding, and dedup')
  .version('0.1.0');

// ---------------------------------------------------------------------------
// generate
// ---------------------------------------------------------------------------
program
  .command('generate')
  .description('Generate new questions via Claude or DeepSeek')
  .requiredOption('-c, --count <n>', 'Number of questions to generate', (v) => Number(v), 1)
  .requiredOption('-a, --archetype <type>', 'Question archetype (cause_effect, comparison, ...)')
  .requiredOption('-y, --category <cat>', 'Category (Science, History, ...)')
  .option('-d, --difficulty <level>', 'easy | medium | hard')
  .option('-p, --provider <name>', 'Override generator provider: anthropic | deepseek | google')
  .option('-o, --output <path>', 'Output JSONL path')
  .option('--no-seeds', 'Skip the seed system, generate free-form (legacy mode)')
  .option('--seed-id <id>', 'Pin a specific seed by id (overrides random sampling)')
  .action(async (opts) => {
    const { generateQuestions } = await import('./generator.js');
    await generateQuestions({
      count: Number(opts.count),
      archetype: opts.archetype as Archetype,
      category: opts.category,
      difficulty: opts.difficulty as 'easy' | 'medium' | 'hard' | undefined,
      provider: opts.provider as ChatProviderName | undefined,
      outputPath: opts.output,
      useSeeds: opts.seeds !== false,
      seedId: opts.seedId,
    });
    console.log(`\n${costLogger.summary()}`);
  });

// ---------------------------------------------------------------------------
// quality (runs between generate and verify) — DeepSeek-recommended
// ---------------------------------------------------------------------------
program
  .command('quality')
  .description('Rate each question on accessibility / fun / craftsmanship / learning value, then keep|review|reject')
  .requiredOption('-i, --input <path>', 'Input JSONL of generated questions')
  .option('-o, --output <path>', 'All questions output JSONL (with assessment fields)')
  .option('--keep-path <path>', 'Output JSONL for kept questions only')
  .option('--review-path <path>', 'Output JSONL for review-queue questions only')
  .option('--reject-path <path>', 'Output JSONL for rejected questions only')
  .option('-p, --provider <name>', 'Override quality provider: deepseek (recommended) | anthropic | google')
  .option('-c, --concurrency <n>', 'Parallel requests', (v) => Number(v), 5)
  .action(async (opts) => {
    const { checkQuality } = await import('./quality.js');
    await checkQuality({
      inputPath: opts.input,
      outputPath: opts.output,
      keepPath: opts.keepPath,
      reviewPath: opts.reviewPath,
      rejectPath: opts.rejectPath,
      provider: opts.provider as ChatProviderName | undefined,
      concurrency: Number(opts.concurrency),
    });
    console.log(`\n${costLogger.summary()}`);
  });

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------
program
  .command('verify')
  .description('Verify generated questions via Perplexity (web-grounded) or DeepSeek-R1 (reasoning)')
  .requiredOption('-i, --input <path>', 'Input JSONL of questions to verify')
  .option('-o, --output <path>', 'Output verified JSONL path')
  .option('-r, --review-queue <path>', 'Path for failed/flagged questions')
  .option('-p, --provider <name>', 'Override verifier provider: perplexity | deepseek')
  .action(async (opts) => {
    const { verifyQuestions } = await import('./verifier.js');
    await verifyQuestions({
      inputPath: opts.input,
      outputPath: opts.output,
      reviewQueuePath: opts.reviewQueue,
      provider: opts.provider as VerifierProviderName | undefined,
    });
    console.log(`\n${costLogger.summary()}`);
  });

// ---------------------------------------------------------------------------
// embed
// ---------------------------------------------------------------------------
program
  .command('embed')
  .description('Generate Voyage embeddings for each question (writes inline as `embedding` field)')
  .requiredOption('-i, --input <path>', 'Input JSONL')
  .option('-o, --output <path>', 'Output JSONL with embeddings')
  .option('-b, --batch-size <n>', 'Voyage batch size (max 128)', (v) => Number(v), 32)
  .action(async (opts) => {
    const { embedQuestions } = await import('./embedder.js');
    await embedQuestions({
      inputPath: opts.input,
      outputPath: opts.output,
      batchSize: Number(opts.batchSize),
    });
    console.log(`\n${costLogger.summary()}`);
  });

// ---------------------------------------------------------------------------
// dedup
// ---------------------------------------------------------------------------
program
  .command('dedup')
  .description('Find near-duplicates within an embedded JSONL (or against an existing pool)')
  .requiredOption('-i, --input <path>', 'Input embedded JSONL')
  .option('-p, --pool <path>', 'Optional existing-pool JSONL to query against')
  .option('-o, --output <path>', 'Output clusters JSON')
  .option('-k, --top-k <n>', 'Top-K nearest neighbors to consider', (v) => Number(v), 5)
  .action(async (opts) => {
    const { dedupQuestions } = await import('./dedup.js');
    await dedupQuestions({
      inputPath: opts.input,
      poolPath: opts.pool,
      outputPath: opts.output,
      topK: Number(opts.topK),
    });
  });

// ---------------------------------------------------------------------------
// review — prepare review data and open the local HTML reviewer
// ---------------------------------------------------------------------------
program
  .command('review')
  .description('Prepare review data and open the local HTML reviewer for flagged questions')
  .requiredOption('-i, --input <path>', 'Input JSONL (embedded questions)')
  .option('-c, --clusters <path>', 'Optional dedup clusters JSON for flagging duplicates')
  .option('--no-open', 'Generate review-data.json but do not auto-open browser')
  .action(async (opts) => {
    const { prepareReview } = await import('./review.js');
    await prepareReview({
      enrichedPath: opts.input,
      clustersPath: opts.clusters,
      open: opts.open !== false,
    });
  });

// ---------------------------------------------------------------------------
// review-finalize — apply browser-exported decisions
// ---------------------------------------------------------------------------
program
  .command('review-finalize')
  .description('Apply review decisions exported from the browser to produce final JSONL')
  .requiredOption('-i, --input <path>', 'Input JSONL')
  .requiredOption('-d, --decisions <path>', 'Decisions JSON exported from the HTML reviewer')
  .option('-o, --output <path>', 'Final output JSONL path')
  .action(async (opts) => {
    const { finalizeReview } = await import('./review.js');
    await finalizeReview({
      enrichedPath: opts.input,
      decisionsPath: opts.decisions,
      outputPath: opts.output,
    });
  });

// ---------------------------------------------------------------------------
// analyze-run — produce report.md from an auto-runs directory
// ---------------------------------------------------------------------------
program
  .command('analyze-run')
  .description('Generate the standard run report (per-provider spend, per-category trajectories, per-seed cost bands) for an auto-runs directory')
  .requiredOption('-r, --run-dir <path>', 'Path to data/auto-runs/<ts>/')
  .action(async (opts) => {
    const { analyzeRun } = await import('./analyze-run.js');
    const { reportPath } = await analyzeRun(opts.runDir);
    console.log(`Report written → ${reportPath}`);
  });

// ---------------------------------------------------------------------------
// seed-verify — third AI layer: gatekeep proposed seeds via Claude Opus 4.7
// (Gemini 3.1 Pro fallback). Decisions: keep / edit / remove with audit log.
// ---------------------------------------------------------------------------
program
  .command('seed-verify')
  .description('Run the seed verifier (Claude Opus 4.7 → Gemini fallback) on a seeds-proposed-*.json file. Approved seeds are appended to seeds.jsonl; every decision is logged.')
  .requiredOption('-p, --proposals <path>', 'Path to a seeds-proposed-*.json file')
  .option('-l, --log <path>', 'Output path for the JSONL audit log')
  .option('--primary <name>', 'Primary verifier provider (default anthropic)')
  .option('--fallback <name>', 'Fallback verifier provider (default google)')
  .action(async (opts) => {
    const { verifySeeds } = await import('./seed-verifier.js');
    const result = await verifySeeds({
      proposalsPath: opts.proposals,
      logPath: opts.log,
      primaryProvider: opts.primary as ChatProviderName | undefined,
      fallbackProvider: opts.fallback as ChatProviderName | undefined,
    });
    console.log(`\n${costLogger.summary()}`);
    console.log(`\nProposals: ${result.total}`);
    console.log(`  KEEP:    ${result.kept}`);
    console.log(`  EDIT:    ${result.edited}`);
    console.log(`  REMOVE:  ${result.removed}`);
    if (result.seedsAdded.length > 0) {
      console.log(`Seeds added to seeds.jsonl: ${result.seedsAdded.join(', ')}`);
    }
    console.log(`Model: ${result.modelUsed}${result.fallbackUsed ? ' (fallback)' : ''}`);
  });

// ---------------------------------------------------------------------------
// archetype-matrix — print the compatibility table for human review
// ---------------------------------------------------------------------------
program
  .command('archetype-matrix')
  .description('Print the (archetype × category) compatibility matrix used by auto-generate')
  .action(async () => {
    const { ARCHETYPE_COMPATIBLE_CATEGORIES } = await import('./archetype-compatibility.js');
    const allCats = ['Science', 'History', 'Geography', 'Pop Culture', 'Sports', 'Language', 'Tech', 'Food & Drink', 'Arts', 'General'];
    const header = 'Archetype'.padEnd(20) + ' | ' + allCats.map((c) => c.slice(0, 4).padEnd(4)).join(' ');
    console.log(header);
    console.log('-'.repeat(header.length));
    for (const [archetype, allowed] of Object.entries(ARCHETYPE_COMPATIBLE_CATEGORIES)) {
      if (archetype === 'unsalvageable') continue;
      const row = allCats.map((c) => (allowed.includes(c) ? ' ✓  ' : ' ✗  ')).join(' ');
      console.log(archetype.padEnd(20) + ' | ' + row);
    }
  });

// ---------------------------------------------------------------------------
// quality-ab-report — read a quality.jsonl that has BOTH qualityAssessment
// and qualityAssessmentAlt fields (produced by --quality-alt-model on
// auto-generate) and emit a confusion matrix + per-archetype agreement.
// Used to decide whether the cheaper alt model could replace the primary.
// ---------------------------------------------------------------------------
program
  .command('quality-ab-report')
  .description('Compare primary vs alt quality assessments on a quality.jsonl produced with --quality-alt-model')
  .requiredOption('-i, --input <path>', 'Path to a quality.jsonl with both qualityAssessment and qualityAssessmentAlt')
  .option('-o, --output <path>', 'Write the markdown report here (default: stdout only)')
  .option('--sample <n>', 'Number of disagreement cases to show in the sample', (v) => Number(v), 12)
  .action(async (opts) => {
    const { buildAbReport, formatAbReport } = await import('./quality-ab-report.js');
    const summary = await buildAbReport(String(opts.input), Number(opts.sample));
    const md = formatAbReport(summary, String(opts.input));
    if (opts.output) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(String(opts.output), md, 'utf8');
      console.log(`Report written → ${opts.output}`);
    }
    console.log('\n' + md);
  });

// ---------------------------------------------------------------------------
// rewrite-mobile — find pool entries that violate the mobile UI character
// budget (Q>150 or any A>60), AI-rewrite each, route through quality + verify
// + embed (skip dedup), and atomically replace in finalized-pool.jsonl.
// Failed rewrites cause the original to be DROPPED from the pool.
// ---------------------------------------------------------------------------
program
  .command('rewrite-mobile')
  .description('Find pool entries that exceed the 150/60 mobile UI character budget, AI-rewrite them through the full pipeline (quality → verify → embed; skip dedup), and atomically replace in the default-repertoire pool. Failed rewrites cause both the original and the failed rewrite to be dropped.')
  .option('-p, --pool <path>', 'Default-repertoire pool path', undefined)
  .option('--q-max <n>', 'Question text hard cap (chars)', (v) => Number(v), 150)
  .option('--a-max <n>', 'Per-answer hard cap (chars)', (v) => Number(v), 60)
  .option('--provider <name>', 'Provider for the rewrite step (default deepseek)', 'deepseek')
  .option('--limit <n>', 'Process only the first N offenders (for smoke tests)', (v) => Number(v))
  .option('--dry-run', 'Skip pool write — only produce intermediate files for inspection')
  .action(async (opts) => {
    const { rewriteMobile } = await import('./rewrite-mobile.js');
    const result = await rewriteMobile({
      poolPath: opts.pool,
      qMax: Number(opts.qMax),
      aMax: Number(opts.aMax),
      provider: opts.provider as ChatProviderName,
      limit: opts.limit ? Number(opts.limit) : undefined,
      dryRun: Boolean(opts.dryRun),
    });
    console.log(`\n${costLogger.summary()}`);
    console.log(`\nOffenders processed: ${result.totalOffenders}`);
    console.log(`  Rewritten + replaced: ${result.rewritten}`);
    console.log(`  Dropped (rewrite failed): ${result.dropped}`);
    console.log(`  Failure breakdown:`);
    console.log(`    rewrite-schema: ${result.failuresByStage.rewriteSchema}`);
    console.log(`    quality:        ${result.failuresByStage.quality}`);
    console.log(`    verify:         ${result.failuresByStage.verify}`);
    console.log(`    embed:          ${result.failuresByStage.embed}`);
    console.log(`Pool: ${result.poolBefore} -> ${result.poolAfter}`);
    console.log(`Run cost: $${result.costUsd.toFixed(4)}`);
    console.log(`Work dir: ${result.workDir}`);
    if (opts.dryRun) console.log('(--dry-run: pool was NOT modified)');
  });

// ---------------------------------------------------------------------------
// archetype-stats — inspect per-(provider, model, archetype) cross-run stats
// + manage the auto-disable blocklist.
// ---------------------------------------------------------------------------
program
  .command('archetype-stats')
  .description('Inspect cross-run (provider × model × archetype) stats + auto-disable blocklist')
  .option('--clear <key>', 'Remove a single auto-block entry (e.g. "openrouter-doubao|bytedance-seed/seed-2.0-lite|process_sequence")')
  .option('--reset-all', 'Wipe ALL accumulated stats AND the auto-blocklist (use with care)')
  .option('--blocked-only', 'Only print cells that are currently auto-blocked')
  .action(async (opts) => {
    const m = await import('./provider-archetype-constraints.js');
    if (opts.resetAll) {
      await m.resetAllStats();
      console.log('All stats and auto-blocklist entries cleared.');
      return;
    }
    if (opts.clear) {
      const ok = await m.clearAutoBlock(String(opts.clear));
      console.log(ok ? `Cleared auto-block: ${opts.clear}` : `No auto-block found for key: ${opts.clear}`);
      return;
    }
    m.resetCache();
    const stats = await m.loadProviderArchetypeStats();
    const summary = m.summarizeStats(stats);
    if (summary.length === 0) {
      console.log('No (provider × archetype) stats yet. Run `auto-generate` to start collecting.');
      return;
    }
    const filtered = opts.blockedOnly ? summary.filter((c) => c.blocked) : summary;
    console.log(`Stats file: ${stats.lastUpdated === new Date(0).toISOString() ? '(empty)' : stats.lastUpdated}`);
    console.log(`Cells tracked: ${summary.length}, blocked: ${summary.filter((c) => c.blocked).length}`);
    console.log();
    console.log('Provider'.padEnd(22) + ' Model'.padEnd(36) + ' Archetype'.padEnd(20) + ' QAss Surv  Surv%  AvgQ  Block');
    console.log('-'.repeat(120));
    for (const c of filtered) {
      const survPct = (c.survivalRate * 100).toFixed(0).padStart(3);
      const avgQ = c.avgQualityScore != null ? c.avgQualityScore.toFixed(2) : '  - ';
      const block = c.blocked ? `BLOCKED — ${c.blockReason}` : '';
      console.log(
        c.provider.padEnd(22) +
        c.model.padEnd(36) +
        c.archetype.padEnd(20) +
        String(c.questionsAssessed).padStart(4) +
        String(c.survivors).padStart(5) +
        ' ' + survPct + '% ' +
        ' ' + avgQ + ' ' +
        block,
      );
    }
    if (opts.blockedOnly && filtered.length === 0) {
      console.log('(no cells currently auto-blocked)');
    }
  });

// ---------------------------------------------------------------------------
// auto-generate — orchestrated multi-provider, multi-archetype batched generation
// ---------------------------------------------------------------------------
program
  .command('auto-generate')
  .description('Auto-orchestrated generation: rotates through (category × archetype × provider), runs full pipeline per batch, appends survivors to the default-repertoire pool. Stops at target survivors OR budget cap.')
  .requiredOption('-t, --target <n>', 'Target number of survivors to land in the pool', (v) => Number(v))
  .requiredOption('-b, --budget <usd>', 'Hard cost cap in USD', (v) => Number(v))
  .option('--batch-size <n>', 'Questions per generation batch', (v) => Number(v), 8)
  .option('--max-batches <n>', 'Hard cap on number of batches', (v) => Number(v), 200)
  .option('-p, --pool <path>', 'Default-repertoire pool JSONL', undefined)
  .option('--categories <list>', 'Comma-separated category list (default: all with active seeds)')
  .option('--archetypes <list>', 'Comma-separated archetype list (default: 10-archetype rotation)')
  .option('--providers <list>', 'Comma-separated provider list (default: all with credentials)')
  .option('--log-dir <path>', 'Output directory for run logs')
  .option('--evolver-tick-every <n>', 'Auto-run the seed-evolver every N batches (0 to disable)', (v) => Number(v), 30)
  .option('--provider-weights <pairs>', 'Comma-separated provider weights, e.g. "anthropic=0.5,google=1.0,deepseek=1.0". Defaults: anthropic=0.1, openai=0.1, openrouter-qwen=0.3 (auto-throttled by cost-per-survivor evidence), every other provider=1.0. Pass an explicit value to override any throttle for surgical comparison runs.')
  .option('--rotation <mode>', 'Outer (category × archetype) rotation order: "sequential" (default — alphabetical, deterministic, reproducible across runs; use for testing) or "random" (Fisher-Yates shuffle once at run start; use for production where late-alphabet categories would otherwise be starved)', 'sequential')
  .option('--concurrent-batches <n>', 'Run up to N batches in parallel with a no-two-batches-same-provider invariant. Default 1 (sequential). Recommend 2-3 in production.', (v) => Number(v), 1)
  .option('--quality-alt-model <model>', 'A/B-test the quality assessor: while DEEPSEEK_QUALITY_MODEL stays as the executive, every question is also assessed through this model and the result stored on `qualityAssessmentAlt`. Use `quality-ab-report` after the run to compare. Typical: --quality-alt-model deepseek-chat to compare V4-Flash against the current V4-Pro default.')
  .action(async (opts) => {
    const { autoGenerate } = await import('./orchestrator.js');
    const rotationOpt = String(opts.rotation ?? 'sequential').toLowerCase();
    if (rotationOpt !== 'sequential' && rotationOpt !== 'random') {
      throw new Error(`--rotation must be 'sequential' or 'random' (got '${rotationOpt}')`);
    }
    const summary = await autoGenerate({
      targetSurvivors: Number(opts.target),
      budgetUsd: Number(opts.budget),
      batchSize: Number(opts.batchSize),
      maxBatches: Number(opts.maxBatches),
      poolPath: opts.pool,
      categories: opts.categories ? String(opts.categories).split(',').map((s) => s.trim()) : undefined,
      archetypes: opts.archetypes
        ? (String(opts.archetypes).split(',').map((s) => s.trim()) as Archetype[])
        : undefined,
      providers: opts.providers
        ? (String(opts.providers).split(',').map((s) => s.trim()) as ChatProviderName[])
        : undefined,
      logDir: opts.logDir,
      evolverTickEvery: Number(opts.evolverTickEvery),
      providerWeights: opts.providerWeights
        ? Object.fromEntries(
            String(opts.providerWeights)
              .split(',')
              .map((pair) => {
                const [name, w] = pair.split('=').map((s) => s.trim());
                return [name, Number(w)];
              }),
          )
        : undefined,
      rotation: rotationOpt as 'sequential' | 'random',
      concurrentBatches: opts.concurrentBatches ? Number(opts.concurrentBatches) : 1,
      qualityAltModel: opts.qualityAltModel,
    });
    console.log(`\n${costLogger.summary()}`);
    console.log(`\nStop reason: ${summary.stopReason}`);
    console.log(`Survivors: ${summary.totals.questionsSurvived} / ${opts.target}`);
    console.log(`Pool: ${summary.totals.poolSizeStart} → ${summary.totals.poolSizeEnd}`);
    console.log(`Cost: $${summary.totals.totalCost.toFixed(4)}`);
  });

// ---------------------------------------------------------------------------
// seed-evolve — update seed stats from quality + dedup outputs, demote, propose new seeds
// ---------------------------------------------------------------------------
program
  .command('seed-evolve')
  .description('Update seed stats from a quality-checked + dedup run, demote underperformers, propose new seeds. State-changing actions only fire on seeds with >=20 assessed questions.')
  .requiredOption('-q, --quality <path>', 'Path to a quality-checked-*.jsonl file')
  .option('-c, --clusters <path>', 'Path to a dedup-clusters-*.json file (optional)')
  .option('-r, --report <path>', 'Output path for the JSON summary report')
  .option('--proposals <path>', 'Output path for proposed-but-not-applied new seeds')
  .option('--proposal-provider <name>', 'Provider for new-seed proposals (default deepseek)')
  .option('--no-proposals', 'Skip auto-proposal step entirely (only update stats + demote)')
  .action(async (opts) => {
    const { evolveSeeds } = await import('./seed-evolver.js');
    await evolveSeeds({
      qualityInputPath: opts.quality,
      clustersInputPath: opts.clusters,
      reportOutputPath: opts.report,
      proposalsOutputPath: opts.proposals,
      proposalProvider: opts.proposalProvider as ChatProviderName | undefined,
      skipProposals: opts.proposals === false,
    });
    console.log(`\n${costLogger.summary()}`);
  });

// ---------------------------------------------------------------------------
// seed-list — print the loaded seeds (for debugging / inspection)
// ---------------------------------------------------------------------------
program
  .command('seed-list')
  .description('Print all loaded seeds with their current stats and status')
  .option('-c, --category <cat>', 'Filter by category')
  .option('-s, --status <status>', 'Filter by status (active | demoted | banned)')
  .option('--by-provider <quality-jsonl>', 'Group output by (seed, provider, model) using a quality-checked-*.jsonl input')
  .action(async (opts) => {
    const { loadSeeds } = await import('./seeds.js');
    const seeds = await loadSeeds();
    const filtered = seeds.filter((s) => {
      if (opts.category && s.category.toLowerCase() !== String(opts.category).toLowerCase()) return false;
      if (opts.status && s.status !== opts.status) return false;
      return true;
    });

    if (opts.byProvider) {
      const { readJsonlAll } = await import('./utils/jsonl.js');
      const { default: pathMod } = await import('node:path');
      void pathMod;
      const qs: import('./schema.js').Question[] = await readJsonlAll(opts.byProvider);
      // Group: seedId -> provider|model -> Question[]
      const bySeedProvider = new Map<string, Map<string, import('./schema.js').Question[]>>();
      for (const q of qs) {
        if (!q.seedId) continue;
        if (!bySeedProvider.has(q.seedId)) bySeedProvider.set(q.seedId, new Map());
        const inner = bySeedProvider.get(q.seedId)!;
        const key = `${q.generationProvider ?? '?'} / ${q.generationModel ?? '?'}`;
        if (!inner.has(key)) inner.set(key, []);
        inner.get(key)!.push(q);
      }
      for (const s of filtered) {
        const m = bySeedProvider.get(s.id);
        if (!m || m.size === 0) continue;
        console.log(`\n[${s.status}] ${s.id} (${s.category})`);
        for (const [key, list] of [...m.entries()].sort((a, b) => b[1].length - a[1].length)) {
          const assessed = list.filter((q) => q.qualityAssessment);
          const fun = assessed.length
            ? (assessed.reduce((a, q) => a + (q.qualityAssessment!.funScore ?? 0), 0) / assessed.length).toFixed(2)
            : '—';
          const qual = assessed.length
            ? (assessed.reduce((a, q) => a + (q.qualityAssessment!.qualityScore ?? 0), 0) / assessed.length).toFixed(2)
            : '—';
          const rej = assessed.length
            ? Math.round((assessed.filter((q) => q.qualityStatus === 'reject').length / assessed.length) * 100) + '%'
            : '—';
          console.log(`  ${key.padEnd(40)} n=${list.length} fun=${fun} qual=${qual} reject=${rej}`);
        }
      }
      return;
    }

    for (const s of filtered) {
      const stats = s.stats;
      console.log(
        `[${s.status.padEnd(8)}] ${s.id.padEnd(28)} ${s.category.padEnd(14)} used=${stats.timesUsed}` +
          ` assessed=${stats.questionsAssessed}` +
          ` fun=${stats.avgFunScore?.toFixed(2) ?? '—'}` +
          ` qual=${stats.avgQualityScore?.toFixed(2) ?? '—'}` +
          ` reject=${stats.rejectRate !== null ? (stats.rejectRate * 100).toFixed(0) + '%' : '—'}` +
          ` dups=${stats.duplicatePairsProduced}`,
      );
    }
    console.log(`\n${filtered.length} seed(s) shown out of ${seeds.length} total.`);
  });

program.parseAsync().catch((err) => {
  process.stderr.write(`\nFATAL: ${(err as Error).message}\n`);
  if ((err as Error).stack) {
    process.stderr.write(`${(err as Error).stack}\n`);
  }
  process.exit(1);
});
