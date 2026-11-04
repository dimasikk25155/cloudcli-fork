import { MODS } from '../../../../../../shared/mods';
import type { ProfileChange, ProfileValue } from '../../../../../../shared/settings-profile';

const KEY_LABELS: Record<string, string> = {
  theme: 'Тема',
  shaderEnabled: 'Анимированный фон',
  themeBackgrounds: 'Фон темы',
  themeTweaks: 'Подстройка темы',
  uiScale: 'Масштаб интерфейса',
  showRawParameters: 'Сырые параметры инструментов',
  showThinking: 'Показывать размышления',
  sendByCtrlEnter: 'Отправка по Ctrl+Enter',
  sendByDoubleEnter: 'Отправка по двойному Enter',
  sidebarVisible: 'Список слева',
  voiceEnabled: 'Голосовой ввод',
  autoRelayNewChats: 'Авто-перенос в новых чатах',
  workbenchLayout: 'Раскладка рабочего стола',
};

/** Human name of a settings key: mods use the title of their card. */
export function profileKeyLabel(key: string): string {
  return KEY_LABELS[key] ?? MODS.find((mod) => mod.key === key)?.title ?? key;
}

/** On/off words for switches, the value as is for the rest; "не задано" for a key never set. */
export function profileValueLabel(value: ProfileValue | null): string {
  if (value === null) return 'не задано';
  if (value === true) return 'включено';
  if (value === false) return 'выключено';
  return String(value);
}

export function describeChange(change: ProfileChange): string {
  return `${profileKeyLabel(change.key)}: ${profileValueLabel(change.from)} → ${profileValueLabel(change.to)}`;
}
