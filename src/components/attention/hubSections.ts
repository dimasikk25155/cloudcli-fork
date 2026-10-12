import { createElement } from 'react';

import MemorySuggestionsHubList from './memory/MemorySuggestionsHubList';
import { useMemorySuggestions } from './memory/useMemorySuggestions';
import type { AttentionHubSection } from './view/AttentionHubView';

export type AttentionHubSectionsContext = {
  /** Opens a session by id when the hub knows it; absent → no link. */
  openSession?: (sessionId: string) => boolean;
};

/**
 * Extension slot of the «Ждут тебя» hub. Each feature that wants its own block
 * below the status groups contributes a section here. Kept as a hook so
 * contributors can read their own stores.
 *
 * - «Заметки в вольт» (task 07): proposed vault notes, admins only.
 */
export function useAttentionHubSections(context: AttentionHubSectionsContext = {}): AttentionHubSection[] {
  const memory = useMemorySuggestions();
  const sections: AttentionHubSection[] = [];

  if (memory.entries.length > 0) {
    sections.push({
      id: 'memory-notes',
      title: 'Заметки в вольт',
      count: memory.pendingCount || undefined,
      render: () => createElement(MemorySuggestionsHubList, {
        entries: memory.entries,
        onWrite: (id: number) => void memory.write(id),
        onDismiss: (id: number) => void memory.dismiss(id),
        onOpenSession: context.openSession ? (sessionId: string) => void context.openSession?.(sessionId) : undefined,
      }),
    });
  }

  return sections;
}
