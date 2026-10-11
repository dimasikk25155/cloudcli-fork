/**
 * Single owner of `document.title`.
 *
 * The title is composed from three independent parts so none of them can wipe
 * another: the attention counter «(N) » ("Ждут тебя"), the transient
 * `[Done]` completion marker, and the base title (project name + app name).
 * Writers update only their part through the setters below.
 */

const COMPLETION_TITLE_INDICATOR = '[Done]';
const TITLE_INDICATOR_CLEAR_DELAY_MS = 2000;
const DEFAULT_BASE_TITLE = 'Neo3 Agent System';

type TitleParts = { base: string; count: number; done: boolean };

const parts: TitleParts = { base: '', count: 0, done: false };

let clearTimer: number | null = null;
let returnListenersAttached = false;

/** Pure title composition: «(N) » only when N > 0, then `[Done] `, then the base. */
export function composePageTitle({ base, count, done }: TitleParts): string {
  const counter = count > 0 ? `(${count}) ` : '';
  const marker = done ? `${COMPLETION_TITLE_INDICATOR} ` : '';
  return `${counter}${marker}${base || DEFAULT_BASE_TITLE}`;
}

const hasDocument = (): boolean => typeof document !== 'undefined' && document !== null;

const render = (): void => {
  if (!hasDocument()) {
    return;
  }
  document.title = composePageTitle(parts);
};

/** Project/app part of the title (set when the selected project changes). */
export const setPageBaseTitle = (base: string): void => {
  parts.base = base;
  render();
};

/** Attention counter N (waiting + unread failed + unread done). */
export const setPageAttentionCount = (count: number): void => {
  const next = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  if (next === parts.count) {
    return;
  }
  parts.count = next;
  render();
};

const pageIsActive = (): boolean => (
  document.visibilityState === 'visible' && document.hasFocus()
);

const removeReturnListeners = (): void => {
  if (!returnListenersAttached || typeof window === 'undefined') {
    return;
  }

  document.removeEventListener('visibilitychange', handleUserReturn);
  window.removeEventListener('focus', handleUserReturn, true);
  window.removeEventListener('click', handleUserReturn, true);
  returnListenersAttached = false;
};

const clearTitleIndicator = (): void => {
  if (clearTimer !== null) {
    window.clearTimeout(clearTimer);
    clearTimer = null;
  }

  removeReturnListeners();
  removePageInactiveListener();

  if (parts.done) {
    parts.done = false;
    render();
  }
};

const removePageInactiveListener = (): void => {
  document.removeEventListener('visibilitychange', handlePageInactive);
};

const scheduleClear = (): void => {
  if (clearTimer !== null) {
    window.clearTimeout(clearTimer);
  }

  clearTimer = window.setTimeout(() => {
    clearTitleIndicator();
  }, TITLE_INDICATOR_CLEAR_DELAY_MS);

  removePageInactiveListener();
  document.addEventListener('visibilitychange', handlePageInactive, { once: true });
};

function handleUserReturn(): void {
  if (!pageIsActive()) {
    return;
  }

  // Background completions keep the marker indefinitely. A tab click normally
  // surfaces as visibility/focus, while an in-page click is a useful fallback.
  scheduleClear();
}

function handlePageInactive(): void {
  if (document.visibilityState !== 'hidden') {
    return;
  }

  if (clearTimer !== null) {
    window.clearTimeout(clearTimer);
    clearTimer = null;
  }

  if (!returnListenersAttached) {
    document.addEventListener('visibilitychange', handleUserReturn);
    window.addEventListener('focus', handleUserReturn, true);
    window.addEventListener('click', handleUserReturn, true);
    returnListenersAttached = true;
  }
}

export const showCompletionTitleIndicator = (): void => {
  if (!hasDocument() || typeof window === 'undefined') {
    return;
  }

  // No base yet → composePageTitle falls back to the static default. Never
  // re-read document.title: this module wrote it, prefixes and all.
  parts.done = true;
  render();

  if (pageIsActive()) {
    scheduleClear();
    return;
  }

  if (clearTimer !== null) {
    window.clearTimeout(clearTimer);
    clearTimer = null;
  }

  if (!returnListenersAttached) {
    document.addEventListener('visibilitychange', handleUserReturn);
    window.addEventListener('focus', handleUserReturn, true);
    window.addEventListener('click', handleUserReturn, true);
    returnListenersAttached = true;
  }
};
