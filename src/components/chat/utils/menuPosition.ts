/** Gap kept between a composer menu and the window edge. */
export const MENU_VIEWPORT_GAP = 8;

/**
 * Left edge of a fixed composer menu (model, effort, mode): under its button,
 * but never past the right edge of the window — the chat on the canvas sits
 * at the right, and its menus used to run off-screen — nor the left one.
 */
export function clampMenuLeft(left: number, width: number, viewportWidth: number): number {
  const maxLeft = viewportWidth - width - MENU_VIEWPORT_GAP;
  return Math.max(MENU_VIEWPORT_GAP, Math.min(left, maxLeft));
}
