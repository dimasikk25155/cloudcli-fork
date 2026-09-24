import type { LLMProvider, ProviderModelOption, ProviderModelsDefinition } from '../types/app';

/** New choices only. Runtime provider types and historical sessions stay intact. */
export const SELECTABLE_PROVIDERS = ['claude', 'codex', 'grok'] as const;
export type SelectableProvider = typeof SELECTABLE_PROVIDERS[number];
export const SELECTABLE_MODEL_FALLBACKS: Record<SelectableProvider, string> = {
  claude: 'opus[1m]',
  codex: 'gpt-5.6-sol',
  grok: 'grok-4.7',
};

export const isSelectableProvider = (provider: string | null | undefined): provider is SelectableProvider => (
  SELECTABLE_PROVIDERS.some(candidate => candidate === provider)
);

/** The backend selects confirmed family versions; UI also rejects unrelated rows. */
export function isSelectableModel(provider: LLMProvider, option: { value: string; hidden?: boolean }): boolean {
  if (option.hidden) return false;
  if (provider === 'claude') return ['opus[1m]', 'sonnet[1m]', 'fable'].includes(option.value);
  if (provider === 'codex') return /^gpt-\d+(?:\.\d+)*-(?:astra|sol)$/.test(option.value);
  if (provider === 'grok') return ['grok-4.7', 'grok-4.7-build-fast'].includes(option.value);
  return false;
}

export function selectableModels(provider: LLMProvider, definition?: ProviderModelsDefinition | null): ProviderModelOption[] {
  return (definition?.OPTIONS ?? []).filter(option => isSelectableModel(provider, option));
}
