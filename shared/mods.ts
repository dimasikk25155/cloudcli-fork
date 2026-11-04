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
  'modDuet',
  'modImprovementIdeas',
  'modWorkbench',
  'modSessionHub',
  'modSideChat',
  'modGroups',
  'modThinkingTime',
  'modKeepAwake',
  'modDiagnostics',
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
  /**
   * Support per engine, one line under the card:
   * «Claude ✓ · Codex ✓ · Grok ✓ — ограничение». Missing — no line.
   */
  engines?: string;
};

/** Card order on the settings screen. */
export const MODS: readonly ModDef[] = [
  {
    key: 'modImprovementIdeas',
    title: 'Идеи улучшений',
    description: 'Сохраняет предложения агента в Obsidian. В чате можно сразу одобрить реализацию или оставить на потом.',
    engines: 'Claude ✓ · Codex ✓ · Grok ✓',
  },
  {
    key: 'modAttention',
    title: 'Ждут тебя',
    description:
      'Показывает, какой чат ждёт твоего ответа, какой закончил, а какой упал: точки в списке чатов, '
      + 'число во вкладке, уведомления на телефон и в Telegram.',
    engines: 'Claude ✓ · Codex ✓ · Grok ✓ — после перезапуска Neo3 вопрос Grok ждёт ответа текстом, без кнопок',
  },
  {
    key: 'modAnswerButtons',
    title: 'Ответ из пуша и Telegram',
    description:
      'Кнопки ответа прямо в уведомлении и в Telegram — не нужно открывать Neo3. '
      + 'Кнопки доступны для Claude и Grok; в Codex — «Открыть» и ответ в чате.',
    requires: 'modAttention',
    engines: 'Claude ✓ · Codex нет — только «Открыть» и ответ в чате · Grok ✓',
  },
  {
    key: 'modReplyChips',
    title: 'Подсказки ответов',
    description: 'Под последним ответом агента появляются готовые короткие ответы — нажал, и отправилось.',
    engines: 'Claude ✓ · Codex ✓ · Grok ✓',
  },
  {
    key: 'modSecretGuard',
    title: 'Страж ключей',
    description: 'Если в сообщении есть пароль или ключ, сначала спросит, прятать ли его, и только потом отправит.',
    engines: 'Claude ✓ · Codex ✓ · Grok ✓ — проверка в поле ввода Neo3; в терминале — только Claude Code',
  },
  {
    key: 'modMemoryNotes',
    title: 'Заметки в Obsidian',
    description: 'Когда чат затих, сам записывает главное из него в твою базу Obsidian.',
    engines: 'Claude ✓ · Codex ✓ · Grok ✓',
  },
  {
    key: 'modCodeStatus',
    title: 'Где мой код',
    description: 'Плашка вверху чата: сохранены ли правки, отправлены ли они и что сейчас на сайте.',
    engines: 'Claude ✓ · Codex ✓ · Grok ✓ — от движка не зависит',
  },
  {
    key: 'modRelay',
    title: 'Перенести',
    description:
      'Когда чат становится слишком длинным, предлагает продолжить в новом — со всем, что уже сделано. '
      + 'Сюда же входит авто-перенос.',
    engines: 'Claude ✓ · Codex ✓ · Grok ✓ — продолжение на том же движке, модели и effort',
  },
  {
    key: 'modBackgroundConsole',
    title: 'Пульт фона',
    description:
      'Таймер текущего шага работает и в Codex. «Фон: N» доступен для Claude и Grok, '
      + 'остановка отдельной фоновой задачи — у Claude, Codex и Grok (когда Neo3 нашёл процесс задачи).',
    engines: 'Claude ✓ · Codex ✓ · Grok ✓ — у Codex и Grok «Стоп» есть, когда Neo3 нашёл процесс задачи; страж циклов — только Claude',
  },
  {
    key: 'modThreads',
    title: 'Треды',
    description: 'Агент может сам открыть соседние чаты-помощники и собрать их итоги. Полоса «Треды: N» над чатом.',
    engines: 'Claude ✓ · Codex ✓ · Grok ✓ — у участников команды в Grok тредов нет',
  },
  {
    key: 'subagentCrabs',
    title: 'Крабики-помощники',
    description:
      'Помощники агента показываются крабиками: цвет — модель, в лапах — чем занят, галочка — вернулся. '
      + 'Выключено — прежняя карточка помощника.',
    engines: 'Claude ✓ · Codex ✓ · Grok ✓',
  },
  {
    key: 'modScreenshots',
    title: 'Пометки на скриншоте',
    description: 'Карандаш на картинке: обведи или подпиши нужное перед отправкой. Агент узнает, откуда снимок.',
    engines: 'Claude ✓ · Codex ✓ · Grok ✓',
  },
  {
    key: 'modCacheTimer',
    title: 'Таймер кэша',
    description: 'Оценка оставшегося времени кэша Claude. Codex и Grok не сообщают Neo3 точное время истечения кэша чата — обратный отсчёт для них не показывается.',
    engines: 'Claude ✓ · Codex нет · Grok нет — они не сообщают время кэша',
  },
  {
    key: 'modKrabikAgent',
    title: 'Агент крабик',
    description:
      'Агент на сервере: доводит задачи до конца, даже когда мак спит или пропал VPN. '
      + 'Окно «Крабик» в меню слева, каждое утро сам проверяет сервер.',
    engines: 'Claude ✓ · Codex частично — подготовлен, включается после выпуска панели · Grok нет',
  },
  {
    key: 'modDuet',
    title: 'Дуэт',
    description:
      'Напарник по ботам и сервисам: сам следит, пишет первым (утренний бриф, тревога при падении) '
      + 'и чинит только после твоего «Да». Вешает на ботов идеи, как их улучшить.',
    engines: 'Claude ✓ · Codex ✓ — анализ без инструментов · Grok нет',
  },
  {
    key: 'modWorkbench',
    title: 'Рабочий стол',
    description:
      'Переключатель в шапке чата: слева чат, справа большой холст с вкладками — сессия, '
      + 'контекст и лимиты, результаты. Выключен — обычный чат.',
    engines: 'Claude ✓ · Codex ✓ · Grok ✓ — Grok не сообщает лимиты подписки',
  },
  {
    key: 'modSessionHub',
    title: 'Панель диалогов',
    description:
      'Полоса над полем ввода: сколько чатов работают, ждут и готовы во всех проектах. '
      + 'Мастер-сессия собирает вопросы всех чатов и отправляет ответы пачкой.',
    engines: 'Claude ✓ · Codex ✓ · Grok ✓ — Codex отвечает на вопросы только текстом в чате',
  },
  {
    key: 'modSideChat',
    title: 'Побочный чат',
    description:
      '/btw и «Спросить в стороне» — вопрос в отдельном чате, не мешая основному. '
      + 'Второй чат рядом на холсте и дерево вложенных чатов в списке слева.',
    engines: 'Claude ✓ · Codex ✓ · Grok ✓',
  },
  {
    key: 'modGroups',
    title: 'Группы и закрепы',
    description: 'Группы проектов и чатов в списке слева и закреп важных чатов сверху. Можно попросить агента разложить.',
    engines: 'Claude ✓ · Codex ✓ · Grok ✓',
  },
  {
    key: 'modThinkingTime',
    title: 'Время размышления',
    description: 'Под каждым ответом: «Думал N с · ответ за N с». Остаётся в истории чата.',
    engines: 'Claude ✓ · Codex ✓ · Grok ✓ — если движок не показал размышление, только «ответ за N с»',
  },
  {
    key: 'modKeepAwake',
    title: 'Не засыпать',
    description: 'Пока агенты работают, Mac не уходит в сон. Нет работы 2 минуты — снова может спать.',
    engines: 'Claude ✓ · Codex ✓ · Grok ✓ — только на Mac',
  },
  {
    key: 'modDiagnostics',
    title: 'Диагностика',
    description:
      '/doctor проверяет настройку, /skill-doctor — навыки, /advisor спрашивает сильную модель. '
      + 'Профиль настроек: изменения с предпросмотром и «Вернуть как было».',
    engines: 'Claude ✓ · Codex ✓ · Grok ✓ — /advisor всегда отвечает моделью Claude',
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
