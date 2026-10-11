import type { LLMProvider } from '../../../types/app';

/** Runtime list of engines the client knows; must cover every `LLMProvider`. */
const KNOWN_PROVIDERS = ['claude', 'cursor', 'codex', 'opencode', 'kimi', 'gemini', 'grok'] as const satisfies readonly LLMProvider[];

// Compile-time guard: adding a provider to `LLMProvider` without listing it here fails typecheck.
type MissingProvider = Exclude<LLMProvider, (typeof KNOWN_PROVIDERS)[number]>;
const assertAllListed: MissingProvider extends never ? true : never = true;
void assertAllListed;

/** Narrows a provider string from the API to `LLMProvider`, or null when unknown. */
export function knownProvider(provider: string): LLMProvider | null {
  return KNOWN_PROVIDERS.find((id) => id === provider) ?? null;
}
