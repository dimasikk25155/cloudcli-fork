import { useCallback, useEffect, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import { replyFingerprint } from '../../../../shared/reply-fingerprint';
import { requestReplySuggestions } from '../utils/replySuggestions';

// Give the transcript a moment to land on disk after the turn ends, so the
// server reads the same reply the user is looking at.
const SETTLE_MS = 600;
// Server transcript still shows another reply: ask again this many times.
const STALE_ATTEMPTS = 3;
const STALE_RETRY_MS = 1500;

/** One request. Best effort: any failure is "no chips", never an error on screen. */
async function fetchOnce(
  sessionId: string,
  reply: string,
  signal: AbortSignal,
): Promise<{ suggestions?: unknown; stale?: unknown }> {
  try {
    const response = await authenticatedFetch('/api/reply-suggestions', {
      method: 'POST',
      // The fingerprint ties the chips to the reply on screen: the server
      // answers {stale:true} if its transcript shows a different one.
      body: JSON.stringify({ sessionId, replyHash: replyFingerprint(reply) }),
      signal,
    });
    if (!response.ok) {
      return { suggestions: [] };
    }
    return (await response.json()) as { suggestions?: unknown; stale?: unknown };
  } catch {
    return { suggestions: [] };
  }
}

type Options = {
  sessionId: string | null;
  /** Text of the last assistant reply (null when the user wrote after it). */
  reply: string | null;
  isLoading: boolean;
  /** Composer text: the moment it is non-empty, this reply's chips are gone for good. */
  input: string;
};

/**
 * Chips for the current reply. They belong to one (session, reply) pair:
 * typing, sending, a new turn or another session drops them, and they come
 * back only with the next reply.
 */
export function useReplySuggestions({ sessionId, reply, isLoading, input }: Options) {
  const [state, setState] = useState<{ key: string; suggestions: string[] } | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const key = sessionId && reply ? `${sessionId}\u0000${reply}` : null;
  const isTyping = input.trim().length > 0;

  useEffect(() => {
    if (key && isTyping) {
      setDismissedKey(key);
    }
  }, [key, isTyping]);

  useEffect(() => {
    if (!key || !sessionId || !reply || isLoading || dismissedKey === key) {
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void requestReplySuggestions(() => fetchOnce(sessionId, reply, controller.signal), {
        attempts: STALE_ATTEMPTS,
        delayMs: STALE_RETRY_MS,
        isCancelled: () => controller.signal.aborted,
      }).then(({ suggestions, stale }) => {
        // Still stale: keep nothing under this key, so the next trigger asks again.
        if (!controller.signal.aborted && !stale) {
          setState({ key, suggestions });
        }
      });
    }, SETTLE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key, sessionId, reply, isLoading, dismissedKey]);

  const dismiss = useCallback(() => {
    setDismissedKey(key);
  }, [key]);

  const suggestions =
    state && state.key === key && dismissedKey !== key && !isLoading && !isTyping ? state.suggestions : [];
  return { suggestions, dismiss };
}
