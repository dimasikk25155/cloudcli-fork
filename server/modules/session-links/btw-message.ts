/**
 * The first message of a side chat («/btw», «Спросить в стороне»): what Dima
 * asked, then the agent-only `<btw_context>` block with the quoted text and
 * the parent's last answer. The block is cut by `stripAgentOnlyBlocks`
 * wherever a person reads the message (bubbles, sidebar titles).
 */

import type { ReplyTurnMessage } from '../../../shared/reply-turn.js';

/** The whole `<btw_context>…</btw_context>` block, tags included. */
export const BTW_CONTEXT_MAX = 4000;
/** The quote gets at most this much; the parent's answer takes the rest. */
const QUOTE_MAX = 1500;

const OPEN = '<btw_context>';
const CLOSE = '</btw_context>';
const PREAMBLE = 'Это побочный вопрос из другого чата. Тот чат продолжает свою работу — '
  + 'ответь только на этот вопрос и ничего в нём не меняй.';
const QUOTE_LABEL = 'Цитата из основного чата:';
const REPLY_LABEL = 'Последний ответ в основном чате:';

function clip(text: string, max: number): string {
  if (max <= 0) return '';
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…` : trimmed;
}

/** Hidden part of the first message, ≤ BTW_CONTEXT_MAX characters with its tags. */
export function buildBtwContext({ quote, lastReply }: { quote?: string | null; lastReply?: string | null }): string {
  const head = `${OPEN}\n${PREAMBLE}`;
  const tail = `\n${CLOSE}`;
  let budget = BTW_CONTEXT_MAX - head.length - tail.length;

  const parts: string[] = [];
  const quoteText = clip(quote ?? '', Math.min(QUOTE_MAX, budget - QUOTE_LABEL.length - 3));
  if (quoteText) {
    const part = `\n\n${QUOTE_LABEL}\n${quoteText}`;
    parts.push(part);
    budget -= part.length;
  }
  const replyRoom = budget - REPLY_LABEL.length - 3;
  const replyText = clip(lastReply ?? '', replyRoom);
  if (replyText) {
    parts.push(`\n\n${REPLY_LABEL}\n${replyText}`);
  }
  return `${head}${parts.join('')}${tail}`;
}

export function buildBtwFirstMessage(input: { question: string; quote?: string | null; lastReply?: string | null }): string {
  return `${input.question.trim()}\n\n${buildBtwContext(input)}`;
}

/**
 * The parent's last answer, even when Dima has already written after it
 * (the parent may be busy right now — that is the point of a side chat).
 */
export function lastAssistantText(messages: ReplyTurnMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.kind === 'text' && message.role === 'assistant' && typeof message.content === 'string' && message.content.trim()) {
      return message.content.trim();
    }
  }
  return null;
}
