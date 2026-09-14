import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';

export type PreferenceToggleKey =
  | 'showRawParameters'
  | 'showThinking'
  | 'sendByCtrlEnter'
  | 'sendByDoubleEnter'
  | 'voiceEnabled';

export type QuickSettingsPreferences = Record<PreferenceToggleKey, boolean>;

export type PreferenceToggleItem = {
  key: PreferenceToggleKey;
  labelKey: string;
  icon: LucideIcon;
  /** Не показываем на телефонах: там нет аппаратного Enter. */
  desktopOnly?: boolean;
};

export type QuickSettingsHandleStyle = CSSProperties;
