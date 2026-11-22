import { useEffect } from 'react';

import { computeViewportBottomGap } from '../utils/viewportBottomGap';

const isStandalone = (): boolean => {
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.('(display-mode: standalone)').matches || Boolean(navigatorWithStandalone.standalone);
};

/**
 * Публикует `--viewport-bottom-gap` на `<html>`: насколько окно установленного
 * приложения не доходит до низа экрана (см. `viewportBottomGap.ts`). По нему
 * index.css считает `--safe-bottom` — нижний отступ панели ввода и сайдбара.
 */
export function useViewportBottomGap(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const root = document.documentElement;
    let frame = 0;

    const apply = () => {
      frame = 0;
      const gap = computeViewportBottomGap({
        standalone: isStandalone(),
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
      });
      root.style.setProperty('--viewport-bottom-gap', `${gap}px`);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      root.style.removeProperty('--viewport-bottom-gap');
    };
  }, []);
}
