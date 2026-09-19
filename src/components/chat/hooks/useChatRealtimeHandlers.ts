import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type { ServerEvent } from '../../../contexts/WebSocketContext';
import { showCompletionTitleIndicator } from '../../../utils/pageTitleNotification';
import { playChatCompletionSound, playNotificationSound } from '../../../utils/notificationSound';
import type { MarkSessionIdle, MarkSessionProcessing } from '../../../hooks/useSessionProtection';
import type { PendingPermissionRequest } from '../types/types';
import type { ProjectSession, LLMProvider } from '../../../types/app';
import type { SessionStore, NormalizedMessage } from '../../../stores/useSessionStore';
import { classifyIdleAck, CONNECTION_LOST_MESSAGE } from '../utils/idleAck';

const isActionablePermissionRequest = (request: { toolName?: unknown } | null | undefined): boolean => {
  return request?.toolName !== 'ExitPlanMode' && request?.toolName !== 'exit_plan_mode';
};

const hasActionablePermissionRequests = (requests: Array<{ toolName?: unknown }> | null | undefined): boolean => {
  return Array.isArray(requests) && requests.some((request) => isActionablePermissionRequest(request));
};

interface UseChatRealtimeHandlersArgs {
  subscribe: (listener: (event: ServerEvent) => void) => () => void;
  provider: LLMProvider;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  setTokenBudget: Dispatch<SetStateAction<Record<string, unknown> | null>>;
  refreshTokenUsage?: () => Promise<void> | void;
  pendingPermissionRequests: PendingPermissionRequest[];
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  streamTimerRef: MutableRefObject<number | null>;
  accumulatedStreamRef: MutableRefObject<string>;
  /**
   * Highest live `seq` observed per session. Essential for reconnect catch-up:
   * `chat.subscribe` sends this value as `lastSeq` so the server replays only
   * the events this client actually missed. Written here on every sequenced
   * frame; read wherever a `chat.subscribe` is sent (session open, reconnect).
   */
  lastSeqRef: MutableRefObject<Map<string, number>>;
  /** When each session's `chat.subscribe` was last sent; guards stale idle acks. */
  statusCheckSentAtRef: MutableRefObject<Map<string, number>>;
  onSessionProcessing?: MarkSessionProcessing;
  onSessionIdle?: MarkSessionIdle;
  onWebSocketReconnect?: () => void;
  sessionStore: SessionStore;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                              */
/* ------------------------------------------------------------------ */

/**
 * Routes server events into the session store and processing-state map.
 *
 * This is intentionally a thin reducer over the unified `kind`-based
 * protocol: every frame is keyed by the stable app session id, so there is
 * no session-id handoff, no provider branching, and no navigation here.
 * Sidebar events (`session_upserted`, `loading_progress`) are handled by
 * `useProjectsState`, not in this hook.
 */
export function useChatRealtimeHandlers({
  subscribe,
  provider,
  selectedSession,
  currentSessionId,
  setTokenBudget,
  refreshTokenUsage,
  pendingPermissionRequests,
  setPendingPermissionRequests,
  streamTimerRef,
  accumulatedStreamRef,
  lastSeqRef,
  statusCheckSentAtRef,
  onSessionProcessing,
  onSessionIdle,
  onWebSocketReconnect,
  sessionStore,
}: UseChatRealtimeHandlersArgs) {
  // Session switches can send `chat.subscribe` before this effect has a chance
  // to rebind the websocket listener. Read the visible session id from a ref
  // so a fast `chat_subscribed` ack is matched against the current view, not
  // the previous render's closed-over selection.
  const activeViewSessionIdRef = useRef<string | null>(selectedSession?.id || currentSessionId || null);
  activeViewSessionIdRef.current = selectedSession?.id || currentSessionId || null;

  // Keep the latest pending-permission snapshot available to the websocket
  // listener so back-to-back permission events can dedupe and re-arm the
  // notification sound before React finishes a rerender.
  const pendingPermissionRequestsRef = useRef(pendingPermissionRequests);

  useEffect(() => {
    pendingPermissionRequestsRef.current = pendingPermissionRequests;
  }, [pendingPermissionRequests]);

  useEffect(() => {
    const handleEvent = (msg: ServerEvent) => {
      if (!msg.kind) {
        return;
      }

      const activeViewSessionId = activeViewSessionIdRef.current;
      const sid = (typeof msg.sessionId === 'string' && msg.sessionId) || activeViewSessionId;

      // Record replay progress for every sequenced live event.
      if (sid && typeof msg.seq === 'number') {
        const known = lastSeqRef.current.get(sid) ?? 0;
        if (msg.seq > known) {
          lastSeqRef.current.set(sid, msg.seq);
        }
      }

      switch (msg.kind) {
        case 'websocket_reconnected':
          onWebSocketReconnect?.();
          return;

        case 'chat_subscribed': {
          // Ack for chat.subscribe: authoritative processing state plus any
          // pending tool-permission prompts for the run.
          if (!sid) return;

          if (msg.isProcessing) {
            onSessionProcessing?.(sid);
          } else {
            // Idle ack: the server lastSeq is authoritative for a run that
            // finished while this socket was down. Classify before warning —
            // a seq gap means "refresh the tail", not "connection died".
            const knownSeq = lastSeqRef.current.get(sid) ?? 0;
            const serverLastSeq = typeof msg.lastSeq === 'number' ? msg.lastSeq : null;
            const idleResult = onSessionIdle?.(sid, {
              ifStartedBefore: statusCheckSentAtRef.current.get(sid),
            }) ?? 'already_idle';
            const decision = classifyIdleAck({
              locallyProcessing: idleResult === 'cleared',
              ackIsStale: idleResult === 'stale',
              knownSeq,
              serverLastSeq,
            });

            if (decision.refreshHistory && serverLastSeq !== null) {
              lastSeqRef.current.set(sid, serverLastSeq);
              // A failed REST refresh must not resurrect the false
              // connection-lost warning: the next reconnect or page reload
              // can pick the transcript up again.
              void sessionStore.refreshFromServer(sid);
            }

            if (decision.warnOrphaned) {
              sessionStore.appendRealtime(sid, {
                id: `run_orphaned_${Date.now()}`,
                sessionId: sid,
                timestamp: new Date().toISOString(),
                provider,
                kind: 'error',
                content: CONNECTION_LOST_MESSAGE,
              } as NormalizedMessage);
            }
          }

          const isViewedSession = sid === activeViewSessionId;
          if (isViewedSession && Array.isArray(msg.pendingPermissions)) {
            const nextPendingPermissionRequests = msg.pendingPermissions as PendingPermissionRequest[];
            const hadActionablePermissionRequests = hasActionablePermissionRequests(pendingPermissionRequestsRef.current);
            const hasPendingActionablePermissionRequests = hasActionablePermissionRequests(nextPendingPermissionRequests);

            pendingPermissionRequestsRef.current = nextPendingPermissionRequests;
            setPendingPermissionRequests(nextPendingPermissionRequests);

            if (hasPendingActionablePermissionRequests && !hadActionablePermissionRequests) {
              void playNotificationSound();
            }
          }
          return;
        }

        case 'protocol_error': {
          console.error('[Chat] Protocol error:', msg.code, msg.error);
          if (sid) {
            // Surface the failure in the conversation and stop the spinner —
            // the run never started (or was rejected), so no `complete` follows.
            onSessionIdle?.(sid);
            sessionStore.appendRealtime(sid, {
              id: `protocol_error_${Date.now()}`,
              sessionId: sid,
              timestamp: new Date().toISOString(),
              provider,
              kind: 'error',
              content: String(msg.error || 'Request failed'),
            } as NormalizedMessage);
          }
          return;
        }

        // Sidebar/global events — owned by useProjectsState.
        case 'session_upserted':
        case 'loading_progress':
          return;

        default:
          break;
      }

      /* -------------------------------------------------------------- */
      /*  Provider NormalizedMessage handling                            */
      /* -------------------------------------------------------------- */

      // --- Streaming: buffer for performance ---
      if (msg.kind === 'stream_delta') {
        const text = (msg.content as string) || '';
        if (!text) return;
        accumulatedStreamRef.current += text;
        if (!streamTimerRef.current) {
          streamTimerRef.current = window.setTimeout(() => {
            streamTimerRef.current = null;
            if (sid) {
              sessionStore.updateStreaming(sid, accumulatedStreamRef.current, provider);
            }
          }, 100);
        }
        // Also route to store for non-active sessions
        if (sid && sid !== activeViewSessionId) {
          sessionStore.appendRealtime(sid, msg as unknown as NormalizedMessage);
        }
        return;
      }

      if (msg.kind === 'stream_end') {
        if (streamTimerRef.current) {
          clearTimeout(streamTimerRef.current);
          streamTimerRef.current = null;
        }
        if (sid) {
          if (accumulatedStreamRef.current) {
            sessionStore.updateStreaming(sid, accumulatedStreamRef.current, provider);
          }
          sessionStore.finalizeStreaming(sid);
        }
        accumulatedStreamRef.current = '';
        return;
      }

      // --- All other messages: route to store ---
      const shouldPersist =
        msg.kind !== 'complete'
        && msg.kind !== 'status'
        && msg.kind !== 'permission_request'
        && msg.kind !== 'permission_cancelled';

      if (sid && shouldPersist) {
        sessionStore.appendRealtime(sid, msg as unknown as NormalizedMessage);
      }

      // --- UI side effects for specific kinds ---
      switch (msg.kind) {
        case 'complete': {
          // Flush any remaining streaming state
          if (streamTimerRef.current) {
            clearTimeout(streamTimerRef.current);
            streamTimerRef.current = null;
          }
          if (sid && accumulatedStreamRef.current) {
            sessionStore.updateStreaming(sid, accumulatedStreamRef.current, provider);
            sessionStore.finalizeStreaming(sid);
          }
          accumulatedStreamRef.current = '';

          // `complete` is the unified terminal event — every provider run ends
          // with exactly one, regardless of success, failure, or abort. The
          // indicator derives from the processing map, so deleting the entry
          // hides it immediately and atomically.
          onSessionIdle?.(sid);
          if (sid === activeViewSessionId) {
            // Never wipe an unanswered permission prompt just because a turn-level
            // `complete` arrived — that would hide the only way to respond and
            // silently skip the action. An actionable request is removed ONLY by an
            // explicit `permission_cancelled` (server abort/resolve) or by the user
            // answering it. Keep ExitPlanMode too: Grok emits it AFTER the process
            // exits, so complete would otherwise drop the Build/Revise buttons.
            const nextPending = pendingPermissionRequestsRef.current.filter(
              (request) => (
                isActionablePermissionRequest(request)
                || request.toolName === 'ExitPlanMode'
                || request.toolName === 'exit_plan_mode'
              ),
            );
            pendingPermissionRequestsRef.current = nextPending;
            setPendingPermissionRequests(nextPending);
          }

          if (msg.aborted) {
            // Abort was requested — the complete event confirms it. No
            // further UI action is needed beyond clearing the entry above.
            break;
          }

          // Celebrate only successful runs (failed runs end with success: false).
          if (msg.success !== false) {
            showCompletionTitleIndicator();
            void playChatCompletionSound();
          }

          // The session id is stable for the whole conversation (allocated
          // before the first send), so the only follow-up is syncing the
          // viewed conversation with the now-persisted transcript.
          if (sid && sid === activeViewSessionId) {
            void sessionStore.refreshFromServer(sid).then((slot) => {
              // The final totals land in the transcript after `complete`; the
              // last live budget event may predate them.
              if (slot?.tokenUsage && sid === activeViewSessionIdRef.current) {
                setTokenBudget(slot.tokenUsage as Record<string, unknown>);
              }
            });
            // Grok's composer chip reads the disk snapshot, not the stream.
            // Wait a beat so turn_completed lands in updates.jsonl first.
            window.setTimeout(() => {
              if (sid === activeViewSessionIdRef.current) {
                void refreshTokenUsage?.();
              }
            }, 400);
          }

          break;
        }

        // 'error' is an informational message row, not a terminal event —
        // providers emit it for mid-run stderr output too. Run teardown is
        // always signalled by the unified 'complete' that follows.

        case 'permission_request': {
          if (!msg.requestId) break;
          if (isActionablePermissionRequest({ toolName: msg.toolName })) {
            void playNotificationSound();
          }

          if (sid === activeViewSessionId) {
            const previousPendingPermissionRequests = pendingPermissionRequestsRef.current;
            if (!previousPendingPermissionRequests.some((request) => request.requestId === msg.requestId)) {
              const nextPendingPermissionRequests = [...previousPendingPermissionRequests, {
                requestId: msg.requestId as string,
                toolName: (msg.toolName as string) || 'UnknownTool',
                input: msg.input,
                context: msg.context,
                sessionId: sid || null,
                receivedAt: new Date(),
              }];

              pendingPermissionRequestsRef.current = nextPendingPermissionRequests;
              setPendingPermissionRequests(nextPendingPermissionRequests);
            }
          }
          if (sid) {
            onSessionProcessing?.(sid);
          }
          break;
        }

        case 'permission_cancelled': {
          if (msg.requestId && sid === activeViewSessionId) {
            const nextPendingPermissionRequests = pendingPermissionRequestsRef.current.filter(
              (request: PendingPermissionRequest) => request.requestId !== msg.requestId,
            );

            pendingPermissionRequestsRef.current = nextPendingPermissionRequests;
            setPendingPermissionRequests(nextPendingPermissionRequests);
          }
          break;
        }

        case 'status': {
          if (msg.text === 'token_budget' && msg.tokenBudget) {
            // Budget updates stream from every running session; only the one
            // being viewed may drive the composer counter, otherwise numbers
            // from background runs "jump" into the current chat.
            if (sid === activeViewSessionId) {
              const incoming = msg.tokenBudget as Record<string, unknown>;
              setTokenBudget((prev) => {
                if (!prev) {
                  return incoming;
                }
                const nextUsed = Number(incoming.used);
                const nextTotal = Number(incoming.total);
                const nextIn = Number(incoming.inputTokens);
                const nextOut = Number(incoming.outputTokens);
                const prevIn = Number(prev.inputTokens);
                const prevOut = Number(prev.outputTokens);
                return {
                  ...prev,
                  ...incoming,
                  used: nextUsed > 0 ? nextUsed : prev.used,
                  total: nextTotal > 0 ? nextTotal : prev.total,
                  inputTokens: nextIn > prevIn ? nextIn : prev.inputTokens,
                  outputTokens: nextOut > prevOut ? nextOut : prev.outputTokens,
                };
              });
            }
          } else if (msg.text && sid) {
            onSessionProcessing?.(sid, {
              statusText: msg.text as string,
              canInterrupt: msg.canInterrupt !== false,
            });
          }
          break;
        }

        case 'thinking':
          if (sid) {
            onSessionProcessing?.(sid, { activityKind: 'thinking', toolName: null });
          }
          break;

        case 'tool_use':
          if (sid) {
            onSessionProcessing?.(sid, {
              activityKind: 'tools',
              toolName: typeof msg.toolName === 'string' && msg.toolName.trim()
                ? msg.toolName
                : null,
            });
          }
          break;

        // text, tool_result, interactive_prompt, task_notification
        // → already routed to store above, no UI side effects needed
        default:
          break;
      }
    };

    return subscribe(handleEvent);
  }, [
    subscribe,
    provider,
    selectedSession,
    currentSessionId,
    setTokenBudget,
    refreshTokenUsage,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    streamTimerRef,
    accumulatedStreamRef,
    lastSeqRef,
    statusCheckSentAtRef,
    onSessionProcessing,
    onSessionIdle,
    onWebSocketReconnect,
    sessionStore,
  ]);
}
