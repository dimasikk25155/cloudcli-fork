/**
 * What the «Ждут тебя» switch hides, and what it must not take away from
 * neighbours. Session statuses are shared data: «Треды» (the bar) and
 * «Таймер кэша» (the newest model output) read them too, so the list keeps
 * loading while any of them is on; only what the person sees goes away.
 */

export type AttentionReaders = {
  /** «Ждут тебя». */
  attention: boolean;
  /** «Треды» — the bar shows each thread's status. */
  threads: boolean;
  /** «Таймер кэша» — counts from the turn-end record. */
  cacheTimer: boolean;
};

/** Load and poll the session statuses at all? */
export function attentionStatusesNeeded(readers: AttentionReaders): boolean {
  return readers.attention || readers.threads || readers.cacheTimer;
}

/** The number for «(N)» in the tab and the app-icon badge; 0 clears both. */
export function attentionCountShown(total: number, attentionOn: boolean): number {
  return attentionOn ? total : 0;
}
