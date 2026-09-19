import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent, RefObject } from 'react';

import { safeLocalStorage } from '../utils/chatStorage';

/**
 * Shell-style input history for the composer: ArrowUp in an empty textarea
 * recalls messages previously sent in this chat (newest first), ArrowDown
 * walks forward again and finally restores whatever draft was in the box
 * before recall.
 *
 * History is kept per chat scope — a session id, or `project:<id>` before one
 * exists — so recall only ever surfaces what was typed in the conversation
 * being looked at. It is a browser-local convenience (localStorage),
 * deliberately not synced: what you retype on one device is rarely what you
 * typed on another, and the transcript already travels.
 *
 * Ported from siteboon/claudecodeui #1238 (8f9a2e4) onto this fork's
 * `src/components/chat` layout. The upstream commit lives under
 * `src/modules/chat` after their 702-file #1206 move, which we did not take.
 */

export const INPUT_HISTORY_STORAGE_KEY = 'chat-input-history';
const MAX_ENTRIES_PER_SCOPE = 100;
/** Scopes beyond this are evicted oldest-written-first, so storage cannot grow with every session ever opened. */
const MAX_SCOPES = 100;

type HistoryStore = Record<string, string[]>;

export type HistoryNav = {
  history: string[];
  index: number;
  draft: string;
  recalled: string;
};

function readHistoryStore(): HistoryStore {
  const raw = safeLocalStorage.getItem(INPUT_HISTORY_STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const store: HistoryStore = {};
    for (const [scope, entries] of Object.entries(parsed)) {
      if (Array.isArray(entries)) {
        store[scope] = entries.filter((entry): entry is string => typeof entry === 'string');
      }
    }
    return store;
  } catch {
    return {};
  }
}

export function readInputHistory(scope: string | null): string[] {
  if (!scope) {
    return [];
  }
  return readHistoryStore()[scope] ?? [];
}

export function appendInputHistory(scope: string, text: string): void {
  const store = readHistoryStore();
  const entries = store[scope] ?? [];
  if (entries[entries.length - 1] === text) {
    return;
  }
  delete store[scope];
  store[scope] = [...entries, text].slice(-MAX_ENTRIES_PER_SCOPE);
  const scopes = Object.keys(store);
  for (const stale of scopes.slice(0, Math.max(0, scopes.length - MAX_SCOPES))) {
    delete store[stale];
  }
  safeLocalStorage.setItem(INPUT_HISTORY_STORAGE_KEY, JSON.stringify(store));
}

export type HistoryKeyEvent = {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  value: string;
};

export type HistoryKeyResult = {
  handled: boolean;
  preventDefault: boolean;
  nav: HistoryNav | null;
  nextInput?: string;
};

export function applyHistoryKey(
  event: HistoryKeyEvent,
  nav: HistoryNav | null,
  scope: string | null,
): HistoryKeyResult {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return { handled: false, preventDefault: false, nav };
  }
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
    return { handled: false, preventDefault: false, nav };
  }

  const value = event.value;
  const untouched = nav !== null && value === nav.recalled;

  if (event.key === 'ArrowUp') {
    if (value !== '' && !untouched) {
      return { handled: false, preventDefault: false, nav };
    }
    const history = untouched && nav ? nav.history : readInputHistory(scope);
    if (history.length === 0) {
      return { handled: false, preventDefault: false, nav };
    }
    if (untouched && nav && nav.index === 0) {
      return { handled: true, preventDefault: true, nav };
    }
    const index = untouched && nav ? nav.index - 1 : history.length - 1;
    const draft = untouched && nav ? nav.draft : value;
    const recalled = history[index];
    return {
      handled: true,
      preventDefault: true,
      nav: { history, index, draft, recalled },
      nextInput: recalled,
    };
  }

  if (!untouched || !nav) {
    return { handled: false, preventDefault: false, nav };
  }
  if (nav.index >= nav.history.length - 1) {
    return {
      handled: true,
      preventDefault: true,
      nav: null,
      nextInput: nav.draft,
    };
  }
  const index = nav.index + 1;
  const recalled = nav.history[index];
  return {
    handled: true,
    preventDefault: true,
    nav: { history: nav.history, index, draft: nav.draft, recalled },
    nextInput: recalled,
  };
}

type UseInputHistoryOptions = {
  /** Must also sync any send-time mirror (inputValueRef) with the new value. */
  setInput: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** The chat being composed into: a session id, or `project:<id>` before one exists. */
  scope: string | null;
};

export function useInputHistory({ setInput, textareaRef, scope }: UseInputHistoryOptions) {
  const navRef = useRef<HistoryNav | null>(null);
  const scopeRef = useRef(scope);

  useEffect(() => {
    scopeRef.current = scope;
    navRef.current = null;
  }, [scope]);

  const recordSentMessage = useCallback((text: string, scopeOverride?: string | null) => {
    navRef.current = null;
    const targetScope = scopeOverride ?? scopeRef.current;
    if (!targetScope || !text.trim()) {
      return;
    }
    appendInputHistory(targetScope, text);
  }, []);

  const handleHistoryKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      const result = applyHistoryKey(
        {
          key: event.key,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          value: event.currentTarget.value,
        },
        navRef.current,
        scopeRef.current,
      );
      if (!result.handled) {
        return false;
      }
      if (result.preventDefault) {
        event.preventDefault();
      }
      navRef.current = result.nav;
      if (result.nextInput !== undefined) {
        const next = result.nextInput;
        setInput(next);
        requestAnimationFrame(() => {
          textareaRef.current?.setSelectionRange(next.length, next.length);
        });
      }
      return true;
    },
    [setInput, textareaRef],
  );

  return { recordSentMessage, handleHistoryKeyDown };
}
