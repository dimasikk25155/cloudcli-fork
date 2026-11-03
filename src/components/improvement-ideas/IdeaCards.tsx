import React, { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { ChevronDown, Lightbulb } from 'lucide-react';

import type { ImprovementIdea } from '../../../shared/improvement-ideas';
import { useAuth } from '../../contexts/AuthContext';
import { useModEnabled } from '../../hooks/useModEnabled';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { authenticatedFetch } from '../../utils/api';

export type IdeaCardsViewProps = {
  ideas: ImprovementIdea[]; sessionId: string; storageKey?: string;
  isProcessing: boolean; pending: number | null; error: string;
  onImplementAll: (ids: number[]) => void;
  onAction: (id: number, action: 'implement' | 'later' | 'sync') => void;
};
export function IdeaCardsView({ ideas, sessionId, storageKey, isProcessing, pending, error, onAction, onImplementAll }: IdeaCardsViewProps) {
  const [expanded, setExpanded] = useState(() => {
    try { return Boolean(storageKey && window.localStorage.getItem(storageKey) === 'open'); }
    catch { return false; }
  });
  // The API also supplies project ideas; this tray belongs strictly to the current chat.
  const currentIdeas = ideas.filter(idea => idea.sessionId === sessionId);
  const proposed = currentIdeas.filter(idea => idea.status === 'proposed');
  const ready = currentIdeas.filter(idea => idea.status === 'proposed' || idea.status === 'later');
  const visible = [...proposed, ...currentIdeas.filter(idea => idea.status !== 'proposed')];
  if (!currentIdeas.length && !error) return null;
  const buttonClass = 'min-h-9 rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
  return <div className="mx-auto mb-2 w-full max-w-[54.25rem] text-sm">
    <details className="group rounded-xl border border-border bg-card" open={expanded} onToggle={event => {
      const open = event.currentTarget.open;
      setExpanded(open);
      try { if (storageKey) window.localStorage.setItem(storageKey, open ? 'open' : 'closed'); }
      catch { /* Disclosure still works when browser storage is unavailable. */ }
    }}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <Lightbulb aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className="font-medium text-foreground">Идеи этого чата</span>
        <span className="tabular-nums">{currentIdeas.length}</span>
        {error && <span className="ml-auto text-xs text-destructive">Ошибка</span>}
        <ChevronDown aria-hidden="true" className="ml-auto h-4 w-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="max-h-[30dvh] overflow-y-auto overscroll-contain border-t border-border px-3 pb-2">
        <p className="py-2 text-xs leading-relaxed text-muted-foreground">Идеи сохраняются здесь — можно вернуться к ним в конце беседы.</p>
        {ready.length > 0 && <div className="mb-2 flex flex-wrap items-center gap-2">
          <button type="button" disabled={isProcessing || pending !== null} onClick={() => onImplementAll(ready.map(idea => idea.id))} className={`${buttonClass} border border-border text-primary`}>
            {pending === -1 ? 'Запускаю…' : `Реализовать всё · ${ready.length}`}
          </button>
          <span className="text-xs text-muted-foreground">Одной задачей, включая отложенные</span>
        </div>}
        {error && <p role="alert" className="mb-2 text-destructive">{error}</p>}
        {visible.map(idea => <article key={idea.id} className="border-t border-border py-3">
          <p className="whitespace-pre-wrap break-words leading-relaxed">{idea.text}</p>
          {idea.status !== 'proposed' && <p className="mt-1 text-xs text-muted-foreground">
            {idea.status === 'started' ? 'Запущено — результат в этом чате' : idea.status === 'starting' ? 'Запуск не подтверждён — проверь чат' : 'Отложено'}
          </p>}
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {['proposed', 'later'].includes(idea.status) && <>
              <button type="button" disabled={isProcessing || pending !== null} onClick={() => onAction(idea.id, 'implement')} className={`${buttonClass} border border-border text-primary`}>{pending === idea.id ? 'Подожди…' : 'Реализовать'}</button>
              {idea.status === 'proposed' && <button type="button" disabled={pending !== null} onClick={() => onAction(idea.id, 'later')} className={`${buttonClass} text-muted-foreground`}>Позже</button>}
            </>}
            <span className="ml-2 text-xs text-muted-foreground">{idea.vaultError || (idea.vaultPath ? 'В Obsidian' : 'Сохраняется в Obsidian…')}</span>
            {idea.vaultError && <button type="button" disabled={pending !== null} onClick={() => onAction(idea.id, 'sync')} className={`${buttonClass} underline underline-offset-4`}>Повторить запись</button>}
          </div>
        </article>)}
        {isProcessing && ready.length > 0 && <p className="py-2 text-xs text-muted-foreground">Реализация доступна после завершения текущего ответа.</p>}
      </div>
    </details>
  </div>;
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
  | { type: 'batchSucceeded'; ideas: ImprovementIdea[] }
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
    case 'batchSucceeded': return { ...state, ideas: state.ideas.map(idea => event.ideas.find(updated => updated.id === idea.id) ?? idea), revision: state.revision + 1 };
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
  const act = useCallback(async (id: number | number[], action: 'implement' | 'later' | 'sync') => {
    const batch = Array.isArray(id);
    dispatch({ type: 'actionStarted', scope, id: batch ? -1 : id });
    try {
      const response = await authenticatedFetch(batch ? '/api/improvement-ideas/implement-batch' : `/api/improvement-ideas/${id}/${action === 'sync' ? 'sync' : 'decision'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: batch ? JSON.stringify({ sessionId, ids: id }) : action === 'sync' ? undefined : JSON.stringify({ action }),
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error || 'Действие не выполнено');
      if (batch) dispatch({ type: 'batchSucceeded', scope, ideas: body.ideas });
      else dispatch({ type: 'actionSucceeded', scope, idea: body.idea });
    } catch (cause) { dispatch({ type: 'actionFailed', scope, error: cause instanceof Error ? cause.message : 'Действие не выполнено' }); }
    finally { dispatch({ type: 'actionFinished', scope }); }
  }, [scope, sessionId]);
  return active && sessionId ? <IdeaCardsView key={`${user?.id}:${sessionId}`} sessionId={sessionId} storageKey={`neo3:chat-ideas:${user?.id}:${sessionId}`} ideas={ideas} isProcessing={isProcessing} pending={pending} error={[loadError, actionError].filter(Boolean).join(' · ')} onImplementAll={ids => { void act(ids, 'implement'); }} onAction={(id, action) => { void act(id, action); }} /> : null;
}
