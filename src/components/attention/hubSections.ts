import { createElement } from 'react';

import { useAuth } from '../auth';
import DuetHubList from '../duet/DuetHubList';
import { pendingDecisions } from '../duet/duetModel';
import { useDuetState } from '../duet/useDuetState';
import { useModEnabled } from '../../hooks/useModEnabled';

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
 * - «Дуэт»: решения напарника по ботам (перезапустить / починить / не следить), admins only.
 */
export function useAttentionHubSections(context: AttentionHubSectionsContext = {}): AttentionHubSection[] {
  const memory = useMemorySuggestions();
  const { user } = useAuth();
  const duetOn = useModEnabled('modDuet');
  const duet = useDuetState(user?.role === 'admin' && duetOn, 'hub');
  const sections: AttentionHubSection[] = [];
  const duetDecisions = pendingDecisions(duet.state);

  if (duetDecisions.length > 0) {
    sections.push({
      id: 'duet',
      title: 'Дуэт',
      count: duetDecisions.length,
      render: () => createElement(DuetHubList, { decisions: duetDecisions, onChanged: () => void duet.refresh() }),
    });
  }

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
