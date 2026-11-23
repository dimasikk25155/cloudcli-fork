import type { QueuedHoldReason } from '../../../../shared/queued-message';

export type QueueTranslate = (key: string, defaultValue: string) => string;

const HOLD_TEXT: Record<Exclude<QueuedHoldReason, 'error'>, { key: string; text: string }> = {
  question: { key: 'input.queue.hold.question', text: 'The agent is waiting for your answer' },
  stopped: { key: 'input.queue.hold.stopped', text: 'The run was stopped' },
  failed: { key: 'input.queue.hold.failed', text: 'The run ended with an error' },
  restart: { key: 'input.queue.hold.restart', text: 'The server was restarted' },
};

/**
 * Why a queued message is NOT going out by itself, in words for a person.
 * `null` = it is not held: it goes out when the turn ends.
 */
export function queuedHoldLabel(
  holdReason: QueuedHoldReason | null,
  lastError: string | null | undefined,
  t: QueueTranslate,
): string | null {
  if (!holdReason) return null;
  if (holdReason === 'error') {
    return lastError?.trim() || t('input.queue.hold.error', 'Could not send');
  }
  const entry = HOLD_TEXT[holdReason];
  return entry ? t(entry.key, entry.text) : null;
}
