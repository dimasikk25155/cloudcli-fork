import type { AttentionHubSection } from './view/AttentionHubView';

/**
 * Extension slot of the «Ждут тебя» hub. Each feature that wants its own block
 * below the status groups contributes a section here (planned: «Заметки в
 * вольт», task 07). Kept as a hook so contributors can read their own stores.
 */
export function useAttentionHubSections(): AttentionHubSection[] {
  return [];
}
