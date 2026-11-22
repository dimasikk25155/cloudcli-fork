import { useEffect, useState } from 'react';

/** Class AppContent puts on `<html>` while the on-screen keyboard is up. */
const KEYBOARD_OPEN_CLASS = 'keyboard-open';

const isOpen = () =>
  typeof document !== 'undefined' && document.documentElement.classList.contains(KEYBOARD_OPEN_CLASS);

/**
 * Whether the on-screen keyboard is up (iOS: `html.keyboard-open`, set by
 * AppContent from visualViewport). The field loses focus before the keyboard
 * finishes sliding away; Home keeps holding its rows until it is gone.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(isOpen);

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined;
    const root = document.documentElement;
    const observer = new MutationObserver(() => setOpen(isOpen()));
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    setOpen(isOpen());
    return () => observer.disconnect();
  }, []);

  return open;
}
