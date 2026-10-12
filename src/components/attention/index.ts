export type { AttentionItem, AttentionState, AttentionReason, AttentionDetail, AttentionCounts, AttentionSeenTarget } from './types';
export { attentionStore, useAttention, useAttentionItem, useAttentionSync, ATTENTION_POLL_MS } from './useAttention';
export { useAttentionHubSections } from './hubSections';
export {
  countAttention,
  groupAttention,
  describeAttention,
  applySeen,
  attentionGroupOf,
} from './utils/attentionModel';
export { applyAppBadge } from './utils/appBadge';
export { knownProvider } from './utils/provider';
export { default as AttentionHub } from './view/AttentionHub';
export { default as AttentionHubButton } from './view/AttentionHubButton';
export { default as AttentionHubView, type AttentionHubSection } from './view/AttentionHubView';
export { default as AttentionStatusDot } from './view/AttentionStatusDot';
export { default as MemorySuggestionBanner } from './memory/MemorySuggestionBanner';
export { default as MemorySuggestionCard } from './memory/MemorySuggestionCard';
export { useMemorySuggestions, memorySuggestionsStore } from './memory/useMemorySuggestions';
export type { MemorySuggestion, MemoryEntry } from './memory/memorySuggestionsStore';
