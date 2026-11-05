import { createElement } from 'react';

import { useAuth } from '../auth';
import DuetHubList from '../duet/DuetHubList';
import { pendingDecisions } from '../duet/duetModel';
import { useDuetState } from '../duet/useDuetState';
import { useModEnabled } from '../../hooks/useModEnabled';
import MasterSessionSection from '../session-hub/MasterSessionSection';

import MemorySuggestionsHubList from './memory/MemorySuggestionsHubList';
import SecretRequestsHubList from './secret-requests/SecretRequestsHubList';
import { secretRequestsStore, useSecretRequests } from './secret-requests/useSecretRequests';
import { useMemorySuggestions } from './memory/useMemorySuggestions';
import { useAttention } from './useAttention';
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
 * - «Мастер-сессия» (мод «Панель диалогов»): ответы на все ждущие вопросы пачкой.
 * - «Агент просит ключ» (мод «Запрос ключа»): скрытое поле → файл секретов, admins only. First: the agent waits.
 */
export function useAttentionHubSections(context: AttentionHubSectionsContext = {}): AttentionHubSection[] {
  const memory = useMemorySuggestions();
  const secretRequests = useSecretRequests();
  const { user } = useAuth();
  const duetOn = useModEnabled('modDuet');
  const duet = useDuetState(user?.role === 'admin' && duetOn, 'hub');
  const sections: AttentionHubSection[] = [];

  // An agent is blocked on this answer (≤ 10 min) — above everything else.
  if (secretRequests.entries.length > 0) {
    sections.push({
      id: 'secret-requests',
      title: 'Агент просит ключ',
      count: secretRequests.entries.length,
      render: () => createElement(SecretRequestsHubList, {
        entries: secretRequests.entries,
        onSave: (id: string, value: string, replace: boolean) => void secretRequestsStore.answer(id, value, replace),
        onDecline: (id: string) => void secretRequestsStore.decline(id),
        onOpenSession: context.openSession ? (sessionId: string) => void context.openSession?.(sessionId) : undefined,
      }),
    });
  }
  const duetDecisions = pendingDecisions(duet.state);
  const sessionHubOn = useModEnabled('modSessionHub');
  const { items } = useAttention();
  const waiting = items.filter((entry) => entry.state === 'waiting');

  if (sessionHubOn && waiting.length > 0) {
    sections.push({
      id: 'master-session',
      title: 'Мастер-сессия',
      count: waiting.length,
      render: () => createElement(MasterSessionSection, {
        onOpenSession: context.openSession ? (sessionId: string) => void context.openSession?.(sessionId) : undefined,
        refreshKey: waiting.map((entry) => `${entry.sessionId}@${entry.updatedAt}`).join('|'),
      }),
    });
  }

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
