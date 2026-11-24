import React from 'react';
import { Bell, Bot, GitBranch, Info, Key, LayoutGrid, Mic, Palette, Puzzle, Send, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../lib/utils';
import { PillBar, Pill } from '../../../shared/view/ui';
import { IS_PLATFORM } from '../../../constants/config';
// Not the `../../auth` barrel: it pulls in the terminal and its stylesheet.
import { useAuth } from '../../auth/context/AuthContext';
import AttentionCount from '../../tools/AttentionCount';
import type { SettingsMainTab } from '../types/types';

type SettingsSidebarProps = {
  activeTab: SettingsMainTab;
  onChange: (tab: SettingsMainTab) => void;
  /** Счётчик «Канцелярии» — стоит на вкладке «Инструменты», где она лежит. */
  attentionCount?: number;
};

type NavItem = {
  id: SettingsMainTab;
  labelKey: string;
  icon: typeof Bot;
};

const BASE_NAV_ITEMS: NavItem[] = [
  { id: 'agents', labelKey: 'mainTabs.agents', icon: Bot },
  // Second on purpose: on a phone the row scrolls sideways, and the screens
  // that used to sit in the drawer's «Меню» must be reachable without it.
  { id: 'instruments', labelKey: 'mainTabs.instruments', icon: LayoutGrid },
  { id: 'appearance', labelKey: 'mainTabs.appearance', icon: Palette },
  { id: 'voice', labelKey: 'mainTabs.voice', icon: Mic },
  { id: 'git', labelKey: 'mainTabs.git', icon: GitBranch },
  { id: 'api', labelKey: 'mainTabs.apiTokens', icon: Key },
  { id: 'plugins', labelKey: 'mainTabs.plugins', icon: Puzzle },
  { id: 'notifications', labelKey: 'mainTabs.notifications', icon: Bell },
  { id: 'telegram', labelKey: 'mainTabs.telegram', icon: Send },
  { id: 'about', labelKey: 'mainTabs.about', icon: Info },
];

const ADMIN_NAV_ITEM: NavItem = { id: 'admin', labelKey: 'mainTabs.admin', icon: ShieldCheck };

export default function SettingsSidebar({ activeTab, onChange, attentionCount = 0 }: SettingsSidebarProps) {
  const { t } = useTranslation('settings');
  const { user } = useAuth();
  const isAdmin = !IS_PLATFORM && user?.role === 'admin';
  const NAV_ITEMS = isAdmin ? [...BASE_NAV_ITEMS, ADMIN_NAV_ITEM] : BASE_NAV_ITEMS;

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-56 flex-shrink-0 border-r border-border bg-muted/30 md:flex md:flex-col">
        <nav className="flex flex-col gap-1 p-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => onChange(item.id)}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors duration-150',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground active:bg-accent/50',
                )}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                <span className="min-w-0 flex-1 truncate">{t(item.labelKey)}</span>
                {item.id === 'instruments' && <AttentionCount count={attentionCount} />}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Mobile horizontal nav — pill bar */}
      {/* The row scrolls sideways: the right edge fades out so the cut-off
          pill reads as «дальше есть ещё», and the tail padding lets the last
          pill scroll clear of the fade. */}
      <div className="flex-shrink-0 border-b border-border px-3 py-2 md:hidden">
        <PillBar className="scrollbar-hide w-full overflow-x-auto pr-8 [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)]">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;

            return (
              <Pill
                key={item.id}
                isActive={activeTab === item.id}
                onClick={() => onChange(item.id)}
                className="flex-shrink-0"
              >
                <Icon className="h-3.5 w-3.5" />
                {t(item.labelKey)}
                {item.id === 'instruments' && <AttentionCount count={attentionCount} />}
              </Pill>
            );
          })}
        </PillBar>
      </div>
    </>
  );
}
