import type { ComponentType } from 'react';
import {
  Bell,
  Bot,
  GitBranch,
  Info,
  KeyRound,
  LayoutGrid,
  Mic,
  Palette,
  Plug,
} from 'lucide-react';

import type {
  CodeEditorSettingsState,
  CursorPermissionsState,
  ProjectSortOrder,
  SettingsMainTab,
} from '../types/types';

export type SettingsMainTabMeta = {
  id: SettingsMainTab;
  label: string;
  keywords: string;
  icon: ComponentType<{ className?: string }>;
};

export const SETTINGS_MAIN_TABS: SettingsMainTabMeta[] = [
  { id: 'agents', label: 'Agents', keywords: 'agents subagents claude code', icon: Bot },
  {
    id: 'instruments',
    label: 'Инструменты',
    keywords: 'instruments tools menu panels инструменты меню экраны системные задачи канцелярия мазда рабочее пространство расписания сценарии аудит деньги сервер дуэт агенты конвейер крабик',
    icon: LayoutGrid,
  },
  { id: 'appearance', label: 'Appearance', keywords: 'appearance theme dark light language', icon: Palette },
  { id: 'voice', label: 'Voice', keywords: 'voice speech dictation microphone mic stt tts transcription cleanup голос микрофон диктовка', icon: Mic },
  { id: 'git', label: 'Git', keywords: 'git github commits', icon: GitBranch },
  { id: 'api', label: 'API Tokens', keywords: 'api tokens auth keys', icon: KeyRound },
  { id: 'notifications', label: 'Notifications', keywords: 'notifications alerts push', icon: Bell },
  { id: 'plugins', label: 'Plugins', keywords: 'plugins extensions integrations', icon: Plug },
  { id: 'about', label: 'About', keywords: 'about version info', icon: Info },
];

/**
 * Tabs `openSettings(tab)` may land on; anything else opens «Агенты».
 * `instruments` is not `tools`: that id is the old name of «Агенты».
 */
export const KNOWN_MAIN_TABS: SettingsMainTab[] = ['agents', 'instruments', 'appearance', 'git', 'api', 'browser', 'notifications', 'plugins', 'about'];

export const normalizeMainTab = (tab: string): SettingsMainTab => {
  // Keep backwards compatibility with older callers that still pass "tools".
  if (tab === 'tools') {
    return 'agents';
  }

  return KNOWN_MAIN_TABS.includes(tab as SettingsMainTab) ? (tab as SettingsMainTab) : 'agents';
};

export const DEFAULT_PROJECT_SORT_ORDER: ProjectSortOrder = 'recent';
export const DEFAULT_SAVE_STATUS = null;
export const DEFAULT_CODE_EDITOR_SETTINGS: CodeEditorSettingsState = {
  wordWrap: false,
  showMinimap: true,
  lineNumbers: true,
  fontSize: '14',
};

export const DEFAULT_CURSOR_PERMISSIONS: CursorPermissionsState = {
  allowedCommands: [],
  disallowedCommands: [],
  skipPermissions: false,
};
