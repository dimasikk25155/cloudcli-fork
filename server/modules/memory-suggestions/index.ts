export {
  MAX_ATTEMPTS,
  MAX_REVIEWS_PER_TICK,
  MEMORY_CHECK_INTERVAL_MS,
  MEMORY_SUGGESTIONS_CHANGED,
  createMemorySuggestionsService,
  memorySuggestions,
  startMemorySuggestionsLoop,
} from '@/modules/memory-suggestions/memory-suggestions.service.js';
export type {
  MemorySuggestionItem,
  MemorySuggestionsDependencies,
  MemorySuggestionsService,
  MemorySuggestionsUser,
} from '@/modules/memory-suggestions/memory-suggestions.service.js';
export {
  createMemorySuggestionsRouter,
  default as memorySuggestionsRoutes,
} from '@/modules/memory-suggestions/memory-suggestions.routes.js';

export { vaultDir } from './vault-writer.js';
