import React from 'react';
import { useTranslation } from 'react-i18next';

import type { MobileMenuButtonProps } from '../../types/types';
import { useMobileMenuHandlers } from '../../hooks/useMobileMenuHandlers';

/**
 * ☰ в шапке чата на телефоне — круглая стеклянная кнопка: видимый размер
 * 36 px, зона нажатия 44 px — её добирает сам класс `.glass-button`.
 * `compact` оставлен для вызывающих: вид у обоих вариантов один.
 */
export default function MobileMenuButton({ onMenuClick }: MobileMenuButtonProps) {
  const { t } = useTranslation('common');
  const { handleMobileMenuClick, handleMobileMenuTouchEnd } = useMobileMenuHandlers(onMenuClick);
  const label = t('mainContent.homeMenu', 'Открыть меню');

  return (
    <button
      type="button"
      onClick={handleMobileMenuClick}
      onTouchEnd={handleMobileMenuTouchEnd}
      className="glass-button pwa-menu-button h-9 w-9 flex-shrink-0 touch-manipulation text-foreground"
      aria-label={label}
      title={label}
    >
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  );
}
