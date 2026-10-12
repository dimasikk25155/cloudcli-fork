import type { MessageKind } from './useSessionStore';

/**
 * Live websocket kinds that become conversation rows. Everything else on the
 * socket — terminal/status events and app-level gateway frames such as
 * `attention_changed` — must stay out of the store: an unknown frame stored as
 * a row has no id and blanks the whole transcript on the next history merge.
 */
export const CHAT_ROW_KINDS: ReadonlySet<string> = new Set<MessageKind>([
  'text',
  'tool_use',
  'tool_result',
  'thinking',
  'error',
  'session_created',
  'interactive_prompt',
  'task_notification',
]);

