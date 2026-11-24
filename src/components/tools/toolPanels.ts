/**
 * Экраны бывшего «Меню» шторки: один список на всё приложение. Его читают
 * вкладка настроек «Инструменты» (что показать и зачем это нужно) и
 * `ToolPanelsHost` (что открыть по ссылке, уведомлению или кнопке).
 * Без React — чистые данные и функции под тест.
 */
import { MODS, type ModKey } from '../../../shared/mods';
import type { MenuIconKey } from '../menu-icons/menuIconModel';

export type ToolPanelKey =
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
  | 'krabik';

export type ToolPanel = {
  key: ToolPanelKey;
  /** Название экрана — как было в «Меню». */
  label: string;
  /** Одна короткая фраза: для чего экран (в строке списка — до двух строк на телефоне). */
  purpose: string;
  iconKey: MenuIconKey;
  /** `owner` — только владельцу установки (администратор, не общий сервис). */
  access: 'all' | 'owner';
  /** Встроенный мод, без которого экрана нет. */
  mod?: ModKey;
};

export type ToolPanelAccess = {
  isOwner: boolean;
  /** Включённые моды; не названный в записи считается выключенным. */
  mods: Partial<Record<ModKey, boolean>>;
};

/**
 * Порядок — как стоял в «Меню». «Для чего» написано по тому, что экран
 * делает на самом деле (разбор — в отчёте сборки, таблица для Димы).
 */
export const TOOL_PANELS: readonly ToolPanel[] = [
  {
    key: 'nightshift',
    label: 'Системные задачи',
    purpose: 'Что мак запускает сам по расписанию и чем кончились прошлые запуски',
    iconKey: 'nightshift',
    access: 'all',
  },
  {
    key: 'consigliere',
    label: 'Канцелярия',
    purpose: 'Платежи и подписки: просроченное и ближайшие три дня',
    iconKey: 'consigliere',
    access: 'all',
  },
  {
    key: 'mazda',
    label: 'Мазда',
    purpose: 'Ссылка на сайт машины mazda.neo3.ru',
    iconKey: 'mazda',
    access: 'all',
  },
  {
    key: 'agent-workspace',
    label: 'Рабочее пространство',
    purpose: 'По проекту: мой день, почта, документы, знания, команда, заявки',
    iconKey: 'agent-workspace',
    access: 'all',
  },
  {
    key: 'schedules',
    label: 'Расписания',
    purpose: 'Агент или сценарий запускается сам, по времени',
    iconKey: 'schedules',
    access: 'all',
  },
  {
    key: 'pipelines',
    label: 'Сценарии',
    purpose: 'Цепочка заданий: ответ одного шага уходит в следующий',
    iconKey: 'pipelines',
    access: 'all',
  },
  {
    key: 'governance',
    label: 'Аудит и деньги',
    purpose: 'Что агенты делали без тебя и сколько это стоило',
    iconKey: 'governance',
    access: 'all',
  },
  {
    key: 'server',
    label: 'Сервер',
    purpose: 'Живы ли службы Neo3, что упало и почему, логи',
    iconKey: 'server',
    access: 'owner',
  },
  {
    key: 'duet',
    label: 'Дуэт',
    purpose: 'Напарник по ботам: что ждёт решения, идеи, журнал',
    iconKey: 'duet',
    access: 'owner',
    mod: 'modDuet',
  },
  {
    key: 'agents',
    label: 'Агенты',
    purpose: 'Помощники с ролью и памятью: завести, настроить, начать чат',
    iconKey: 'agents',
    access: 'owner',
    mod: 'modAgents',
  },
  {
    key: 'queue',
    label: 'Конвейер',
    purpose: 'Очередь пунктов для агентов: у каждого ответа вердикт',
    iconKey: 'queue',
    access: 'owner',
    mod: 'modAgentQueue',
  },
  {
    key: 'krabik',
    label: 'Агент крабик',
    purpose: 'Чат с агентом на сервере в Нидерландах, его задачи и отчёты',
    iconKey: 'krabik',
    access: 'owner',
    mod: 'modKrabikAgent',
  },
];

const PANEL_BY_KEY: ReadonlyMap<string, ToolPanel> = new Map(TOOL_PANELS.map((panel) => [panel.key, panel]));

/** Мод включён сам и включён тот, от которого он зависит («Конвейер» — от «Агентов»). */
function modOn(key: ModKey, mods: ToolPanelAccess['mods']): boolean {
  if (!mods[key]) return false;
  const requires = MODS.find((mod) => mod.key === key)?.requires;
  return requires ? modOn(requires, mods) : true;
}

function allowed(panel: ToolPanel, { isOwner, mods }: ToolPanelAccess): boolean {
  if (panel.access === 'owner' && !isOwner) return false;
  return panel.mod ? modOn(panel.mod, mods) : true;
}

/** Экраны, которые этот человек видит, в порядке списка. */
export function visibleToolPanels(access: ToolPanelAccess): ToolPanel[] {
  return TOOL_PANELS.filter((panel) => allowed(panel, access));
}

export function isToolPanelKey(key: unknown): key is ToolPanelKey {
  return typeof key === 'string' && PANEL_BY_KEY.has(key);
}

export function toolPanelFor(key: ToolPanelKey): ToolPanel {
  // Every ToolPanelKey has a record: the list above is checked by its test.
  return PANEL_BY_KEY.get(key) as ToolPanel;
}

/** Ссылка, уведомление или кнопка открывают только то, что есть в списке у человека. */
export function canOpenToolPanel(key: ToolPanelKey, access: ToolPanelAccess): boolean {
  return allowed(toolPanelFor(key), access);
}

/** Экран из адреса: `/?panel=schedules` (так открывают уведомления и ссылки). */
export function toolPanelFromQuery(search: string): ToolPanelKey | null {
  const key = new URLSearchParams(search).get('panel');
  return isToolPanelKey(key) ? key : null;
}

/** Экран из сообщения сервис-воркера о нажатом уведомлении. */
export function toolPanelFromNavigateMessage(data: unknown): ToolPanelKey | null {
  if (!data || typeof data !== 'object') return null;
  const { type, panel } = data as { type?: unknown; panel?: unknown };
  return type === 'notification:navigate' && isToolPanelKey(panel) ? panel : null;
}
