/**
 * Нижняя панель телефона: когда она есть, какой пункт подсвечен и в каком
 * проекте начинать новый чат. Без React — чистые функции под тест.
 */
import type { Project } from '../../types/app';
import { isHomeJunkProject, projectRecency } from '../home/homeProjectsModel';

export const BOTTOM_BAR_ITEMS = ['home', 'projects', 'search', 'new-chat', 'settings'] as const;

export type BottomBarItem = (typeof BOTTOM_BAR_ITEMS)[number];

export type BottomBarVisibilityInput = {
  isMobile: boolean;
  /** «Домой» — проект не выбран. */
  isHome: boolean;
  drawerOpen: boolean;
  keyboardOpen: boolean;
  /** Печатают в поиске самой панели. */
  searchActive: boolean;
};

/**
 * Панель есть на телефоне на «Домой» и в открытой шторке; в открытом чате её
 * нет. Клавиатура её прячет — кроме случая, когда печатают в её же поиске:
 * тогда она и есть поле ввода и стоит над клавиатурой.
 */
export function isBottomBarVisible({
  isMobile,
  isHome,
  drawerOpen,
  keyboardOpen,
  searchActive,
}: BottomBarVisibilityInput): boolean {
  return isMobile && (isHome || drawerOpen) && (!keyboardOpen || searchActive);
}

/** Шторка лежит поверх экрана, поэтому она важнее «Домой» под ней. */
export function activeBottomBarItem({
  isHome,
  drawerOpen,
}: { isHome: boolean; drawerOpen: boolean }): 'home' | 'projects' | null {
  if (drawerOpen) return 'projects';
  return isHome ? 'home' : null;
}

/**
 * Проект для кнопки «новый чат»: тот, где был последний разговор. Служебные
 * папки (tmp, Codex, скрытые) не в счёт, если их не закрепили, — их нет ни на
 * «Домой», ни в «Всех проектах», и чат там оказался бы неожиданностью.
 * Проектов с разговорами нет — `null`: панель откроет шторку с проектами.
 */
export function pickNewChatProject(projects: Project[]): Project | null {
  let best: Project | null = null;
  let bestTime = 0;
  for (const project of projects) {
    if (!project.isStarred && isHomeJunkProject(project)) continue;
    const time = projectRecency(project);
    if (time > bestTime) {
      best = project;
      bestTime = time;
    }
  }
  return best;
}

/**
 * Красный счётчик на кнопке настроек — это «Канцелярия» во вкладке
 * «Инструменты»: с ним настройки открываются сразу на ней, без него — как всегда.
 */
export function settingsTabForAttention(attentionCount: number): 'instruments' | undefined {
  return attentionCount > 0 ? 'instruments' : undefined;
}
