/**
 * Свой набор значков экранов Neo3 (вкладка настроек «Инструменты»): какой
 * ключ какого цвета. Цвета — из палитры «Новой вкладки», у всех 13 плиток
 * разные, чтобы экран узнавался по цвету ещё до рисунка.
 */
import { LAUNCHER_GRADIENTS } from '../workbench/newTabModel';

export type MenuIconKey =
  | 'nightshift'
  | 'consigliere'
  | 'mazda'
  | 'agent-workspace'
  | 'schedules'
  | 'pipelines'
  | 'governance'
  | 'server'
  | 'duet'
  | 'agents'
  | 'queue'
  | 'krabik'
  | 'settings';

const TILES: Record<MenuIconKey, keyof typeof LAUNCHER_GRADIENTS> = {
  nightshift: 'indigo',
  consigliere: 'amber',
  mazda: 'red',
  'agent-workspace': 'blue',
  schedules: 'lime',
  pipelines: 'purple',
  governance: 'green',
  server: 'graphite',
  duet: 'pink',
  agents: 'cyan',
  queue: 'teal',
  krabik: 'orange',
  settings: 'gray',
};

/** In the order «Инструменты» lists them; `settings` is the gear of the old menu. */
export const MENU_ICON_KEYS: readonly MenuIconKey[] = [
  'nightshift',
  'consigliere',
  'mazda',
  'agent-workspace',
  'schedules',
  'pipelines',
  'governance',
  'server',
  'duet',
  'agents',
  'queue',
  'krabik',
  'settings',
];

export function isMenuIconKey(key: string): key is MenuIconKey {
  return Object.prototype.hasOwnProperty.call(TILES, key);
}

export function menuTileFor(key: MenuIconKey): { gradient: string } {
  return { gradient: LAUNCHER_GRADIENTS[TILES[key]] };
}
