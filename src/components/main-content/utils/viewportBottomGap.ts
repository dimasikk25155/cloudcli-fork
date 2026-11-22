/**
 * Нижняя «мёртвая» полоса установленного приложения на айфоне.
 *
 * На скриншотах Димы 23.11 (PWA с рабочего стола) окно приложения кончается
 * на 54 pt выше края экрана: `fixed inset-0`-корпус (`.app-shell`) доходит
 * только до низа окна, а полосу под ним iOS закрашивает фоном страницы.
 * При этом `env(safe-area-inset-bottom)` всё равно отдаёт 34 pt — и панель
 * ввода, «Меню» сайдбара добавляли этот отступ поверх полосы. Получалось
 * двойное пустое место внизу. Разница «экран − окно» — это та полоса; на неё
 * index.css уменьшает нижний safe-area-отступ (`--safe-bottom`).
 */

/** Больше — это клавиатура (Android сжимает окно под неё), а не полоса. */
export const VIEWPORT_GAP_MAX_PX = 120;

export type ViewportSize = {
  /** Открыто с рабочего стола (`display-mode: standalone`). */
  standalone: boolean;
  screenWidth: number;
  screenHeight: number;
  innerWidth: number;
  innerHeight: number;
};

export function computeViewportBottomGap({
  standalone,
  screenWidth,
  screenHeight,
  innerWidth,
  innerHeight,
}: ViewportSize): number {
  // Во вкладке браузера окно меньше экрана из-за его же панелей — это не полоса.
  if (!standalone) return 0;
  // iOS отдаёт размер экрана всегда в портрете — сравниваем с нужной стороной.
  const portrait = innerHeight >= innerWidth;
  const screenSide = portrait ? Math.max(screenWidth, screenHeight) : Math.min(screenWidth, screenHeight);
  const gap = Math.round(screenSide - innerHeight);
  if (!Number.isFinite(gap) || gap <= 0 || gap > VIEWPORT_GAP_MAX_PX) return 0;
  return gap;
}
