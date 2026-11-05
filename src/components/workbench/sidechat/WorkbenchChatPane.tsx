/**
 * One chat inside a canvas tab — the side chat (`btw`) and the second chat
 * (`chat`). It is the same ChatInterface as the chat on the left (feed, tool
 * cards, composer with mode/model/effort/context, «Думает…», questions with
 * buttons, queue), run with `embedded`: whatever is typed here goes to this
 * tab's chat only, and page-wide things (sounds, title marks, the connection
 * watchdog, the route) stay with the main chat.
 *
 * The tab is kept mounted while another canvas tab is active (keepMounted),
 * so a running answer, the scroll and the draft survive tab switches.
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useWebSocket } from '../../../contexts/WebSocketContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useAttentionItem } from '../../attention/useAttention';
import ChatInterface from '../../chat/view/ChatInterface';
import type { ChatEmbedding } from '../../chat/types/types';
import ErrorBoundary from '../../main-content/view/ErrorBoundary';
import type { WorkbenchRenderContext, WorkbenchTab } from '../workbenchTabs';

import { paneSession, retargetTitle, sameSessionView, settledTabTitle, sideChatStore } from './sideChatModel';

type WorkbenchChatPaneProps = {
  tab: WorkbenchTab;
  sessionId: string;
  context: WorkbenchRenderContext;
};

const STATUS_LABELS: Record<string, string> = {
  working: 'Работает',
  waiting: 'Ждёт ответа',
  done: 'Готово',
  failed: 'Ошибка',
};

export default function WorkbenchChatPane({ tab, sessionId, context }: WorkbenchChatPaneProps) {
  const { ws, sendMessage } = useWebSocket();
  const { preferences } = useUiPreferences();
  const { showRawParameters, showThinking, sendByCtrlEnter, sendByDoubleEnter } = preferences;
  const navigate = useNavigate();
  const attention = useAttentionItem(sessionId);
  const runtime = context.chatRuntime;
  const projectSessions = context.project.sessions;

  // The project list is rebuilt on every sidebar event: keep handing the chat
  // the same session object while what it shows is the same.
  const freshSession = paneSession(projectSessions ?? [], sessionId, sideChatStore.getEngine(sessionId), context.project, tab.title);
  const sessionRef = useRef(freshSession);
  if (!sameSessionView(sessionRef.current, freshSession)) {
    sessionRef.current = freshSession;
  }
  const session = sessionRef.current;

  // Latest context for the stable callback below (the context object is new every render).
  const contextRef = useRef(context);
  contextRef.current = context;
  // The tab becomes the other chat in place; a hidden tab stays hidden.
  const onRetarget = useCallback((targetSessionId: string) => {
    if (!targetSessionId || targetSessionId === sessionId) return;
    const { replaceTab, project } = contextRef.current;
    replaceTab({ kind: tab.kind === 'btw' ? 'btw' : 'chat', ref: targetSessionId, title: retargetTitle(project.sessions ?? [], targetSessionId) });
  }, [sessionId, tab.kind]);

  // A stand-in title («Чат») gives way to the chat's name once the list has it.
  const settledTitle = settledTabTitle(tab.title, projectSessions ?? [], sessionId);
  useEffect(() => {
    if (!settledTitle) return;
    contextRef.current.replaceTab({ id: tab.id, kind: tab.kind, ref: tab.ref, title: settledTitle });
  }, [settledTitle, tab.id, tab.kind, tab.ref]);

  const embedded = useMemo<ChatEmbedding>(() => ({
    hostSessionId: context.sessionId,
    onRetarget,
    isVisible: context.isActive,
  }), [context.sessionId, onRetarget, context.isActive]);

  const openWhole = useCallback(() => navigate(`/session/${sessionId}`), [navigate, sessionId]);

  const running = Boolean(runtime?.processingSessions?.has(sessionId));
  const state = running ? 'working' : attention?.state ?? null;
  const renderFallback = useCallback(() => (
    <div className="flex flex-col items-start gap-2 p-4 text-sm" role="alert">
      <p className="text-foreground">Чат не открылся.</p>
      <button
        type="button"
        onClick={openWhole}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-foreground hover:bg-accent"
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        Открыть чат целиком
      </button>
    </div>
  ), [openWhole]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-workbench-chat={sessionId}>
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border/60 px-3 py-1.5 text-xs">
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{tab.title || session.summary || 'Чат'}</span>
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
          onClick={openWhole}
          title="Открыть чат целиком"
          aria-label="Открыть чат целиком"
          className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1">
        <ErrorBoundary renderFallback={renderFallback} resetKeys={[sessionId]}>
          <ChatInterface
            embedded={embedded}
            selectedProject={context.project}
            selectedSession={session}
            ws={ws}
            sendMessage={sendMessage}
            onFileOpen={context.onFileOpen}
            onSessionProcessing={runtime?.onSessionProcessing}
            onSessionIdle={runtime?.onSessionIdle}
            processingSessions={runtime?.processingSessions}
            onSessionEstablished={runtime?.onSessionEstablished}
            showRawParameters={showRawParameters}
            showThinking={showThinking}
            sendByCtrlEnter={sendByCtrlEnter}
            sendByDoubleEnter={sendByDoubleEnter}
          />
        </ErrorBoundary>
      </div>
    </div>
  );
}
