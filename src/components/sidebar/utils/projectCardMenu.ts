// Phone project card in the sidebar: tap folds/unfolds, hold opens a small
// menu (pin/unpin, rename). The pin star used to sit right next to the fold
// chevron and kept getting hit by mistake (14.11), so on phones it lives only
// behind a deliberate long press — same gesture as the home launcher.

export const PROJECT_CARD_LONG_PRESS_MS = 450;
export const PROJECT_CARD_MOVE_CANCEL_PX = 12;

const MENU_WIDTH = 220;
const MENU_HEIGHT = 112;
const MENU_MARGIN = 12;

export type Point = { x: number; y: number };

/** A finger that travelled this far is scrolling the list, not holding. */
export function movedTooFar(start: Point, current: Point, tolerancePx = PROJECT_CARD_MOVE_CANCEL_PX): boolean {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  return dx * dx + dy * dy > tolerancePx * tolerancePx;
}

/** Keeps the menu fully on screen near the finger. */
export function projectMenuPosition(point: Point, viewport: { width: number; height: number }) {
  const maxLeft = Math.max(MENU_MARGIN, viewport.width - MENU_WIDTH - MENU_MARGIN);
  const maxTop = Math.max(MENU_MARGIN, viewport.height - MENU_HEIGHT - MENU_MARGIN);
  return {
    left: Math.min(Math.max(MENU_MARGIN, point.x - 20), maxLeft),
    top: Math.min(Math.max(MENU_MARGIN, point.y + 8), maxTop),
  };
}
