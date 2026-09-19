import type { LLMProvider } from '../../../types/app';

export type ProviderModelSetters = Record<LLMProvider, (model: string) => void>;

/**
 * Writes `model` through the setter for `provider`.
 *
 * Callers must pass a complete map — TypeScript rejects a missing `grok`.
 * The 2026-08-22 picker bug was an if/else chain whose final else dumped
 * Grok into Kimi (composer) or Cursor (empty-state).
 */
export function applyProviderModel(
  provider: LLMProvider,
  model: string,
  setters: ProviderModelSetters,
): void {
  setters[provider](model);
}

export function modelForProvider(
  provider: LLMProvider,
  models: Record<LLMProvider, string>,
): string {
  return models[provider];
}
