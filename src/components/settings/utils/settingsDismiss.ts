/** Upstream #1164, adapted: dismissal rules for the settings modal. */

/** Nested modals, dialogs and menus opened above Settings mark themselves with this attribute. */
export const ESCAPE_LAYER_SELECTOR = '[data-escape-layer]';

/** Escape closes Settings only when no layer above it is open and nobody else consumed the key. */
export function shouldCloseSettingsOnEscape(
  event: { key: string; repeat?: boolean; defaultPrevented: boolean },
  hasEscapeLayer: boolean,
): boolean {
  return event.key === 'Escape' && !event.repeat && !event.defaultPrevented && !hasEscapeLayer;
}

/**
 * A click only counts as "outside" when it both started and ended on the backdrop:
 * releasing the mouse on the backdrop after selecting text inside the panel must not close it.
 */
export function isBackdropDismiss(startedOnBackdrop: boolean, endedOnBackdrop: boolean): boolean {
  return startedOnBackdrop && endedOnBackdrop;
}
