import type { IProviderSessions } from '@/shared/interfaces.js';
import type { FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import { createNormalizedMessage, readObjectRecord } from '@/shared/utils.js';

/**
 * Gemini stream/history reader — deliberately minimal until the event shape is
 * confirmed against a real run.
 *
 * `gemini -p ... -o stream-json` writes one JSON object per line, but the
 * concrete event vocabulary could not be established from the shipped bundle
 * (the formatter is a generic `JSON.stringify`, and the type strings found
 * there belong to slash-command results, not stream events). Every Gemini
 * command — including `--list-sessions` — refuses to run until the user has
 * signed in, so no live capture was possible while writing this.
 *
 * Rather than guess a mapping that would quietly drop or mangle messages, this
 * reader passes text through and ignores what it cannot identify. Once a signed
 * -in run is captured, the real per-event mapping and on-disk history reader
 * (~/.gemini/sessions, keyed by project) replace the bodies below; nothing else
 * in the provider has to change.
 */
export class GeminiSessionsProvider implements IProviderSessions {
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) {
      return [];
    }

    // Only assistant-visible text is surfaced for now. Known text carriers are
    // tried in order; anything else (tool calls, usage/result envelopes) is
    // skipped rather than rendered as a raw JSON blob in the transcript.
    const text = this.readText(raw);
    if (!text) {
      return [];
    }

    return [createNormalizedMessage({
      kind: 'stream_delta',
      content: text,
      sessionId,
      provider: 'gemini',
    })];
  }

  private readText(raw: Record<string, unknown>): string | null {
    for (const key of ['content', 'text', 'delta', 'message']) {
      const value = raw[key];
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }
    return null;
  }

  async fetchHistory(_sessionId: string, _options?: FetchHistoryOptions): Promise<FetchHistoryResult> {
    // No on-disk history reader yet — see the class comment. An empty page is
    // the honest answer; it renders as "no messages" instead of a false error.
    return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
  }
}
