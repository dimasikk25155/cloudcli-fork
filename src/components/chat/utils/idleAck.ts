/**
 * Classify an idle `chat_subscribed` ack after reconnect.
 *
 * Completed runs are not replayed over the websocket: the tail lives in REST
 * history. If the server is already ahead of the last live `seq` this client
 * saw, the run finished while we were disconnected — refresh history and do
 * not pretend the connection died mid-answer.
 */

export const CONNECTION_LOST_MESSAGE =
  '⏹ Связь с сервером оборвалась посреди ответа (часто из‑за рестарта Neo3 — он гасит все параллельные чаты разом). Напиши «продолжи».';

export type IdleAckKind =
  | 'completed_while_disconnected'
  | 'orphaned'
  | 'refresh_gap'
  | 'noop';

export type IdleAckDecision = {
  kind: IdleAckKind;
  /** Clear the local processing indicator. */
  markIdle: boolean;
  /** Re-read persisted history because live events were missed. */
  refreshHistory: boolean;
  /** Surface the "connection dropped" warning. */
  warnOrphaned: boolean;
};

export type IdleAckInput = {
  /**
   * True when this client still thought a run was in flight, after the stale
   * ack guard has been applied (a newer local request is not "in flight"
   * for this ack).
   */
  locallyProcessing: boolean;
  /** Highest live seq this client observed. 0 means no live event yet. */
  knownSeq: number;
  /** Server `chat_subscribed.lastSeq`. Missing/non-numeric = no authority. */
  serverLastSeq?: number | null;
  /**
   * True when a newer request started after this subscribe was sent.
   * The ack describes the older run and must not complete the new one.
   */
  ackIsStale?: boolean;
};

const NOOP: IdleAckDecision = {
  kind: 'noop',
  markIdle: false,
  refreshHistory: false,
  warnOrphaned: false,
};

export function hasSeqGap(knownSeq: number, serverLastSeq: unknown): boolean {
  return typeof serverLastSeq === 'number'
    && Number.isFinite(serverLastSeq)
    && serverLastSeq > knownSeq;
}

/**
 * A subscribe-ack is stale when the local request started at or after the
 * moment `chat.subscribe` was sent: the idle payload describes an older run.
 */
export function isStaleIdleAck(
  startedAt: number | undefined,
  subscribeSentAt: number | undefined,
): boolean {
  return typeof startedAt === 'number'
    && Number.isFinite(startedAt)
    && typeof subscribeSentAt === 'number'
    && Number.isFinite(subscribeSentAt)
    && startedAt >= subscribeSentAt;
}

export function classifyIdleAck(input: IdleAckInput): IdleAckDecision {
  if (input.ackIsStale) {
    return NOOP;
  }

  const seqGap = hasSeqGap(input.knownSeq, input.serverLastSeq);

  if (seqGap) {
    if (input.locallyProcessing) {
      return {
        kind: 'completed_while_disconnected',
        markIdle: true,
        refreshHistory: true,
        warnOrphaned: false,
      };
    }
    return {
      kind: 'refresh_gap',
      markIdle: false,
      refreshHistory: true,
      warnOrphaned: false,
    };
  }

  if (input.locallyProcessing) {
    return {
      kind: 'orphaned',
      markIdle: true,
      refreshHistory: false,
      warnOrphaned: true,
    };
  }

  return NOOP;
}
