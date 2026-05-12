/**
 * Promise-chained mutex — serializes async callers around a critical section.
 *
 * Usage:
 *   const m = new Mutex();
 *   const result = await m.lock(async () => {
 *     // critical section — only one async caller in here at a time
 *     return await doIO();
 *   });
 *
 * Implementation: the next caller's promise chains onto the previous one.
 * If a callback throws, the chain swallows the error so the queue keeps
 * draining (the caller still gets the rejection via the returned promise).
 *
 * Why we need this: the orchestrator's concurrent-batches mode (≥2
 * batches in flight) has multiple critical sections that mutate shared
 * state — pool append, provider-archetype-stats file, run.log.jsonl,
 * and the dedup-then-append flow. POSIX append is atomic only for tiny
 * writes (≤PIPE_BUF) and Windows offers no such guarantee. A simple
 * promise-mutex is enough since each critical section is short.
 */
export class Mutex {
  private current: Promise<void> = Promise.resolve();

  async lock<T>(fn: () => Promise<T>): Promise<T> {
    // Capture the queue position BEFORE chaining so multiple concurrent
    // .lock() calls serialize predictably.
    const previous = this.current;
    let release: () => void = () => {};
    this.current = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      return await fn();
    } finally {
      release();
    }
  }
}
