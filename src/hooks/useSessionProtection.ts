import { useCallback, useRef, useState } from 'react';

export type SessionActivityKind = 'thinking' | 'tools';

export interface SessionActivity {
  /** Provider-supplied status line; null renders the default activity label. */
  statusText: string | null;
  /** Live work phase for the composer badge: thinking vs running tools. */
  activityKind: SessionActivityKind | null;
  toolName: string | null;
  canInterrupt: boolean;
  /**
   * When this request was first marked as processing (client clock). Drives
   * the elapsed-time display and the stale `chat_subscribed` idle-ack guard.
   */
  startedAt: number;
}

export type SessionActivityMap = ReadonlyMap<string, SessionActivity>;

export type SessionActivitySnapshot = {
  sessionId: string;
  statusText?: string | null;
  activityKind?: SessionActivityKind | null;
  toolName?: string | null;
  canInterrupt?: boolean;
  startedAt?: number;
};

export type MarkSessionProcessing = (
  sessionId?: string | null,
  activity?: {
    statusText?: string | null;
    activityKind?: SessionActivityKind | null;
    toolName?: string | null;
    canInterrupt?: boolean;
  },
) => void;

export type MarkSessionIdleResult = 'cleared' | 'stale' | 'already_idle';

export type MarkSessionIdle = (
  sessionId?: string | null,
  opts?: { ifStartedBefore?: number },
) => MarkSessionIdleResult;

export type SyncProcessingSessions = (
  sessions: readonly SessionActivitySnapshot[],
) => void;

const LOCAL_ACTIVITY_GRACE_MS = 10_000;

const sessionActivityMapsMatch = (
  left: ReadonlyMap<string, SessionActivity>,
  right: ReadonlyMap<string, SessionActivity>,
): boolean => {
  if (left.size !== right.size) {
    return false;
  }

  for (const [sessionId, leftActivity] of left) {
    const rightActivity = right.get(sessionId);
    if (
      !rightActivity
      || leftActivity.statusText !== rightActivity.statusText
      || leftActivity.activityKind !== rightActivity.activityKind
      || leftActivity.toolName !== rightActivity.toolName
      || leftActivity.canInterrupt !== rightActivity.canInterrupt
      || leftActivity.startedAt !== rightActivity.startedAt
    ) {
      return false;
    }
  }

  return true;
};

/**
 * Single source of truth for which sessions are actively processing a
 * request. Everything the chat UI shows (activity indicator, abort
 * availability, status text) is derived from this map; terminal events
 * (`complete`, abort, an authoritative idle subscribe ack) delete the entry
 * atomically. Session ids are always concrete (allocated before the first
 * send), so entries are keyed by real session ids only.
 */
export function useSessionProtection() {
  const [processingSessions, setProcessingSessions] = useState<Map<string, SessionActivity>>(
    new Map(),
  );
  // Sync mirror for reconnect handlers: React state alone cannot answer
  // "was this session processing?" inside the same tick as an idle ack.
  const processingSessionsRef = useRef(processingSessions);
  processingSessionsRef.current = processingSessions;

  const markSessionProcessing = useCallback<MarkSessionProcessing>((sessionId, activity) => {
    if (!sessionId) {
      return;
    }

    setProcessingSessions((prev) => {
      const existing = prev.get(sessionId);
      const next: SessionActivity = {
        statusText:
          activity?.statusText !== undefined ? activity.statusText : existing?.statusText ?? null,
        activityKind:
          activity?.activityKind !== undefined ? activity.activityKind : existing?.activityKind ?? null,
        toolName:
          activity?.toolName !== undefined ? activity.toolName : existing?.toolName ?? null,
        canInterrupt: activity?.canInterrupt ?? existing?.canInterrupt ?? true,
        startedAt: existing?.startedAt ?? Date.now(),
      };

      if (
        existing
        && existing.statusText === next.statusText
        && existing.activityKind === next.activityKind
        && existing.toolName === next.toolName
        && existing.canInterrupt === next.canInterrupt
      ) {
        return prev;
      }

      const updated = new Map(prev);
      updated.set(sessionId, next);
      processingSessionsRef.current = updated;
      return updated;
    });
  }, []);

  const markSessionIdle = useCallback<MarkSessionIdle>((sessionId, opts) => {
    if (!sessionId) {
      return 'already_idle';
    }

    const existing = processingSessionsRef.current.get(sessionId);
    if (!existing) {
      return 'already_idle';
    }
    // Guard against stale `chat_subscribed` idle acks: if a new request
    // started after the subscribe was sent, the idle ack describes the
    // older request and must not clear the newer one.
    if (opts?.ifStartedBefore !== undefined && existing.startedAt >= opts.ifStartedBefore) {
      return 'stale';
    }

    setProcessingSessions((prev) => {
      if (!prev.has(sessionId)) {
        return prev;
      }
      const updated = new Map(prev);
      updated.delete(sessionId);
      processingSessionsRef.current = updated;
      return updated;
    });
    return 'cleared';
  }, []);

  const syncProcessingSessions = useCallback<SyncProcessingSessions>((sessions) => {
    const now = Date.now();

    setProcessingSessions((prev) => {
      const incoming = new Map<string, SessionActivitySnapshot>();
      for (const session of sessions) {
        if (!session.sessionId) {
          continue;
        }
        incoming.set(session.sessionId, session);
      }

      const updated = new Map<string, SessionActivity>();

      for (const [sessionId, snapshot] of incoming) {
        const existing = prev.get(sessionId);
        const snapshotStartedAt =
          typeof snapshot.startedAt === 'number' && Number.isFinite(snapshot.startedAt) && snapshot.startedAt > 0
            ? snapshot.startedAt
            : undefined;

        updated.set(sessionId, {
          statusText:
            snapshot.statusText !== undefined ? snapshot.statusText : existing?.statusText ?? null,
          activityKind:
            snapshot.activityKind !== undefined ? snapshot.activityKind : existing?.activityKind ?? null,
          toolName:
            snapshot.toolName !== undefined ? snapshot.toolName : existing?.toolName ?? null,
          canInterrupt: snapshot.canInterrupt ?? existing?.canInterrupt ?? true,
          startedAt: snapshotStartedAt ?? existing?.startedAt ?? now,
        });
      }

      for (const [sessionId, activity] of prev) {
        if (!incoming.has(sessionId) && now - activity.startedAt < LOCAL_ACTIVITY_GRACE_MS) {
          updated.set(sessionId, activity);
        }
      }

      if (sessionActivityMapsMatch(prev, updated)) {
        return prev;
      }
      processingSessionsRef.current = updated;
      return updated;
    });
  }, []);

  return {
    processingSessions,
    markSessionProcessing,
    markSessionIdle,
    syncProcessingSessions,
  };
}
