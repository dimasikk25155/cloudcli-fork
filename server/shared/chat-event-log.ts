/**
 * Server journal of chat events: one line per event with the time, so «when
 * was the chat opened, when did the turn end, when did the queue send» is read
 * from the log instead of being guessed (23.11.2026: the log had no times and
 * no `chat.subscribe` at all).
 *
 *   [chat] <ISO time> <event> session=<id> user=<id> key=value …
 *
 * Only numbers, flags and short machine words go into a line. Message text,
 * tokens and anything else free-form never do — see `safeWord`.
 */

export type ChatEventName =
  | 'subscribe'
  | 'send'
  | 'abort'
  | 'run_start'
  | 'run_complete'
  | 'queue_put'
  | 'queue_send'
  | 'queue_hold'
  | 'phase'
  | 'hold_release';

export type ChatEventFields = {
  sessionId: string;
  userId?: string | number | null;
  [key: string]: string | number | boolean | null | undefined;
};

/** Longest machine word a field may carry (`RUN_IN_PROGRESS`, `waiting_helpers`, a uuid). */
const WORD_MAX = 48;
const WORD_RE = /^[A-Za-z0-9_.:-]+$/;
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * A string field is printed only when it is a short machine word. Free text
 * (spaces, Cyrillic, punctuation) and long opaque strings are dropped, so a
 * message or a token handed in by mistake does not reach the log.
 */
function safeWord(value: string): string | null {
  return value.length > 0 && value.length <= WORD_MAX && WORD_RE.test(value) ? value : null;
}

/** Ids are always printed, with anything outside the machine alphabet replaced. */
function safeId(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  return String(value).replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 80) || '-';
}

export function formatChatEvent(event: ChatEventName, fields: ChatEventFields, at: Date = new Date()): string {
  const { sessionId, userId, ...rest } = fields;
  const parts = [`[chat] ${at.toISOString()} ${event}`, `session=${safeId(sessionId)}`, `user=${safeId(userId)}`];
  for (const [key, value] of Object.entries(rest)) {
    if (!KEY_RE.test(key) || value === null || value === undefined) {
      continue;
    }
    if (typeof value === 'number') {
      if (Number.isFinite(value)) parts.push(`${key}=${value}`);
    } else if (typeof value === 'boolean') {
      parts.push(`${key}=${value}`);
    } else if (typeof value === 'string') {
      const word = safeWord(value);
      if (word !== null) parts.push(`${key}=${word}`);
    }
  }
  return parts.join(' ');
}

type ChatEventWriter = (line: string) => void;

const defaultWriter: ChatEventWriter = (line) => { console.log(line); };
let writer: ChatEventWriter = defaultWriter;

/** Tests capture the lines; `null` puts the console back. Returns a restore of the previous writer. */
export function setChatEventWriter(next: ChatEventWriter | null): () => void {
  const previous = writer;
  writer = next ?? defaultWriter;
  return () => { writer = previous; };
}

/** Writes one journal line. Never throws: the journal must not break a chat. */
export function logChatEvent(event: ChatEventName, fields: ChatEventFields): void {
  try {
    writer(formatChatEvent(event, fields));
  } catch {
    // A failing log sink is not the chat's problem.
  }
}
