/** Human-readable wall duration of one completed run. */
export function formatCompletionDuration(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const seconds = total % 60;
  return [hours ? `${hours} ч` : '', minutes ? `${minutes} мин` : '', `${seconds} сек`]
    .filter(Boolean).join(' ');
}

/** «1 мин 3 с»: zero parts are left out; under a second is «<1 с». */
function formatShortDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  if (total < 1) return '<1 с';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const seconds = total % 60;
  return [hours ? `${hours} ч` : '', minutes ? `${minutes} мин` : '', seconds ? `${seconds} с` : '']
    .filter(Boolean).join(' ');
}

const isDuration = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export type AnswerTiming = { completionDurationMs?: number; thinkingDurationMs?: number };

/**
 * «Думал 12 с · ответ за 1 мин 3 с» under an answer («Время размышления»).
 * No measured thinking — only «Ответ за …»; no measured answer — nothing.
 */
export function formatAnswerTiming({ completionDurationMs, thinkingDurationMs }: AnswerTiming): string | null {
  if (!isDuration(completionDurationMs)) return null;
  const answer = formatShortDuration(completionDurationMs);
  return isDuration(thinkingDurationMs)
    ? `Думал ${formatShortDuration(thinkingDurationMs)} · ответ за ${answer}`
    : `Ответ за ${answer}`;
}

/** Timing of one finished turn, as the live `complete` frame reported it. */
export type LiveAnswerTiming = AnswerTiming & { answer: string };

type TimedMessage = {
  kind?: string;
  role?: string;
  content?: string;
  parentToolUseId?: string;
  completionDurationMs?: number;
  thinkingDurationMs?: number;
};

const sameAnswer = (left: string, right: string) =>
  left.trim().replace(/\s+/g, ' ') === right.trim().replace(/\s+/g, ' ');

/**
 * Puts the live timings on their answers: the label shows the moment the turn
 * ends, before (or without) the history re-read that carries it from the
 * server. A message that already has a measured duration keeps it. Returns
 * the input array itself when nothing changes.
 */
export function applyLiveAnswerTimings<T extends TimedMessage>(messages: T[], timings: readonly LiveAnswerTiming[]): T[] {
  if (timings.length === 0) return messages;
  let result: T[] | null = null;
  for (const timing of timings) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = (result ?? messages)[index];
      if (message.kind !== 'text' || message.role !== 'assistant' || message.parentToolUseId
        || !message.content || !sameAnswer(message.content, timing.answer)) continue;
      if (!isDuration(message.completionDurationMs) && isDuration(timing.completionDurationMs)) {
        result ??= [...messages];
        result[index] = {
          ...message,
          completionDurationMs: timing.completionDurationMs,
          ...(isDuration(timing.thinkingDurationMs) ? { thinkingDurationMs: timing.thinkingDurationMs } : {}),
        };
      }
      break;
    }
  }
  return result ?? messages;
}
