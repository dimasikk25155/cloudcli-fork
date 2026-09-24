/**
 * Enter that CONFIRMS an IME candidate must not also submit (upstream #1332).
 *
 * `event.isComposing` alone is not enough: Safari fires `compositionend` BEFORE the confirming
 * Enter's `keydown`, so the flag is already `false` by the time the handler runs. A tight window
 * after `compositionend` covers it — that sequence is synchronous, while a human pressing Enter
 * a second time takes >= 100ms and never lands inside it.
 */
export const SAFARI_IME_RACE_WINDOW_MS = 30;

export interface ImeKeyState {
  key: string;
  nativeIsComposing: boolean;
  trackedComposing: boolean;
  now: number;
  lastCompositionEndAt: number;
}

/** True while an IME owns the keystroke: composer shortcuts must leave it alone. */
export function isImeOwnedKey({ key, nativeIsComposing, trackedComposing, now, lastCompositionEndAt }: ImeKeyState): boolean {
  if (nativeIsComposing) {
    return true;
  }
  // The window-tracked flag can outlive a composition whose field vanished mid-way, so it
  // only ever blocks Enter (a stuck flag must not freeze history, menus or mode cycling).
  if (key !== 'Enter') {
    return false;
  }
  return trackedComposing || (lastCompositionEndAt > 0 && now - lastCompositionEndAt < SAFARI_IME_RACE_WINDOW_MS);
}
