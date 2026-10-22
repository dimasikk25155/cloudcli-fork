/**
 * Built-in Neo3 mods — the single list read by the settings cards
 * («Настройки → Плагины → Встроенные моды»), the client checks
 * (`useModEnabled`) and the server checks (`isModOn`).
 *
 * Each key is an account preference (`user_ui_preferences`); a missing key
 * means "on", so nothing changes until the user switches a mod off himself.
 * `subagentCrabs` keeps its original name — renaming it would reset the
 * choice already made.
 */

export const MOD_KEYS = [
  'modAttention',
  'modAnswerButtons',
  'modReplyChips',
  'modSecretGuard',
  'modMemoryNotes',
  'modCodeStatus',
  'modRelay',
  'modBackgroundConsole',
  'modThreads',
  'subagentCrabs',
  'modScreenshots',
  'modCacheTimer',
  'modKrabikAgent',
] as const;

export type ModKey = (typeof MOD_KEYS)[number];

export type ModDef = {
  key: ModKey;
  /** Card title, as the user knows the feature. */
  title: string;
  /** One or two plain-Russian lines: what the mod does. */
  description: string;
  /** The mod only works while this one is on (the switch is inactive otherwise). */
  requires?: ModKey;
};

/** Card order on the settings screen. */
export const MODS: readonly ModDef[] = [
  {
    key: 'modAttention',
    title: 'Ждут тебя',
    description:
      'Показывает, какой чат ждёт твоего ответа, какой закончил, а какой упал: точки в списке чатов, '
      + 'число во вкладке, уведомления на телефон и в Telegram.',
  },
  {
    key: 'modAnswerButtons',
    title: 'Ответ из пуша и Telegram',
    description:
      'Кнопки ответа прямо в уведомлении и в Telegram — не нужно открывать Neo3. '
      + 'Выключено — останется только кнопка «Открыть».',
    requires: 'modAttention',
  },
  {
    key: 'modReplyChips',
    title: 'Подсказки ответов',
    description: 'Под последним ответом агента появляются готовые короткие ответы — нажал, и отправилось.',
  },
  {
    key: 'modSecretGuard',
    title: 'Страж ключей',
    description: 'Если в сообщении есть пароль или ключ, сначала спросит, прятать ли его, и только потом отправит.',
  },
  {
    key: 'modMemoryNotes',
    title: 'Заметки в Obsidian',
    description: 'Когда чат затих, сам записывает главное из него в твою базу Obsidian.',
  },
  {
    key: 'modCodeStatus',
    title: 'Где мой код',
    description: 'Плашка вверху чата: сохранены ли правки, отправлены ли они и что сейчас на сайте.',
  },
  {
    key: 'modRelay',
    title: 'Перенести',
    description:
      'Когда чат становится слишком длинным, предлагает продолжить в новом — со всем, что уже сделано. '
      + 'Сюда же входит авто-перенос.',
  },
  {
    key: 'modBackgroundConsole',
    title: 'Пульт фона',
    description:
      'Показывает, что агент делает в фоне («Фон: N»), сколько идёт текущий шаг, и даёт остановить '
      + 'фоновую задачу. Не даёт агенту надолго зависнуть в ожидании.',
  },
  {
    key: 'modThreads',
    title: 'Треды',
    description: 'Агент может сам открыть соседние чаты-помощники и собрать их итоги. Полоса «Треды: N» над чатом.',
  },
  {
    key: 'subagentCrabs',
    title: 'Крабики-помощники',
    description:
      'Помощники агента показываются крабиками: цвет — модель, в лапах — чем занят, галочка — вернулся. '
      + 'Выключено — прежняя карточка помощника.',
  },
  {
    key: 'modScreenshots',
    title: 'Пометки на скриншоте',
    description: 'Карандаш на картинке: обведи или подпиши нужное перед отправкой. Агент узнает, откуда снимок.',
  },
  {
    key: 'modCacheTimer',
    title: 'Таймер кэша',
    description: 'Показывает у поля ввода, сколько минут ответ агента будет дешевле и быстрее, если написать сейчас.',
  },
  {
    key: 'modKrabikAgent',
    title: 'Агент крабик',
    description:
      'Агент на сервере: доводит задачи до конца, даже когда мак спит или пропал VPN. '
      + 'Окно «Крабик» в меню слева, каждое утро сам проверяет сервер.',
  },
];

const MOD_KEY_SET: ReadonlySet<string> = new Set(MOD_KEYS);

export function isModKey(value: unknown): value is ModKey {
  return typeof value === 'string' && MOD_KEY_SET.has(value);
}

/** Every mod is on until the user switches it off. */
export function modDefault(_key: ModKey): true {
  return true;
}

/**
 * The one identifier of "refused: the mod is switched off" — HTTP `code`,
 * pending-answers reason, stop-task reason, threads tool error all use it.
 */
export const MOD_OFF = 'MOD_OFF';
export type ModOff = typeof MOD_OFF;

/**
 * «Мод «Треды» выключен в настройках Neo3 (…)» — the one text for a person
 * or an agent. No database here: the stdio threads MCP imports it too.
 */
export function modOffMessage(key: ModKey): string {
  const title = MODS.find((mod) => mod.key === key)?.title ?? key;
  return `Мод «${title}» выключен в настройках Neo3 (Настройки → Плагины → Встроенные моды)`;
}
