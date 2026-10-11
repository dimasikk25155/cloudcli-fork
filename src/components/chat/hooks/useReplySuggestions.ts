import { useCallback, useEffect, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import { replyFingerprint } from '../../../../shared/reply-fingerprint';

// Give the transcript a moment to land on disk after the turn ends, so the
// server reads the same reply the user is looking at.
const SETTLE_MS = 600;

/** Best effort: any failure is "no chips", never an error on screen. */
async function fetchReplySuggestions(sessionId: string, reply: string, signal: AbortSignal): Promise<string[]> {
  try {
    const response = await authenticatedFetch('/api/reply-suggestions', {
      method: 'POST',
      // The fingerprint ties the chips to the reply on screen: the server
      // answers [] if its transcript shows a different one.
      body: JSON.stringify({ sessionId, replyHash: replyFingerprint(reply) }),
      signal,
    });
    if (!response.ok) {
      return [];
    }
    const body = (await response.json()) as { suggestions?: unknown };
    return Array.isArray(body?.suggestions)
      ? body.suggestions.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
  } catch {
    return [];
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
      void fetchReplySuggestions(sessionId, reply, controller.signal).then((suggestions) => {
        if (!controller.signal.aborted) {
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
