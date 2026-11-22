import { useEffect } from 'react';

import { computeViewportBottomGap } from '../utils/viewportBottomGap';

const isStandalone = (): boolean => {
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.('(display-mode: standalone)').matches || Boolean(navigatorWithStandalone.standalone);
};

const STATUS_BAR_META = 'meta[name="apple-mobile-web-app-status-bar-style"]';

/**
 * Публикует `--viewport-bottom-gap` на `<html>`: насколько окно установленного
 * приложения не доходит до низа экрана (см. `viewportBottomGap.ts`). По нему
 * index.css считает `--safe-bottom` — нижний отступ панели ввода и сайдбара.
 * Стиль статус-бара (мета, светлые темы — `default`) и верхний safe-area-отступ
 * (меряет невидимый пробник) решают, внизу ли разница «экран − окно».
 */
export function useViewportBottomGap(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const root = document.documentElement;
    let frame = 0;
    const statusBarMeta = document.querySelector(STATUS_BAR_META);
    // env() в JS не прочитать — его отдаёт вычисленный padding пробника.
    const topProbe = document.createElement('div');
    topProbe.setAttribute('aria-hidden', 'true');
    topProbe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top, 0px);';
    document.body.appendChild(topProbe);
    const readSafeAreaTop = (): number | null => {
      const value = parseFloat(window.getComputedStyle(topProbe).paddingTop);
      return Number.isFinite(value) ? value : null;
    };

    const apply = () => {
      frame = 0;
      const gap = computeViewportBottomGap({
        standalone: isStandalone(),
        statusBarStyle: statusBarMeta?.getAttribute('content') ?? null,
        safeAreaTop: readSafeAreaTop(),
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
      topProbe.remove();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      root.style.removeProperty('--viewport-bottom-gap');
    };
  }, []);
}
