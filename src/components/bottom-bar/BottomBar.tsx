import React, { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Folder, House, Search, Settings, SquarePen, X } from 'lucide-react';

import { cn } from '../../lib/utils';
import { useKeyboardOpen } from '../home/useKeyboardOpen';
import AttentionCount from '../tools/AttentionCount';

import { activeBottomBarItem, isBottomBarVisible } from './bottomBarModel';

/** Класс на `<html>`, пока панель на экране: поднимает `--bottom-bar-space` (index.css). */
const HAS_BOTTOM_BAR_CLASS = 'has-bottom-bar';

type BottomBarProps = {
  isMobile: boolean;
  /** «Домой» — проект не выбран. */
  isHome: boolean;
  drawerOpen: boolean;
  /** Строка поиска: на «Домой» фильтрует проекты, в шторке — её список. */
  query: string;
  onQueryChange: (query: string) => void;
  /** Панель развёрнута в поле поиска. */
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  /** Счётчик «Канцелярии» на кнопке настроек. */
  attentionCount: number;
  onGoHome: () => void;
  onOpenProjects: () => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
};

const ICON = 'h-5 w-5';
const STROKE = 1.9;

/**
 * Плавающая нижняя панель телефона: Домой · Проекты · поиск · новый чат ·
 * настройки. Есть на «Домой» и в открытой шторке, в открытом чате её нет в
 * разметке (`isBottomBarVisible`). Кнопки висят над содержимым каждая сама по
 * себе, как в эталоне: общей подложки нет, только мягкое затухание фона под
 * ними. Монтируется ребёнком `.app-shell`, не внутри шторки: её `transform`
 * и размытие сделали бы шторку опорой для `position: fixed`.
 */
export default function BottomBar({
  isMobile,
  isHome,
  drawerOpen,
  query,
  onQueryChange,
  searchOpen,
  onSearchOpenChange,
  attentionCount,
  onGoHome,
  onOpenProjects,
  onNewChat,
  onOpenSettings,
}: BottomBarProps) {
  const { t } = useTranslation();
  const keyboardOpen = useKeyboardOpen();
  const inputRef = useRef<HTMLInputElement>(null);
  const visible = isBottomBarVisible({ isMobile, isHome, drawerOpen, keyboardOpen, searchActive: searchOpen });
  const active = activeBottomBarItem({ isHome, drawerOpen });

  // Сетка «Домой» и список шторки освобождают место по этой переменной.
  useEffect(() => {
    if (!visible) return undefined;
    const root = document.documentElement;
    root.classList.add(HAS_BOTTOM_BAR_CLASS);
    return () => root.classList.remove(HAS_BOTTOM_BAR_CLASS);
  }, [visible]);

  if (!visible) return null;

  const openSearch = () => {
    // Поле должно получить фокус в том же нажатии: iOS поднимает клавиатуру
    // только из обработчика жеста, а не из эффекта после него.
    flushSync(() => onSearchOpenChange(true));
    inputRef.current?.focus();
  };

  const closeSearch = () => {
    onQueryChange('');
    onSearchOpenChange(false);
  };

  const settingsLabel = t('bottomBar.settings', 'Настройки');
  const roundButton = (isActive: boolean) => cn('glass-button touch-manipulation text-foreground', isActive && 'glass-active');

  return (
    <nav
      className="pointer-events-none fixed inset-x-0 bottom-[var(--keyboard-height,0px)] z-[60] pb-[var(--safe-bottom)] [.keyboard-open_&]:pb-0"
      aria-label={t('bottomBar.label', 'Навигация')}
      data-bottom-bar={searchOpen ? 'search' : 'items'}
    >
      {/* Содержимое под кнопками уходит в фон темы: кнопки читаются и над
          значками, и над списком, а нижний ряд не обрывается резко. */}
      <div
        className="absolute inset-x-0 -top-5 bottom-0 bg-gradient-to-t from-background/85 via-background/45 to-transparent"
        aria-hidden
      />
      <div className="relative mx-auto flex h-16 w-full max-w-md items-center gap-2 px-4 [&>*]:pointer-events-auto">
        {searchOpen ? (
          <div className="glass-surface flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full pl-4 pr-0 text-foreground">
            <Search className="h-[1.125rem] w-[1.125rem] flex-shrink-0 text-muted-foreground" strokeWidth={STROKE} aria-hidden />
            <input
              ref={inputRef}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onBlur={() => {
                // Пустое поле без фокуса — снова пять кнопок.
                if (!query.trim()) closeSearch();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') closeSearch();
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
              placeholder={drawerOpen
                ? t('bottomBar.searchChats', 'Проекты и чаты')
                : t('mainContent.searchProjects', 'Найти проект')}
              aria-label={t('bottomBar.search', 'Поиск')}
              className="h-full min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-base text-foreground outline-none placeholder:text-muted-foreground/70 focus:ring-0 [&::-webkit-search-cancel-button]:hidden"
              data-bottom-bar-search
            />
            <button
              type="button"
              className="flex h-11 w-11 flex-shrink-0 touch-manipulation items-center justify-center rounded-full text-muted-foreground outline-none transition-transform duration-100 ease-out focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-90 motion-reduce:transition-none"
              // Нажатие не забирает фокус у поля: иначе пустое поле закрылось бы
              // по blur раньше, чем сработает сам крестик.
              onMouseDown={(event) => event.preventDefault()}
              onClick={closeSearch}
              aria-label={t('bottomBar.closeSearch', 'Закрыть поиск')}
              data-bottom-bar-search-close
            >
              <X className={ICON} strokeWidth={STROKE} aria-hidden />
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              className={roundButton(active === 'home')}
              onClick={onGoHome}
              aria-label={t('bottomBar.home', 'Домой')}
              aria-current={active === 'home' ? 'page' : undefined}
              data-bottom-bar-item="home"
            >
              <House className={ICON} strokeWidth={STROKE} aria-hidden />
            </button>
            <button
              type="button"
              className={roundButton(active === 'projects')}
              onClick={onOpenProjects}
              aria-label={t('bottomBar.projects', 'Проекты')}
              aria-current={active === 'projects' ? 'page' : undefined}
              data-bottom-bar-item="projects"
            >
              <Folder className={ICON} strokeWidth={STROKE} aria-hidden />
            </button>
            <button
              type="button"
              className="glass-pill h-11 min-w-0 flex-1 touch-manipulation justify-start gap-2 px-4 text-[15px] text-muted-foreground"
              onClick={openSearch}
              aria-label={t('bottomBar.search', 'Поиск')}
              data-bottom-bar-item="search"
            >
              <Search className="h-[1.125rem] w-[1.125rem] flex-shrink-0" strokeWidth={STROKE} aria-hidden />
              <span className="truncate">{t('bottomBar.search', 'Поиск')}</span>
            </button>
            <button
              type="button"
              className="glass-button-primary touch-manipulation"
              onClick={onNewChat}
              aria-label={t('bottomBar.newChat', 'Новый чат')}
              data-bottom-bar-item="new-chat"
            >
              <SquarePen className={ICON} strokeWidth={2.1} aria-hidden />
            </button>
            <button
              type="button"
              className={roundButton(false)}
              onClick={onOpenSettings}
              aria-label={attentionCount > 0
                ? `${settingsLabel}, ${t('bottomBar.planner', 'Канцелярия')}: ${attentionCount}`
                : settingsLabel}
              data-bottom-bar-item="settings"
            >
              <Settings className={ICON} strokeWidth={STROKE} aria-hidden />
              <AttentionCount count={attentionCount} className="absolute -right-0.5 -top-0.5" />
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
