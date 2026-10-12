import type { SessionLinks } from '../../../shared/session-links';

/**
 * The «Треды: N (работают M)» strip of a parent chat (story 30): its threads
 * come from the chat's server links (`relation:'thread'`), their state from
 * «Ждут тебя». Pure, so the caption rules are testable without React.
 */

export type ThreadBarState = 'working' | 'waiting' | 'done' | 'failed' | 'idle';

export type ThreadBarItem = {
  sessionId: string;
  name: string;
  provider: string;
  state: ThreadBarState;
  stateLabel: string;
};

export type ThreadsBar = {
  total: number;
  working: number;
  label: string;
  items: ThreadBarItem[];
};

const STATE_LABELS: Record<ThreadBarState, string> = {
  working: 'работает',
  waiting: 'ждёт ответа',
  done: 'готов',
  failed: 'ошибка',
  idle: 'готов',
};

export function buildThreadsBar(
  links: SessionLinks | undefined,
  statusById: ReadonlyMap<string, { state: string }>,
  unnamedLabel = 'Тред',
): ThreadsBar | null {
  const threads = (links?.children ?? []).filter((child) => child.relation === 'thread' && !child.isArchived);
  if (threads.length === 0) {
    return null;
  }

  const items = threads.map((thread): ThreadBarItem => {
    const raw = statusById.get(thread.sessionId)?.state;
    const state: ThreadBarState = raw === 'working' || raw === 'waiting' || raw === 'done' || raw === 'failed' ? raw : 'idle';
    return {
      sessionId: thread.sessionId,
      name: thread.name?.trim() || unnamedLabel,
      provider: thread.provider,
      state,
      stateLabel: STATE_LABELS[state],
    };
  });
  const working = items.filter((item) => item.state === 'working').length;
  return {
    total: items.length,
    working,
    label: working > 0 ? `Треды: ${items.length} (работают ${working})` : `Треды: ${items.length}`,
    items,
  };
}

/**
 * Links of the open chat from the live session list (kept current by
 * `session_upserted`), falling back to the snapshot the chat was opened with.
 * The open chat object is only replaced when another chat is opened, so its
 * own `links` miss a thread the agent opens mid-conversation.
 */
export function currentSessionLinks(
  sessionId: string | null | undefined,
  sessions: ReadonlyArray<{ id: string | number; links?: SessionLinks }> | null | undefined,
  snapshot: SessionLinks | undefined,
): SessionLinks | undefined {
  if (!sessionId || !sessions) {
    return snapshot;
  }
  const live = sessions.find((session) => String(session.id) === sessionId);
  return live?.links ?? snapshot;
}
