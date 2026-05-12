import type { ChatProvider, ChatProviderName } from './types.js';

/**
 * Chat-provider registry.
 *
 * Adding a new provider = create the provider class + register one entry in
 * `factory.ts`. The orchestrator reads from this registry to know which
 * providers exist and which are *available* (have credentials configured),
 * so a provider with no API key is silently skipped instead of crashing the
 * run.
 *
 * Each entry is lazy — the provider class is instantiated only when its
 * factory is called. This keeps `requireKey` errors from firing for
 * providers we never use.
 */

export interface ChatProviderEntry {
  name: ChatProviderName;
  /** Default model id (also queryable via env var). */
  defaultModel: string;
  /** Returns the configured model id (env override applied). */
  configuredModel: () => string;
  /** Lazy factory. Throws if key missing — callers should `isAvailable()` first. */
  factory: () => ChatProvider;
  /** Returns true if this provider has the credentials it needs to run. */
  isAvailable: () => boolean;
}

const registry: Map<ChatProviderName, ChatProviderEntry> = new Map();

export function registerChatProvider(entry: ChatProviderEntry): void {
  registry.set(entry.name, entry);
}

/** All providers defined in the build (regardless of credential availability). */
export function getRegisteredChatProviders(): ChatProviderEntry[] {
  return [...registry.values()];
}

/** Only providers whose credentials are configured. */
export function getActiveChatProviders(): ChatProviderEntry[] {
  return getRegisteredChatProviders().filter((e) => e.isAvailable());
}

export function getChatProviderEntry(name: ChatProviderName): ChatProviderEntry | undefined {
  return registry.get(name);
}
