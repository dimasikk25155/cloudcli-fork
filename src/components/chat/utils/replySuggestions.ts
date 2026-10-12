/**
 * Reply chips over the composer — the client half. The server decides whether
 * a turn deserves chips (question / request at the end) and generates them;
 * the client only knows which reply they belong to and when to hide them.
 */

import { lastReplyTurn, type ReplyTurnMessage } from '../../../../shared/reply-turn';

/**
 * Text of the reply the chips belong to, picked from the normalized store
 * messages by the same rule the server uses (shared/reply-turn.ts) — so the
 * fingerprint the client sends matches the server's. Null once the user has
 * written after the reply.
 */
export function replyForChips(messages: ReplyTurnMessage[]): string | null {
  return lastReplyTurn(messages)?.assistant ?? null;
}

export type ReplySuggestionsAnswer = { suggestions: string[]; stale: boolean };

/**
 * Asks for chips; while the server says its transcript has not caught up with
 * the reply on screen (`stale`), asks again a few times with a pause. A result
 * that is still stale must not be cached as "no chips" for this reply.
 */
export async function requestReplySuggestions(
  fetchOnce: () => Promise<{ suggestions?: unknown; stale?: unknown }>,
  options: { attempts: number; delayMs: number; sleep?: (ms: number) => Promise<void>; isCancelled?: () => boolean },
): Promise<ReplySuggestionsAnswer> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    const body = await fetchOnce();
    if (body?.stale !== true) {
      const suggestions = Array.isArray(body?.suggestions)
        ? body.suggestions.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [];
      return { suggestions, stale: false };
    }
    if (attempt === options.attempts || options.isCancelled?.()) {
      break;
    }
    await sleep(options.delayMs);
    if (options.isCancelled?.()) {
      break;
    }
  }
  return { suggestions: [], stale: true };
}

/** Decision 17: chips come as a choice of 2–3; a single one is not shown. */
export const MIN_REPLY_CHIPS = 2;

export type ReplyChipsVisibility = {
  suggestions: string[];
  input: string;
  isLoading: boolean;
  /** Any question / permission / plan prompt waiting — that panel is the answer path then. */
  hasPendingPermission: boolean;
  hasQueuedDraft: boolean;
};

export function shouldShowReplyChips(state: ReplyChipsVisibility): boolean {
  return (
    state.suggestions.length >= MIN_REPLY_CHIPS
    && state.input.trim().length === 0
    && !state.isLoading
    && !state.hasPendingPermission
    && !state.hasQueuedDraft
  );
}
