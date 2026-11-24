import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';

import MenuTile from '../../../menu-icons/MenuTile';
import AttentionCount from '../../../tools/AttentionCount';
import { visibleToolPanels, type ToolPanelAccess, type ToolPanelKey } from '../../../tools/toolPanels';
import SettingsCard from '../SettingsCard';
import SettingsSection from '../SettingsSection';

type InstrumentsSettingsTabProps = {
  /** Кто смотрит: от этого зависит состав списка. */
  access: ToolPanelAccess;
  /** Счётчик «Канцелярии». */
  attentionCount: number;
  /** Нажали строку: закрыть настройки и открыть экран. */
  onOpenPanel: (key: ToolPanelKey) => void;
};

/**
 * Вкладка «Инструменты»: экраны, которые раньше лежали в «Меню» шторки.
 * Строка на экран — значок, название и фраза, для чего он. Кто чего не видел
 * в «Меню» (не владелец, выключен мод), не видит и здесь.
 */
export default function InstrumentsSettingsTab({ access, attentionCount, onOpenPanel }: InstrumentsSettingsTabProps) {
  const { t } = useTranslation('settings');
  const panels = visibleToolPanels(access);

  return (
    <SettingsSection
      title={t('instruments.title', 'Инструменты')}
      description={t(
        'instruments.description',
        'Экраны, которые раньше лежали в «Меню» шторки. Нажми строку — настройки закроются, экран откроется.',
      )}
    >
      <SettingsCard divided className="overflow-hidden">
        {panels.map((panel) => (
          <button
            key={panel.key}
            type="button"
            className="group flex min-h-[4rem] w-full touch-manipulation items-center gap-3 px-4 py-2.5 text-left outline-none transition-colors duration-150 hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-accent/70"
            onClick={() => onOpenPanel(panel.key)}
            data-tool-panel={panel.key}
          >
            <span className="relative flex-shrink-0">
              <MenuTile iconKey={panel.iconKey} size="md" />
              {panel.key === 'consigliere' && (
                <AttentionCount count={attentionCount} className="absolute -right-1.5 -top-1.5" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">{panel.label}</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground" data-tool-purpose>
                {panel.purpose}
              </span>
            </span>
            <ChevronRight
              className="h-4 w-4 flex-shrink-0 text-muted-foreground/60 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none"
              aria-hidden
            />
          </button>
        ))}
      </SettingsCard>
    </SettingsSection>
  );
}
