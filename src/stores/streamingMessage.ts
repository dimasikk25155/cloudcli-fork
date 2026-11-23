import type { LLMProvider } from '../types/app';

import type { NormalizedMessage } from './useSessionStore';

/**
 * The live «streaming» bubble of a session. Its time is the SERVER's time of
 * the first portion: the bubble keeps it across flushes, and a tab opened
 * mid-answer (frames replay) no longer stamps the answer with the moment it
 * was opened. No server time at all (old frames) → the browser clock, as before.
 */
export function buildStreamingMessage({
  sessionId,
  text,
  provider,
  existing,
  serverTimestamp,
  now = () => new Date().toISOString(),
}: {
  sessionId: string;
  text: string;
  provider: LLMProvider;
  existing: NormalizedMessage | undefined;
  serverTimestamp: string | undefined;
  now?: () => string;
}): NormalizedMessage {
  const fromServer = serverTimestamp && Number.isFinite(Date.parse(serverTimestamp)) ? serverTimestamp : undefined;
  return {
    id: `__streaming_${sessionId}`,
    sessionId,
    timestamp: existing?.timestamp ?? fromServer ?? now(),
    provider,
    kind: 'stream_delta',
    content: text,
  };
}
