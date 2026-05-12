import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

/**
 * Stream-read a JSONL file (one JSON object per line). Yields each parsed object.
 * Skips blank lines silently. Throws on parse error with line number context.
 */
export async function* readJsonl<T>(filePath: string): AsyncIterable<T> {
  if (!existsSync(filePath)) {
    throw new Error(`JSONL file not found: ${filePath}`);
  }
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineNum = 0;
  for await (const line of rl) {
    lineNum += 1;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      yield JSON.parse(trimmed) as T;
    } catch (err) {
      throw new Error(
        `Failed to parse JSONL line ${lineNum} of ${filePath}: ${(err as Error).message}`,
      );
    }
  }
}

/** Read a JSONL file fully into an array. Use for small files only. */
export async function readJsonlAll<T>(filePath: string): Promise<T[]> {
  const out: T[] = [];
  for await (const item of readJsonl<T>(filePath)) {
    out.push(item);
  }
  return out;
}

/**
 * Streaming JSONL writer. Truncates the target file on open (overwrite) so a
 * partially-written file from an aborted earlier run can't accumulate stale
 * records. Use with `for await` to stream large outputs without holding the
 * whole array in memory.
 */
export class JsonlWriter {
  private stream: NodeJS.WritableStream;
  private count = 0;

  static async open(filePath: string): Promise<JsonlWriter> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const stream = createWriteStream(filePath, { flags: 'w', encoding: 'utf8' });
    return new JsonlWriter(stream);
  }

  private constructor(stream: NodeJS.WritableStream) {
    this.stream = stream;
  }

  async write(record: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const ok = this.stream.write(JSON.stringify(record) + '\n', (err) => {
        if (err) reject(err);
      });
      if (ok) {
        resolve();
      } else {
        this.stream.once('drain', () => resolve());
      }
      this.count += 1;
    });
  }

  written(): number {
    return this.count;
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.stream.once('finish', () => resolve());
      this.stream.once('error', (err) => reject(err));
      this.stream.end();
    });
  }
}

/** Today's date as YYYY-MM-DD (UTC). */
export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
