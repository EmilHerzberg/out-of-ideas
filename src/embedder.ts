import path from 'node:path';
import pLimit from 'p-limit';
import ora from 'ora';
import { DATA_DIR } from './config.js';
import { JsonlWriter, readJsonl, todayStamp } from './utils/jsonl.js';
import { getEmbeddingProvider } from './providers/factory.js';
import type { Question } from './schema.js';
import type { EmbeddingProviderName } from './providers/types.js';

export interface EmbedOptions {
  inputPath: string;
  outputPath?: string;
  provider?: EmbeddingProviderName;
  /** Batch size for the embedding API (Voyage allows up to 128). */
  batchSize?: number;
}

const DEFAULT_BATCH = 32;

export async function embedQuestions(opts: EmbedOptions): Promise<{
  embedded: number;
  outputPath: string;
}> {
  const provider = getEmbeddingProvider(opts.provider);
  const outputPath =
    opts.outputPath ?? path.join(DATA_DIR, `embedded-${todayStamp()}.jsonl`);
  const writer = await JsonlWriter.open(outputPath);

  const spinner = ora(`Embedding questions via ${provider.name}...`).start();

  const batchSize = opts.batchSize ?? DEFAULT_BATCH;
  const buffer: Question[] = [];

  let embedded = 0;

  const flush = async () => {
    if (buffer.length === 0) return;
    const texts = buffer.map(buildEmbedText);
    const results = await provider.embedBatch(texts);
    for (let i = 0; i < buffer.length; i += 1) {
      const enriched: Question = {
        ...buffer[i],
        embedding: results[i].vector,
        embeddingProvider: results[i].provider,
      };
      await writer.write(enriched);
      embedded += 1;
    }
    buffer.length = 0;
    spinner.text = `Embedded ${embedded}`;
  };

  const limit = pLimit(2); // small concurrency on flush since each call ships up to 32

  for await (const q of readJsonl<Question>(opts.inputPath)) {
    buffer.push(q);
    if (buffer.length >= batchSize) {
      const toFlush = buffer.splice(0, batchSize);
      await limit(async () => {
        const texts = toFlush.map(buildEmbedText);
        const results = await provider.embedBatch(texts);
        for (let i = 0; i < toFlush.length; i += 1) {
          const enriched: Question = {
            ...toFlush[i],
            embedding: results[i].vector,
            embeddingProvider: results[i].provider,
          };
          await writer.write(enriched);
          embedded += 1;
        }
        spinner.text = `Embedded ${embedded}`;
      });
    }
  }
  // Flush remaining
  await flush();
  await writer.close();
  spinner.succeed(`Embedded ${embedded} questions → ${outputPath}`);
  return { embedded, outputPath };
}

// Embed only `<question> || <correct answer>`. Distractors are excluded so
// arbitrary wrong-answer wording can't dilute or inflate similarity.
export function buildEmbedText(q: Question): string {
  const correctAnswer = q.answers[q.correctIndex];
  return `${q.question} || ${correctAnswer}`;
}
