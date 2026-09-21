import type { LLMProvider, ProviderModelOption } from '../../../types/app';

export const DEFAULT_EFFORT_VALUE = 'default';

export const FALLBACK_PROVIDER_EFFORT_VALUES: Partial<Record<LLMProvider, readonly string[]>> = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['low', 'medium', 'high', 'xhigh'],
  opencode: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  // First paint before the catalog lands; the catalog then narrows per model
  // (grok-4.5 has no xhigh).
  grok: ['low', 'medium', 'high', 'xhigh'],
};

export const toProviderEffortOptions = (
  values: readonly string[],
): NonNullable<ProviderModelOption['effort']>['values'] => values.map((value) => ({ value }));
