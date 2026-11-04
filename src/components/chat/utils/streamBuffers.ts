/**
 * Live stream text of a chat, buffered per session.
 *
 * One page can show two chats at once (the chat and «Второй чат» on the
 * canvas), and each ChatInterface hears every frame of the shared socket. A
 * single buffer per instance glued the deltas of both runs into one bubble and
 * let `complete` of one chat cut the other's text. Each session now has its
 * own text and its own flush timer.
 */

type TimerHandle = unknown;

export type StreamBuffers = {
  /** Adds a delta; the first one schedules `onFlush(sessionId, textSoFar)` after the delay. */
  append: (sessionId: string, text: string, onFlush: (sessionId: string, text: string) => void) => void;
  /** Ends the session's buffer: cancels its pending flush and returns the text ('' if none). */
  take: (sessionId: string) => string;
  /** Drops one session's buffer, or all of them without an id. */
  reset: (sessionId?: string | null) => void;
};

type StreamBuffersOptions = {
  schedule?: (fn: () => void, delayMs: number) => TimerHandle;
  cancel?: (handle: TimerHandle) => void;
  delayMs?: number;
};

const STREAM_FLUSH_MS = 100;

export function createStreamBuffers({
  schedule = (fn, delayMs) => setTimeout(fn, delayMs),
  cancel = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  delayMs = STREAM_FLUSH_MS,
}: StreamBuffersOptions = {}): StreamBuffers {
  const entries = new Map<string, { text: string; timer: TimerHandle | null }>();

  const drop = (sessionId: string) => {
    const entry = entries.get(sessionId);
    if (!entry) return '';
    if (entry.timer !== null) cancel(entry.timer);
    entries.delete(sessionId);
    return entry.text;
  };

  return {
    append(sessionId, text, onFlush) {
      let entry = entries.get(sessionId);
      if (!entry) {
        entry = { text: '', timer: null };
        entries.set(sessionId, entry);
      }
      entry.text += text;
      if (entry.timer === null) {
        const owner = entry;
        owner.timer = schedule(() => {
          owner.timer = null;
          onFlush(sessionId, owner.text);
        }, delayMs);
      }
    },
    take: drop,
    reset(sessionId) {
      if (sessionId) {
        drop(sessionId);
        return;
      }
      [...entries.keys()].forEach(drop);
    },
  };
}

/**
 * `chat_subscribed` answers a `chat.subscribe`. Every chat on the page hears
 * every ack; only the one that sent the subscribe may act on it — otherwise
 * the other chat's idle ack switched this chat's «Стоп» off mid-run.
 */
export function shouldHandleSubscribedAck(sentAt: ReadonlyMap<string, number>, sessionId: string | null | undefined): boolean {
  return Boolean(sessionId) && sentAt.has(sessionId as string);
}
