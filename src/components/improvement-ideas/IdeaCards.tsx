import React, { useCallback, useEffect, useMemo, useReducer, useState } from 'react';

import type { ImprovementIdea } from '../../../shared/improvement-ideas';
import { useAuth } from '../../contexts/AuthContext';
import { useModEnabled } from '../../hooks/useModEnabled';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { authenticatedFetch } from '../../utils/api';

export type IdeaCardsViewProps = {
  ideas: ImprovementIdea[]; isProcessing: boolean; pending: number | null; error: string;
  onAction: (id: number, action: 'implement' | 'later' | 'sync') => void;
};
export function IdeaCardsView({ ideas, isProcessing, pending, error, onAction }: IdeaCardsViewProps) {
  const [expanded, setExpanded] = useState(false);
  const proposed = ideas.filter(idea => idea.status === 'proposed');
  const saved = ideas.filter(idea => idea.status !== 'proposed');
  if (!ideas.length && !error) return null;
  const visible = [...proposed.slice(0, expanded ? undefined : 2), ...(expanded ? saved : [])];
  return <section aria-label="Идеи улучшений" className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="font-medium">💡 Идеи улучшений · {ideas.length}</span>
      {(saved.length > 0 || proposed.length > 2) && <button type="button" className="text-xs underline" onClick={() => setExpanded(value => !value)}>{expanded ? 'Свернуть' : 'Все, включая отложенные'}</button>}
    </div>
    {error && <p role="alert" className="mb-2 text-destructive">{error}</p>}
    {visible.map(idea => <article key={idea.id} className="border-t border-border py-2 first:border-t-0">
      <p className="whitespace-pre-wrap break-words">{idea.text}</p>
      <div className="mt-1 text-xs text-muted-foreground">
        {idea.projectName} · {idea.status === 'started' ? 'Запущено — результат в исходном чате' : idea.status === 'starting' ? 'Запуск не подтверждён — проверь чат' : idea.status === 'later' ? 'Отложено' : 'Предложено'}
        {' · '}<a href={`/session/${encodeURIComponent(idea.sessionId)}`} className="underline">Исходный чат</a>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {['proposed', 'later'].includes(idea.status) && <>
          <button type="button" disabled={isProcessing || pending !== null} onClick={() => onAction(idea.id, 'implement')} className="rounded-md bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50">{pending === idea.id ? 'Подожди…' : 'Реализовать'}</button>
          {idea.status === 'proposed' && <button type="button" disabled={pending !== null} onClick={() => onAction(idea.id, 'later')} className="rounded-md border border-border px-3 py-1 disabled:opacity-50">Позже</button>}
        </>}
        <span className="text-xs text-muted-foreground">{idea.vaultError || (idea.vaultPath ? 'Сохранено в Obsidian' : 'Сохраняется в Obsidian…')}</span>
        {idea.vaultError && <button type="button" disabled={pending !== null} onClick={() => onAction(idea.id, 'sync')} className="text-xs underline">Повторить запись</button>}
      </div>
    </article>)}
    {isProcessing && proposed.length > 0 && <p className="text-xs text-muted-foreground">Реализация доступна после завершения текущего ответа.</p>}
  </section>;
}

type RequestScope = object;
type IdeaRequestState = {
  scope: RequestScope; ideas: ImprovementIdea[]; loadError: string; actionError: string;
  pending: number | null; revision: number;
};
type IdeaRequestEvent = { scope: RequestScope } & (
  | { type: 'reset' }
  | { type: 'loaded'; ideas: ImprovementIdea[] }
  | { type: 'loadFailed' | 'actionFailed'; error: string }
  | { type: 'actionStarted'; id: number }
  | { type: 'actionSucceeded'; idea: ImprovementIdea }
  | { type: 'actionFinished' }
);
// Pure request-state seam is kept next to its sole consumer.
// eslint-disable-next-line react-refresh/only-export-components
export function ideaRequestReducer(state: IdeaRequestState, event: IdeaRequestEvent): IdeaRequestState {
  if (event.type === 'reset') return { scope: event.scope, ideas: [], loadError: '', actionError: '', pending: null, revision: 0 };
  if (event.scope !== state.scope) return state;
  switch (event.type) {
    case 'loaded': return { ...state, ideas: event.ideas, loadError: '' };
    case 'loadFailed': return { ...state, loadError: event.error };
    case 'actionStarted': return { ...state, pending: event.id, actionError: '' };
    case 'actionSucceeded': return { ...state, ideas: state.ideas.map(idea => idea.id === event.idea.id ? event.idea : idea), revision: state.revision + 1 };
    case 'actionFailed': return { ...state, actionError: event.error };
    case 'actionFinished': return { ...state, pending: null };
  }
}

export function IdeaCards({ sessionId, isProcessing }: { sessionId: string | null | undefined; isProcessing: boolean }) {
  const { user } = useAuth();
  const on = useModEnabled('modImprovementIdeas');
  const { subscribe } = useWebSocket();
  const active = user?.role === 'admin' && on && Boolean(sessionId);
  const scope = useMemo(() => ({ active, sessionId }), [active, sessionId]);
  const [state, dispatch] = useReducer(ideaRequestReducer, { scope, ideas: [], loadError: '', actionError: '', pending: null, revision: 0 });
  // Reset during render so an old request cannot affect even the first render of a new chat.
  if (state.scope !== scope) dispatch({ type: 'reset', scope });
  const { ideas, pending, revision, loadError, actionError } = state;
  useEffect(() => {
    if (!active || !sessionId) return;
    let alive = true;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const response = await authenticatedFetch(`/api/improvement-ideas?sessionId=${encodeURIComponent(sessionId)}`);
        if (!response.ok) throw Error('Не удалось загрузить идеи');
        const body = await response.json();
        if (alive) dispatch({ type: 'loaded', scope, ideas: body.ideas });
      } catch (cause) { if (alive) dispatch({ type: 'loadFailed', scope, error: cause instanceof Error ? cause.message : 'Не удалось загрузить идеи' }); }
      finally { loading = false; }
    };
    void refresh();
    const unsubscribe = subscribe(event => {
      if (event.kind === 'complete' || event.kind === 'websocket_reconnected') void refresh();
    });
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => { alive = false; unsubscribe(); window.clearInterval(timer); };
  }, [active, sessionId, subscribe, revision, scope]);
  const act = useCallback(async (id: number, action: 'implement' | 'later' | 'sync') => {
    dispatch({ type: 'actionStarted', scope, id });
    try {
      const response = await authenticatedFetch(`/api/improvement-ideas/${id}/${action === 'sync' ? 'sync' : 'decision'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: action === 'sync' ? undefined : JSON.stringify({ action }),
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error || 'Действие не выполнено');
      dispatch({ type: 'actionSucceeded', scope, idea: body.idea });
    } catch (cause) { dispatch({ type: 'actionFailed', scope, error: cause instanceof Error ? cause.message : 'Действие не выполнено' }); }
    finally { dispatch({ type: 'actionFinished', scope }); }
  }, [scope]);
  return active ? <IdeaCardsView ideas={ideas} isProcessing={isProcessing} pending={pending} error={[loadError, actionError].filter(Boolean).join(' · ')} onAction={(id, action) => { void act(id, action); }} /> : null;
}
