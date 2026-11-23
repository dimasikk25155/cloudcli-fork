import React from 'react';
import { AlertTriangle, Settings } from 'lucide-react';
import type { TFunction } from 'i18next';

import { IS_PLATFORM } from '../../../../constants/config';
import { cn } from '../../../../lib/utils';
import AttentionCount from '../../../tools/AttentionCount';

type SidebarFooterProps = {
  restartRequired: boolean;
  currentVersion: string;
  onShowSettings: () => void;
  /** Счётчик «Канцелярии» — на кнопке «Настройки». */
  attentionCount: number;
  t: TFunction;
};

/**
 * Низ шторки: баннер перезапуска, кнопка «Настройки» (на компьютере; на
 * телефоне она в нижней панели) и строка версии. Блока «Меню» здесь больше
 * нет: его экраны лежат в «Настройки → Инструменты», а открывает их
 * `ToolPanelsHost` в оболочке приложения.
 */
export default function SidebarFooter({
  restartRequired,
  currentVersion,
  onShowSettings,
  attentionCount,
  t,
}: SidebarFooterProps) {
  return (
    <div
      className={cn(
        'sidebar-footer flex-shrink-0 md:pb-[var(--safe-bottom)]',
        // На телефоне низ шторки занят плавающей панелью: баннер встаёт над ней.
        restartRequired && 'max-md:pb-[max(var(--safe-bottom),var(--bottom-bar-space))]',
      )}
    >
      {/* Restart-required banner: the running server version differs from the
          installed/frontend version (updated but not restarted). */}
      {restartRequired && (
        <>
          <div className="nav-divider" />
          <div className="px-2 py-1.5">
            <div className="flex items-center gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warning" />
              <span className="min-w-0 flex-1 text-xs font-medium text-foreground">
                {t('version.restartRequired')}
              </span>
            </div>
          </div>
        </>
      )}

      <div className="nav-divider hidden md:block" />

      {/* «Настройки» — единственное, что Дима нажимал в прежнем «Меню». */}
      <div className="hidden px-2 pb-1 pt-1.5 md:block">
        <button
          type="button"
          className="sidebar-footer-item hidden w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground outline-none transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:flex"
          onClick={onShowSettings}
          data-sidebar-settings
        >
          <Settings className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-left text-sm">{t('actions.settings')}</span>
          <AttentionCount count={attentionCount} />
        </button>
      </div>

      {/* Desktop version brand line (OSS mode only) */}
      {!IS_PLATFORM && (
        <div className="hidden px-3 py-2 text-center md:block">
          <span className="text-[10px] text-muted-foreground/40">
            Neo3 Agent System v{currentVersion}
          </span>
        </div>
      )}
    </div>
  );
}
