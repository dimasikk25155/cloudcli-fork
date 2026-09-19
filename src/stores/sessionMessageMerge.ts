/**
 * Merge server transcript + live websocket rows into the chat list.
 *
 * Grok's chat_history.jsonl has no per-event clocks, so the history reader
 * stamps every row with parse time (`now()`). Sorting that against the live
 * stream (which started earlier) put the answer above the user bubble.
 */

import { isStopHookFeedbackText, stripAttachmentDisplayTags } from '../components/chat/utils/chatFormatting';

import type { NormalizedMessage } from './useSessionStore';

const LOCAL_USER_DEDUPE_CLOCK_SKEW_MS = 10_000;

function userTextFingerprint(m: NormalizedMessage): string | null {
  if (m.kind !== 'text' || m.role !== 'user') return null;
  const t = stripAttachmentDisplayTags(m.content || '').trim();
  return t.length > 0 ? t : null;
}

export function isStopHookUserMessage(message: NormalizedMessage): boolean {
  return message.kind === 'text'
    && message.role === 'user'
    && isStopHookFeedbackText(message.content || '');
}

export function dropStopHookUserMessages(messages: NormalizedMessage[]): NormalizedMessage[] {
  return messages.filter((message) => !isStopHookUserMessage(message));
}

function readMessageTime(m: NormalizedMessage): number | null {
  const time = Date.parse(m.timestamp);
  return Number.isFinite(time) ? time : null;
}

function lastUserIndex(serverMessages: NormalizedMessage[]): number {
  for (let index = serverMessages.length - 1; index >= 0; index -= 1) {
    if (userTextFingerprint(serverMessages[index])) {
      return index;
    }
  }
  return -1;
}

/**
 * Same last-user text is an echo when the disk stamp is this send (or a
 * later Grok interpolation toward file mtime). A 5-minute cap treated a
 * long turn as a *new* prompt and appended the bubble under the answer.
 * A new send of the same text is later than the previous turn's stamp.
 */
function isLocalEchoOfServerUser(localTime: number, serverTime: number, provider: string): boolean {
  // Codex records acceptance after the browser sends the prompt. Applying
  // Grok's synthetic-clock tolerance here swallowed a second identical prompt
  // sent within ten seconds of the previous persisted user row.
  const skew = provider === 'codex' ? 0 : LOCAL_USER_DEDUPE_CLOCK_SKEW_MS;
  return serverTime >= localTime - skew;
}

function hasServerEchoForLocalUser(
  localMessage: NormalizedMessage,
  serverMessages: NormalizedMessage[],
): boolean {
  const localText = userTextFingerprint(localMessage);
  const localTime = readMessageTime(localMessage);
  if (!localText || localTime === null) {
    return false;
  }

  // Only the last user turn can be an echo of the bubble we just sent.
  // Matching *any* same-text row ate a new "привет" when Grok restamped the
  // whole history with `now()` — the old greeting looked fresh, the local
  // copy vanished, and the leftover bubble sat at the top of the thread.
  const index = lastUserIndex(serverMessages);
  if (index < 0) {
    return false;
  }
  if (userTextFingerprint(serverMessages[index]) !== localText) {
    return false;
  }

  const after = serverMessages.slice(index + 1);
  const hasAnswerAfter = after.some((message) => (
    message.kind === 'text'
    && message.role === 'assistant'
    && Boolean((message.content || '').trim())
  ));
  if (!hasAnswerAfter && localMessage.provider !== 'codex') {
    return true;
  }

  const serverTime = readMessageTime(serverMessages[index]);
  return serverTime !== null && isLocalEchoOfServerUser(localTime, serverTime, localMessage.provider);
}

const MIN_PREFIX_MATCH_CHARS = 20;
const MIN_CROSS_TURN_ECHO_CHARS = 80;

/**
 * Growing stream vs disk snapshot often differs only by a missing newline
 * (`Music.Жми` vs `Music.\nЖми`). Collapse those to one fingerprint.
 */
function assistantFingerprint(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*([.,:;!?—–-])\s*/g, '$1')
    .toLowerCase();
}

/**
 * Same chat bubble, including a growing stream vs the snapshot already on disk.
 * Short strings stay exact-match only so "Да" does not swallow the next sentence.
 */
function isSameAssistantBubble(a: string, b: string): boolean {
  const left = assistantFingerprint(a);
  const right = assistantFingerprint(b);
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (shorter.length < MIN_PREFIX_MATCH_CHARS) {
    return false;
  }
  return longer.startsWith(shorter);
}

function isLongAssistantEcho(text: string): boolean {
  return assistantFingerprint(text).length >= MIN_CROSS_TURN_ECHO_CHARS;
}

/**
 * Count how many user turns precede `message` in server-then-realtime order.
 * Used to match a realtime row to the correct turn on disk when several turns
 * share identical assistant text. Do not sort by wall clock: Grok history
 * stamps every row with parse time, which is later than the live stream.
 */
function getUserTurnOrdinalBefore(
  message: NormalizedMessage,
  serverMessages: NormalizedMessage[],
  realtimeMessages: NormalizedMessage[],
): number {
  let userCount = 0;

  for (const candidate of [...serverMessages, ...realtimeMessages]) {
    if (candidate.id === message.id) {
      break;
    }

    if (candidate.kind === 'text' && candidate.role === 'user') {
      // Optimistic local echo is the same turn as the disk user row.
      // Counting it as a second user made live assistant text look like the
      // *next* turn, so prune left the duplicate pack on screen.
      if (candidate.id.startsWith('local_') && hasServerEchoForLocalUser(candidate, serverMessages)) {
        continue;
      }
      userCount++;
    }
  }

  return Math.max(0, userCount - 1);
}

function findServerTurnRangeByOrdinal(
  serverMessages: NormalizedMessage[],
  turnOrdinal: number,
): { start: number; end: number } | null {
  let userCount = -1;
  let start = -1;

  for (let index = 0; index < serverMessages.length; index++) {
    const message = serverMessages[index];
    if (message.kind === 'text' && message.role === 'user') {
      userCount++;
      if (userCount === turnOrdinal) {
        start = index;
        break;
      }
    }
  }

  if (start < 0) {
    return null;
  }

  let end = serverMessages.length;
  for (let index = start + 1; index < serverMessages.length; index++) {
    if (serverMessages[index].kind === 'text' && serverMessages[index].role === 'user') {
      end = index;
      break;
    }
  }

  return { start, end };
}

function isAssistantTextEchoedInSameTurnOnServer(
  message: NormalizedMessage,
  serverMessages: NormalizedMessage[],
  realtimeMessages: NormalizedMessage[],
): boolean {
  const assistantText = (message.content || '').trim();
  if (!assistantText) {
    return false;
  }

  const turnOrdinal = getUserTurnOrdinalBefore(message, serverMessages, realtimeMessages);
  const turnRange = findServerTurnRangeByOrdinal(serverMessages, turnOrdinal);
  if (!turnRange) {
    return false;
  }

  return serverMessages
    .slice(turnRange.start + 1, turnRange.end)
    .some((serverMessage) => isEqualOrShorterAssistantEcho(serverMessage, assistantText));
}

/**
 * Leftover live / replayed rows of the *previous* answer often land *after*
 * the next prompt (queued send, lastSeq replay, history reread). Same-turn
 * matching misses them, so the user sees: full answer, new bubble, truncated copy.
 */
function isAssistantTextAlreadyOnServer(
  message: NormalizedMessage,
  serverMessages: NormalizedMessage[],
): boolean {
  const assistantText = (message.content || '').trim();
  if (!isLongAssistantEcho(assistantText)) {
    return false;
  }

  return serverMessages.some((serverMessage) => isEqualOrShorterAssistantEcho(serverMessage, assistantText));
}

function isEqualOrShorterAssistantEcho(serverMessage: NormalizedMessage, assistantText: string): boolean {
  if (
    serverMessage.kind !== 'text'
    || serverMessage.role !== 'assistant'
    || !isSameAssistantBubble(serverMessage.content || '', assistantText)
  ) {
    return false;
  }
  // Disk often has a prefix while the live bubble is still growing.
  // Dropping the longer live row would freeze the answer on the snapshot.
  return assistantFingerprint(assistantText).length
    <= assistantFingerprint(serverMessage.content || '').length;
}

function isAssistantLike(message: NormalizedMessage): boolean {
  return message.kind === 'stream_delta'
    || (message.kind === 'text' && message.role === 'assistant');
}

/**
 * Collapse the same assistant bubble / tool card inside one user turn.
 *
 * Adjacent-only collapse was not enough: Grok history ids never match live
 * ids (`grok_hist_*` vs stream uuids), so a mid-turn REST fetch or a
 * `chat.subscribe` replay with lastSeq=0 concatenates the whole pack again
 * *after* the disk copy. The user sees A,B,C,D then A,B,C,D then E.
 */
function dedupeEchoesInTurn(merged: NormalizedMessage[]): NormalizedMessage[] {
  const out: NormalizedMessage[] = [];
  let seenAssistant: Array<{ index: number; content: string }> = [];
  let previousTurnAssistant: string[] = [];
  const seenTools = new Set<string>();

  for (const message of merged) {
    if (message.kind === 'text' && message.role === 'user') {
      previousTurnAssistant = seenAssistant.map((seen) => seen.content);
      seenAssistant = [];
      out.push(message);
      continue;
    }

    if ((message.kind === 'tool_use' || message.kind === 'tool_result') && message.toolId) {
      const key = `${message.kind}:${message.toolId}`;
      if (seenTools.has(key)) {
        continue;
      }
      seenTools.add(key);
      out.push(message);
      continue;
    }

    if (isAssistantLike(message)) {
      const content = (message.content || '').trim();
      if (content) {
        const matchIndex = seenAssistant.findIndex((seen) => isSameAssistantBubble(seen.content, content));
        if (matchIndex >= 0) {
          const previous = seenAssistant[matchIndex];
          if (content.length > previous.content.length) {
            out[previous.index] = message;
            seenAssistant[matchIndex] = { index: previous.index, content };
          }
          continue;
        }
        // Previous turn's answer replayed after the next prompt.
        const leftover = previousTurnAssistant.find((previous) => isSameAssistantBubble(previous, content));
        if (
          leftover
          && isLongAssistantEcho(content)
          && assistantFingerprint(content).length <= assistantFingerprint(leftover).length
        ) {
          continue;
        }
        seenAssistant.push({ index: out.length, content });
      }
      out.push(message);
      continue;
    }

    out.push(message);
  }

  return out;
}

/**
 * After a server refresh, drop only the realtime rows the persisted transcript
 * already owns. Anything not yet on disk (common right after `complete`, while
 * JSONL indexing lags) stays in `realtimeMessages` so the chat pane never
 * flashes the empty "Continue your conversation" state.
 */
export function pruneRealtimeSupersededByServer(
  serverMessages: NormalizedMessage[],
  realtimeMessages: NormalizedMessage[],
): NormalizedMessage[] {
  if (realtimeMessages.length === 0) {
    return realtimeMessages;
  }

  const serverIds = new Set(serverMessages.map((message) => message.id));

  return realtimeMessages.filter((message) => {
    if (serverIds.has(message.id)) {
      return false;
    }

    if (message.id.startsWith('local_') && hasServerEchoForLocalUser(message, serverMessages)) {
      return false;
    }

    if (message.kind === 'stream_delta' || message.id === `__streaming_${message.sessionId}`) {
      if (
        isAssistantTextEchoedInSameTurnOnServer(message, serverMessages, realtimeMessages)
        || isAssistantTextAlreadyOnServer(message, serverMessages)
      ) {
        return false;
      }
      return true;
    }

    if (message.kind === 'text' && message.role === 'assistant') {
      if (
        isAssistantTextEchoedInSameTurnOnServer(message, serverMessages, realtimeMessages)
        || isAssistantTextAlreadyOnServer(message, serverMessages)
      ) {
        return false;
      }
      return true;
    }

    if (message.kind === 'text' && message.role === 'user') {
      return !hasServerEchoForLocalUser(message, serverMessages);
    }

    if (message.kind === 'tool_use' && message.toolId) {
      if (serverMessages.some((serverMessage) => serverMessage.kind === 'tool_use' && serverMessage.toolId === message.toolId)) {
        return false;
      }
    }

    return true;
  });
}

export function computeMerged(server: NormalizedMessage[], realtime: NormalizedMessage[]): NormalizedMessage[] {
  if (realtime.length === 0) {
    return dedupeEchoesInTurn(server);
  }
  if (server.length === 0) {
    return dedupeEchoesInTurn(realtime);
  }

  const serverIds = new Set(server.map((message) => message.id));
  const extra = realtime.filter((message) => {
    if (serverIds.has(message.id)) {
      return false;
    }
    // Optimistic user rows use `local_*` ids; once the same text exists on the
    // server-backed copy from the same send window, drop the realtime echo to
    // avoid duplicate bubbles without hiding repeated prompts from history.
    if (message.id.startsWith('local_')) {
      if (hasServerEchoForLocalUser(message, server)) {
        return false;
      }
    }
    return true;
  });

  if (extra.length === 0) {
    return dedupeEchoesInTurn(server);
  }

  // Keep disk order and append live rows the transcript does not own yet.
  // Sorting by timestamp used to put the live Grok answer *before* the user
  // bubble: chat_history.jsonl has no clocks, so every history row is stamped
  // `now()` on parse — later than the stream that already started.
  const merged = [...server];
  for (const message of extra) {
    // Codex has real per-record timestamps. If an older history reader (or
    // a partial page) omits the prompt, keep the optimistic row before its
    // persisted answer. Never apply this to Grok's synthetic parse clocks.
    if (message.provider === 'codex' && message.kind === 'text' && message.role === 'user') {
      const time = readMessageTime(message);
      const nextIndex = time === null ? -1 : merged.findIndex((candidate) => {
        const candidateTime = readMessageTime(candidate);
        return candidate.provider === 'codex' && candidateTime !== null && candidateTime > time;
      });
      if (nextIndex >= 0) {
        merged.splice(nextIndex, 0, message);
        continue;
      }
    }
    merged.push(message);
  }
  return dedupeEchoesInTurn(merged);
}
