/**
 * Reply chips over the composer — the client half. The server decides whether
 * a turn deserves chips (question / request at the end) and generates them;
 * the client only knows which reply they belong to and when to hide them.
 */

import type { ChatMessage } from '../types/types';

function isReplyText(message: ChatMessage): boolean {
  return (
    message.type === 'assistant'
    && !message.isToolUse
    && !message.isThinking
    && typeof message.content === 'string'
    && message.content.trim().length > 0
  );
}

/** Text of the last assistant reply, or null once the user has written after it. */
export function lastAssistantReply(messages: ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.type === 'user') {
      return null;
    }
    if (isReplyText(message)) {
      return (message.content as string).trim();
    }
  }
  return null;
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
