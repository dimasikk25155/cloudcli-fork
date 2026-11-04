/**
 * One chat inside a canvas tab — the side chat (`btw`) and the second chat
 * (`chat`): its own feed, input and status. Whatever is typed here goes to
 * this tab's chat only (`chat.send` with the tab's session id); the chat the
 * canvas belongs to keeps running undisturbed.
 *
 * The canvas renders only the active tab: the draft and the scroll position
 * live in `sideChatStore`, so switching tabs loses nothing.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ExternalLink, Loader2, Square } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useWebSocket } from '../../../contexts/WebSocketContext';
import type { ServerEvent } from '../../../contexts/WebSocketContext';
import { authenticatedFetch } from '../../../utils/api';
import { useAttentionItem } from '../../attention/useAttention';
import { Markdown } from '../../chat/view/subcomponents/Markdown';
import type { WorkbenchRenderContext, WorkbenchTab } from '../workbenchTabs';

import { chatSendFrame, feedRows, sideChatStore, type SideChatRow } from './sideChatModel';

type WorkbenchChatPaneProps = {
  tab: WorkbenchTab;
  sessionId: string;
  context: WorkbenchRenderContext;
};

const HISTORY_LIMIT = 60;
const REFRESH_DELAY_MS = 700;
/** Live frames after which the transcript on disk is read again. */
const REFRESH_KINDS = new Set(['text', 'tool_use', 'tool_result', 'complete', 'error']);

const STATUS_LABELS: Record<string, string> = {
  working: 'Работает',
  waiting: 'Ждёт ответа',
  done: 'Готово',
  failed: 'Ошибка',
};

export default function WorkbenchChatPane({ tab, sessionId, context }: WorkbenchChatPaneProps) {
  const draftKey = tab.id;
  const { sendMessage, subscribe } = useWebSocket();
  const navigate = useNavigate();
  const attention = useAttentionItem(sessionId);

  const [rows, setRows] = useState<SideChatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState('');
  const [running, setRunning] = useState(false);
  const [draft, setDraftState] = useState(() => sideChatStore.getDraft(draftKey));
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const session = useMemo(
    () => (context.project.sessions ?? []).find((candidate) => String(candidate.id) === sessionId) ?? null,
    [context.project.sessions, sessionId],
  );
  const engine = sideChatStore.getEngine(sessionId) ?? { model: session?.model ?? null, effort: session?.effort ?? null };

  const load = useCallback(async () => {
    try {
      const response = await authenticatedFetch(
        `/api/providers/sessions/${encodeURIComponent(sessionId)}/messages?limit=${HISTORY_LIMIT}&offset=0`,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      const data = body?.data ?? body;
      setRows(feedRows(Array.isArray(data?.messages) ? data.messages : []));
      setLoadError(null);
    } catch {
      setLoadError('Переписку не загрузить — попробуй открыть чат целиком');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const scheduleRefresh = useCallback((clearStreaming: boolean) => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void load().then(() => {
        if (clearStreaming) setStreaming('');
      });
    }, REFRESH_DELAY_MS);
  }, [load]);

  // Transcript, then live frames of this chat. `chat.subscribe` attaches a run
  // the server started without a socket (the side chat's first answer).
  useEffect(() => {
    setLoading(true);
    setStreaming('');
    void load();
    const resubscribe = () => sendMessage({ type: 'chat.subscribe', sessions: [{ sessionId, lastSeq: 0 }] });
    resubscribe();
    const unsubscribe = subscribe((event: ServerEvent) => {
      if (event.kind === 'websocket_reconnected') {
        setStreaming('');
        resubscribe();
        void load();
        return;
      }
      if (event.sessionId !== sessionId) return;
      if (event.kind === 'chat_subscribed') {
        setRunning(Boolean(event.isProcessing));
        return;
      }
      if (event.kind === 'stream_delta' && typeof event.content === 'string') {
        setRunning(true);
        setStreaming((current) => current + String(event.content));
        return;
      }
      if (event.kind === 'complete') {
        setRunning(false);
        scheduleRefresh(true);
        return;
      }
      if (event.kind === 'protocol_error') {
        setRunning(false);
        setLoadError(typeof event.error === 'string' ? event.error : 'Сообщение не ушло');
        return;
      }
      if (REFRESH_KINDS.has(String(event.kind))) {
        if (event.kind === 'text') setStreaming('');
        scheduleRefresh(false);
      }
    });
    return () => {
      unsubscribe();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [sessionId, load, scheduleRefresh, sendMessage, subscribe]);

  // Scroll: back where it was after a tab switch, then follow new rows while at the bottom.
  const scrollRestored = useRef(false);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || loading) return;
    if (!scrollRestored.current) {
      scrollRestored.current = true;
      const saved = sideChatStore.getScroll(draftKey);
      if (saved !== null) {
        node.scrollTop = saved;
        stickToBottom.current = node.scrollHeight - saved - node.clientHeight < 40;
        return;
      }
    }
    if (stickToBottom.current) node.scrollTop = node.scrollHeight;
  }, [rows, streaming, loading, draftKey]);

  const onScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    sideChatStore.setScroll(draftKey, node.scrollTop);
    stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
  };

  const setDraft = (text: string) => {
    setDraftState(text);
    sideChatStore.setDraft(draftKey, text);
  };

  const state = running ? 'working' : attention?.state ?? null;
  const working = state === 'working';

  const send = () => {
    if (working) return;
    const frame = chatSendFrame({ kind: tab.kind, ref: sessionId }, draft, engine);
    if (!frame) return;
    // Queued and sent on reconnect when the socket is down.
    sendMessage(frame);
    setRows((current) => [...current, { id: `local-${Date.now()}`, role: 'user', text: frame.content }]);
    setRunning(true);
    setLoadError(null);
    stickToBottom.current = true;
    setDraft('');
  };

  const stop = () => {
    sendMessage({ type: 'chat.abort', sessionId });
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-workbench-chat={sessionId}>
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2 text-xs">
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{tab.title || session?.summary || 'Чат'}</span>
        {state && (
          <span
            className={`rounded-full px-2 py-0.5 ${
              state === 'failed' ? 'bg-destructive/10 text-destructive'
                : state === 'waiting' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                  : 'bg-muted text-muted-foreground'
            }`}
          >
            {STATUS_LABELS[state] ?? state}
          </span>
        )}
        <button
          type="button"
          onClick={() => navigate(`/session/${sessionId}`)}
          title="Открыть чат целиком"
          aria-label="Открыть чат целиком"
          className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm">
        {loading && rows.length === 0 ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Загружаю переписку…
          </p>
        ) : rows.length === 0 && !streaming ? (
          <p className="text-muted-foreground">{working ? 'Агент отвечает…' : 'Здесь пока пусто — напиши первое сообщение.'}</p>
        ) : null}
        {rows.map((row) => (
          <SideChatRowView key={row.id} row={row} />
        ))}
        {streaming && (
          <div className="min-w-0 text-foreground">
            <Markdown className="prose prose-sm max-w-none dark:prose-invert">{streaming}</Markdown>
          </div>
        )}
        {working && !streaming && rows.length > 0 && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Агент отвечает…
          </p>
        )}
        {state === 'waiting' && (
          <p className="text-xs text-muted-foreground">Агент ждёт ответа на вопрос — открой чат целиком, чтобы ответить.</p>
        )}
        {loadError && <p className="text-xs text-destructive">{loadError}</p>}
      </div>

      <div className="flex-shrink-0 border-t border-border/60 p-2">
        <div className="flex items-end gap-2 rounded-xl border border-border bg-card px-2 py-1.5">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder="Сообщение в этот чат…"
            aria-label="Сообщение в этот чат"
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          {working ? (
            <button
              type="button"
              onClick={stop}
              title="Остановить"
              aria-label="Остановить"
              className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-muted text-foreground hover:bg-accent"
            >
              <Square className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              onClick={send}
              disabled={!draft.trim()}
              title="Отправить в этот чат"
              aria-label="Отправить в этот чат"
              className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
            >
              <ArrowUp className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SideChatRowView({ row }: { row: SideChatRow }) {
  if (row.role === 'user') {
    return (
      <div className="ml-6 whitespace-pre-wrap rounded-xl bg-muted px-3 py-2 text-foreground">{row.text}</div>
    );
  }
  if (row.role === 'tool') {
    return <p className="text-xs text-muted-foreground">⚙ {row.text}</p>;
  }
  if (row.role === 'error') {
    return <p className="text-xs text-destructive">{row.text}</p>;
  }
  return (
    <div className="min-w-0 text-foreground">
      <Markdown className="prose prose-sm max-w-none dark:prose-invert">{row.text}</Markdown>
    </div>
  );
}
