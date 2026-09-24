import { isSelectableProvider, SELECTABLE_MODEL_FALLBACKS, selectableModels } from '../../../utils/providerSelectionPolicy';
import type { LLMProvider, ProviderModelOption, ProviderModelsDefinition } from '../../../types/app';

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

/** Keep default intent symbolic so a catalogue refresh follows the model's new default. */
export function resolveModelEffort(
  model: ProviderModelOption | null | undefined,
  choice?: { model: string; effort: string } | null,
): string {
  if (!model || choice?.model !== model.value) return 'default';
  return model.effort?.values.some(option => option.value === choice.effort)
    ? choice.effort
    : 'default';
}


/** Resolve the value displayed AND sent, including before catalogues finish loading. */
export function resolveChatSelection(
  requestedProvider: LLMProvider,
  model: string,
  definition?: ProviderModelsDefinition | null,
  sessionId?: string | null,
): { provider: LLMProvider; model: string } {
  if (sessionId) return { provider: requestedProvider, model };
  const provider = isSelectableProvider(requestedProvider) ? requestedProvider : 'grok';
  const options = selectableModels(provider, provider === requestedProvider ? definition : null);
  const selected = options.find(option => option.value === model)
    ?? options.find(option => option.value === definition?.DEFAULT)
    ?? options[0];
  return { provider, model: selected?.value ?? SELECTABLE_MODEL_FALLBACKS[provider] };
}


/** A normalized UI value may differ from storage, so never skip its effort write. */
export async function persistNewChatModelDefault(
  provider: LLMProvider,
  model: string,
  effort: string,
  save: (path: 'model' | 'effort', body: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  await Promise.all([
    save('effort', { provider, effort }),
    save('model', { provider, model }),
  ]);
}
