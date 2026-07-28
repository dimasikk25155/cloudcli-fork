// Below this, a shrunken visual viewport means a browser chrome change
// (address bar collapsing while you scroll), not a keyboard — no phone
// keyboard is this short.
export const KEYBOARD_MIN_HEIGHT_PX = 120;

export type KeyboardInsets = {
  /** How far below the layout viewport the visible window starts. */
  offset: number;
  /** How much of the layout viewport is hidden below the visible window. */
  height: number;
};

/**
 * Work out where the visible window sits inside the layout viewport while the
 * on-screen keyboard is up.
 *
 * Android shrinks the layout viewport itself, so `offset` stays 0 and only the
 * bottom is trimmed. iOS (every browser there runs WebKit) keeps the page at
 * full height, overlays the keyboard, and scrolls the visible window down by
 * `visibleOffsetTop` so the focused field clears it — the top has to be pushed
 * down by exactly that much, or the shell loses its top edge off-screen and
 * leaves a dead strip of the same height above the keyboard.
 */
export const computeKeyboardInsets = (
  layoutHeight: number,
  visibleHeight: number,
  visibleOffsetTop: number
): KeyboardInsets => {
  const hidden = Math.max(0, layoutHeight - visibleHeight);

  if (hidden <= KEYBOARD_MIN_HEIGHT_PX) {
    return { offset: 0, height: 0 };
  }

  // The shift can never exceed what is actually hidden; clamping keeps the
  // bottom inset from going negative if the browser reports them mid-animation.
  const offset = Math.min(Math.max(0, visibleOffsetTop), hidden);

  return { offset, height: hidden - offset };
};
