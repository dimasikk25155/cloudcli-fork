import { answerHash, type RunDurationRow } from '@/modules/database/index.js';
import type { NormalizedMessage } from '@/shared/types.js';

/** Attach measured durations to final answers, never infer time from transcript gaps.
 * Receives the full transcript before pagination so an older page cannot mistake
 * a progress message or a repeated short answer for the final response.
 */
export function attachRunDurations(messages: NormalizedMessage[], runs: RunDurationRow[]): NormalizedMessage[] {
  const result = [...messages];
  const candidates = messages.flatMap((message, index) =>
    message.kind === 'text' && message.role === 'assistant' && !message.parentToolUseId
      && message.content?.trim() && !message.isCompactSummary && !message.isLocalCommand
      ? [{ index, message, hash: answerHash(message.content), time: Date.parse(message.timestamp) }] : []);
  for (const run of runs) {
    if (!Number.isFinite(run.duration_ms) || run.duration_ms < 0) continue;
    const matches = candidates.filter(({ message, hash, time }) => hash === run.answer_hash
      && (message.provider === 'grok' || (time >= run.started_at && time <= run.finished_at)));
    // Grok history clocks are synthetic. Only an unambiguous answer fingerprint
    // is safe; repeated identical replies are deliberately left unlabelled.
    if (matches[0]?.message.provider === 'grok'
      && (matches.length !== 1 || runs.filter(other => other.answer_hash === run.answer_hash).length !== 1)) continue;
    const match = matches.at(-1);
    if (match) {
      result[match.index] = {
        ...match.message,
        completionDurationMs: run.duration_ms,
        ...(typeof run.thinking_ms === 'number' && Number.isFinite(run.thinking_ms) && run.thinking_ms >= 0
          ? { thinkingDurationMs: run.thinking_ms } : {}),
      };
    }
  }
  return result;
}

const THINKING_BLOCK_TYPES = new Set(['thinking', 'redacted_thinking']);

/**
 * «Время размышления» for engines that hide the thinking text: Claude Code
 * sends its thinking blocks with an empty text (signature only), and the
 * adapters drop empty thinking. The run registry still has to see the moment
 * the model finished thinking, so the runtime sends an empty `thinking` event
 * (the chat drops empty thinking rows) when a raw assistant line carried a
 * thinking block that the normalized events do not show.
 */
export function carriesUnshownThinking(raw: unknown, normalized: Array<{ kind?: string }>): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const line = raw as { type?: unknown; message?: { content?: unknown } };
  if (normalized.some((message) => message.kind === 'thinking')) return false;
  // Grok: a reasoning line whose summary is empty (encrypted content only).
  if (line.type === 'reasoning') return true;
  if (line.type !== 'assistant' || !Array.isArray(line.message?.content)) return false;
  return line.message.content.some((part) => Boolean(part) && typeof part === 'object'
    && THINKING_BLOCK_TYPES.has(String((part as { type?: unknown }).type)));
}
