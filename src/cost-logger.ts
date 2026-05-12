/**
 * Tracks API spend per provider across a CLI run.
 * Pricing constants live alongside each provider implementation, not here —
 * this module only sums costs that are reported to it.
 */

export type ProviderName =
  | 'anthropic'
  | 'deepseek'
  | 'perplexity'
  | 'voyage'
  | 'dashscope'
  | 'google'
  | 'openai'
  | 'vertex-mistral'
  | 'vertex-ai21'
  | 'vertex-grok'
  | 'zai'
  | 'moonshot'
  | 'byteplus'
  | 'openrouter-qwen'
  | 'openrouter-minimax'
  | 'openrouter-ernie'
  | 'openrouter-doubao';

interface ProviderStats {
  spendUsd: number;
  callCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

const emptyStats = (): ProviderStats => ({
  spendUsd: 0,
  callCount: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
});

class CostLogger {
  private stats: Record<ProviderName, ProviderStats> = {
    anthropic: emptyStats(),
    deepseek: emptyStats(),
    perplexity: emptyStats(),
    voyage: emptyStats(),
    dashscope: emptyStats(),
    google: emptyStats(),
    openai: emptyStats(),
    'vertex-mistral': emptyStats(),
    'vertex-ai21': emptyStats(),
    'vertex-grok': emptyStats(),
    zai: emptyStats(),
    moonshot: emptyStats(),
    byteplus: emptyStats(),
    'openrouter-qwen': emptyStats(),
    'openrouter-minimax': emptyStats(),
    'openrouter-ernie': emptyStats(),
    'openrouter-doubao': emptyStats(),
  };

  record(
    provider: ProviderName,
    cost: number,
    tokens?: { input?: number; cachedInput?: number; output?: number },
  ): void {
    const s = this.stats[provider];
    s.spendUsd += cost;
    s.callCount += 1;
    if (tokens) {
      s.inputTokens += tokens.input ?? 0;
      s.cachedInputTokens += tokens.cachedInput ?? 0;
      s.outputTokens += tokens.output ?? 0;
    }
  }

  total(): number {
    return Object.values(this.stats).reduce((acc, s) => acc + s.spendUsd, 0);
  }

  summary(): string {
    const total = this.total();
    const lines: string[] = [`Total: $${total.toFixed(4)}`];
    for (const [name, s] of Object.entries(this.stats)) {
      if (s.callCount === 0) continue;
      const cacheNote =
        s.cachedInputTokens > 0
          ? ` [cached ${s.cachedInputTokens} input tokens]`
          : '';
      lines.push(
        `  ${name}: $${s.spendUsd.toFixed(4)} (${s.callCount} calls, ${s.inputTokens} in / ${s.outputTokens} out${cacheNote})`,
      );
    }
    return lines.join('\n');
  }

  reset(): void {
    for (const k of Object.keys(this.stats) as ProviderName[]) {
      this.stats[k] = emptyStats();
    }
  }
}

export const costLogger = new CostLogger();
