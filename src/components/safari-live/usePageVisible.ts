import { useEffect, useState } from 'react';

function pageVisibleNow(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/**
 * Вкладка браузера с Neo3 на виду (`document.visibilityState !== 'hidden'`).
 * Ушла в фон — поток картинки Safari закрывается, вернулась — открывается снова (R14i).
 */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(pageVisibleNow);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const update = () => setVisible(pageVisibleNow());
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}
