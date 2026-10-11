/**
 * "Нужен ответ" push identifiers. No imports on purpose: both the
 * notification orchestrator and attention-push read them from here, so the
 * two modules never import each other in a cycle.
 */

export const ATTENTION_PUSH_CODE = 'attention.waiting';

/** One tag per session: a new question replaces the old push, the close removes it. */
export function attentionPushTag(sessionId: string): string {
  return `attention:${sessionId}`;
}
