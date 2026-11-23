// Demo projects and chats of the stand. The server indexes Claude Code
// transcripts from `<HOME>/.claude/projects`, so the stand writes a few of them
// into its scratch HOME: «Домой», the drawer and a chat with history are then
// there without calling any model.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Folder name Claude Code gives a project inside `~/.claude/projects`. */
export const encodeProjectDir = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');

/** Stable UUID-shaped id from a seed string: the same stand gets the same chats. */
const stableUuid = (seed) => {
  const hex = createHash('sha1').update(seed).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const MINUTE_MS = 60_000;
const DEMO_MODEL = 'claude-sonnet-4-5';

/**
 * One Claude Code transcript (JSONL). A turn is `{role:'user'|'assistant', text}`
 * or `{role:'assistant', tool:{name, input, output}}` — the latter becomes the
 * assistant's tool_use line and the user's tool_result line. Lines are a
 * minute apart starting at `startedAt`; `title` adds the chat name.
 */
export function buildTranscript({ sessionId, cwd, startedAt, turns, title }) {
  const start = new Date(startedAt).getTime();
  const lines = [];
  let parentUuid = null;

  const push = (type, message, extra = {}) => {
    const index = lines.length;
    const uuid = stableUuid(`${sessionId}:${index}`);
    lines.push({
      parentUuid,
      isSidechain: false,
      userType: 'external',
      cwd,
      sessionId,
      version: '2.0.0',
      type,
      message,
      ...extra,
      uuid,
      timestamp: new Date(start + index * MINUTE_MS).toISOString(),
    });
    parentUuid = uuid;
  };

  const assistantMessage = (content, stopReason) => ({
    id: `msg_${stableUuid(`${sessionId}:msg:${lines.length}`).replace(/-/g, '').slice(0, 24)}`,
    type: 'message',
    role: 'assistant',
    model: DEMO_MODEL,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 180, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  });

  for (const turn of turns) {
    if (turn.role === 'user') {
      push('user', { role: 'user', content: turn.text });
    } else if (turn.tool) {
      const toolUseId = `toolu_${stableUuid(`${sessionId}:tool:${lines.length}`).replace(/-/g, '').slice(0, 24)}`;
      push('assistant', assistantMessage([{ type: 'tool_use', id: toolUseId, name: turn.tool.name, input: turn.tool.input }], 'tool_use'));
      push(
        'user',
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: turn.tool.output }] },
        { toolUseResult: { stdout: turn.tool.output, stderr: '', interrupted: false, isImage: false } },
      );
    } else {
      push('assistant', assistantMessage([{ type: 'text', text: turn.text }], 'end_turn'));
    }
  }

  const records = title ? [...lines, { type: 'ai-title', sessionId, aiTitle: title }] : lines;
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

const LONG_CHAT = [
  { role: 'user', text: 'Посмотри, почему на телефоне кнопка «Заказать» уезжает под нижний край экрана.' },
  {
    role: 'assistant',
    text: 'Смотрю вёрстку карточки товара. Сначала проверю, какие стили задают нижний отступ.',
  },
  {
    role: 'assistant',
    tool: {
      name: 'Bash',
      input: { command: 'grep -rn "safe-area" src/styles | head -5', description: 'Найти отступы под вырез экрана' },
      output: 'src/styles/card.css:41:  padding-bottom: 12px;\nsrc/styles/layout.css:8:  padding-bottom: env(safe-area-inset-bottom);',
    },
  },
  {
    role: 'assistant',
    text: [
      '## Что нашёл',
      '',
      'Кнопка стоит в блоке с `position: fixed`, а отступ под вырез экрана задан только у общей обёртки. Из-за этого на айфоне кнопка попадает в зону жеста «домой».',
      '',
      '**Что поменял:**',
      '',
      '1. Отступ кнопки считается от `env(safe-area-inset-bottom)`.',
      '2. Высота зоны нажатия — 48 px вместо 36.',
      '3. Убрал дублирующий отступ у обёртки.',
      '',
      '```css',
      '.order-button {',
      '  bottom: calc(12px + env(safe-area-inset-bottom));',
      '  min-height: 48px;',
      '}',
      '```',
      '',
      '| Экран | Было | Стало |',
      '|---|---|---|',
      '| iPhone 15 | кнопка под краем | 12 px над краем |',
      '| iPhone SE | без изменений | без изменений |',
      '',
      'Проверь на своём телефоне: страница товара, прокрутка до конца.',
    ].join('\n'),
  },
  { role: 'user', text: 'Стало лучше. А в альбомной ориентации?' },
  {
    role: 'assistant',
    text: 'В альбомной вырез сбоку, а не снизу, поэтому добавил ещё `env(safe-area-inset-left)` и `right` для ряда кнопок. Длинная строка без пробелов для проверки переноса: `components/product-card/order-button/OrderButtonWithSafeAreaInsets.module.css`.',
  },
  { role: 'user', text: 'Ок, оставляем так.' },
  {
    role: 'assistant',
    text: 'Готово. Изменения в двух файлах: `card.css` и `layout.css`. Тесты вёрстки зелёные.',
  },
];

const shortChat = (question, answer) => [
  { role: 'user', text: question },
  { role: 'assistant', text: answer },
];

/**
 * Demo projects, newest first. `hoursAgo` — when the chat started; `starred`
 * projects get pinned through the API after the server has indexed them.
 */
export const DEMO_PROJECTS = [
  {
    name: 'shop-frontend',
    starred: true,
    chats: [
      { title: 'Кнопка «Заказать» на телефоне', hoursAgo: 1, turns: LONG_CHAT },
      { title: 'Скелетоны на странице каталога', hoursAgo: 30, turns: shortChat('Добавь скелетоны в каталог.', 'Добавил: шесть карточек-заглушек, пока грузится список.') },
      { title: 'Обновить зависимости', hoursAgo: 80, turns: shortChat('Обнови зависимости.', 'Обновил, сборка проходит.') },
    ],
  },
  {
    name: 'telegram-bot',
    starred: true,
    chats: [
      { title: 'Команда /status падает по таймауту', hoursAgo: 3, turns: shortChat('Почему /status не отвечает?', 'Запрос к базе шёл без таймаута. Поставил 5 секунд и понятное сообщение об ошибке.') },
      { title: 'Меню с кнопками', hoursAgo: 50, turns: shortChat('Сделай меню кнопками.', 'Сделал: четыре кнопки в два ряда.') },
    ],
  },
  { name: 'landing', chats: [{ title: 'Первый экран: заголовок и форма', hoursAgo: 5, turns: shortChat('Перепиши заголовок первого экрана.', 'Три варианта заголовка — в файле `hero.md`.') }] },
  { name: 'parser', chats: [{ title: 'Выгрузка цен в таблицу', hoursAgo: 9, turns: shortChat('Выгрузи цены в CSV.', 'Готово: `out/prices.csv`, 412 строк.') }] },
  { name: 'crm-export', chats: [{ title: 'Поле «Источник» не доходит до отчёта', hoursAgo: 20, turns: shortChat('Почему в отчёте пустой источник?', 'Поле терялось при склейке таблиц. Исправил соединение.') }] },
  { name: 'mobile-app', chats: [{ title: 'Экран входа', hoursAgo: 26, turns: shortChat('Сверстай экран входа.', 'Сверстал: поле, кнопка, ссылка «Забыли пароль».') }] },
  { name: 'analytics', chats: [{ title: 'Недельный отчёт', hoursAgo: 44, turns: shortChat('Собери недельный отчёт.', 'Собрал: `report/week.html`.') }] },
  { name: 'design-system', chats: [{ title: 'Скругления и тени', hoursAgo: 70, turns: shortChat('Сведи скругления к трём значениям.', 'Свёл: 8, 12 и 20 px.') }] },
  { name: 'docs', chats: [{ title: 'Раздел «Быстрый старт»', hoursAgo: 96, turns: shortChat('Напиши быстрый старт.', 'Написал: пять шагов, каждый с командой.') }] },
  { name: 'notes', chats: [{ title: 'Разобрать заметки за месяц', hoursAgo: 120, turns: shortChat('Разбери заметки.', 'Разобрал по трём темам.') }] },
];

/** Chat ids follow the project name and the chat's place in it, so links to them survive `down`/`up`. */
const demoSessionId = (projectName, chatIndex) => stableUuid(`${projectName}:${chatIndex}`);

/**
 * App route of the seeded chat with history (first chat of the first project):
 * the value for `path=` of the frame link. Null when there are no demo projects.
 */
export function demoChatPath(projects = DEMO_PROJECTS) {
  const [first] = projects;
  return first && first.chats.length > 0 ? `/session/${demoSessionId(first.name, 0)}` : null;
}

/**
 * Writes the demo projects: an empty folder per project in `workspace` and
 * its transcripts under `<home>/.claude/projects`. Returns
 * `[{ name, cwd, starred, sessionIds }]`.
 */
export function writeSeed({ home, workspace, now = Date.now(), projects = DEMO_PROJECTS }) {
  const written = [];
  for (const project of projects) {
    const cwd = path.join(workspace, project.name);
    fs.mkdirSync(cwd, { recursive: true });
    const transcripts = path.join(home, '.claude', 'projects', encodeProjectDir(cwd));
    fs.mkdirSync(transcripts, { recursive: true });

    const sessionIds = project.chats.map((chat, index) => {
      const sessionId = demoSessionId(project.name, index);
      const startedAt = new Date(now - chat.hoursAgo * 60 * MINUTE_MS).toISOString();
      fs.writeFileSync(
        path.join(transcripts, `${sessionId}.jsonl`),
        buildTranscript({ sessionId, cwd, startedAt, turns: chat.turns, title: chat.title }),
      );
      return sessionId;
    });
    written.push({ name: project.name, cwd, starred: Boolean(project.starred), sessionIds });
  }
  return written;
}
