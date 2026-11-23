# Границы и правила сборки neo3-glass

Читается первым. Код как он есть — в `notes.md` (точные имена, строки, грабли). Здесь — что решено.

## Правила проекта

- **Рабочая копия** — `/Users/dimasik/Antigravity Project/claude agent/neo3-glass`, ветка `feat/neo3-glass-themes`.
  Работать только в ней. Папку `../cloudcli-fork/` не читать на запись и не трогать: из неё работает боевой Neo3.
- **Боевое не трогать никогда:** `~/.cloudcli/` (база, `local-server.json`, `maintenance/`), LaunchAgent
  `com.dimasik.neo3-local`, порты 3001 и 3005. Не рестартить ничего, что не запущено тобой в этой сборке.
- `node_modules` — ссылка на основную копию. **Никаких `npm install`, `npm ci`, новых пакетов.**
  Не запускать `npm run build`, `npm run dev` (пишут в общий порядок запуска); клиент собирать только
  `node_modules/.bin/vite build` — в `dist/` этой копии (он свой, в `.gitignore`) или `--outDir` во временную папку.
- **Любой сервер из этой копии — только с временным `HOME`** (`HOME`, `USERPROFILE`, `DATABASE_PATH`,
  `SERVER_PORT`, `HOST=127.0.0.1`): без `HOME` он перезапишет боевой `~/.cloudcli/local-server.json`. Для этого — стенд (ниже).
- **Браузер** — только встроенный невидимый браузер Neo3: `workspace_action` `browser.*`; закончил со страницей —
  сразу `browser.close`. Chrome, Chromium, Edge, Firefox, Safari, Playwright, `scripts/shoot-ui.mjs` — запрещены.
  Вызов MCP падает «fetch failed» → тот же POST `curl --noproxy '*'` на `$NEO3_THREADS_API_URL/tools/workspace_action`
  с заголовком `Authorization: Bearer $NEO3_THREADS_TOKEN`. Значение токена не печатать и никуда не записывать.
- Язык интерфейса — русский. Новые строки через `t('ключ', 'русский текст по умолчанию')`; ключи добавлять в
  `src/i18n/locales/ru/*.json` и `en/*.json`.
- Слова из `CONTEXT.md`: «Холст», «Рабочий стол», «Конвейер» ≠ «Сценарии». Подписи экранов — как сейчас в `SidebarFooter.tsx`.
- Новые компоненты — с явным `import React`. Тесты — `*.test.ts` рядом с кодом, `node:test`, импорты с `.js`.
- Блок значений темы в `index.css` — плоский до первой `\n}`.
- Коммит — только свои файлы таска, пути перечислены явно. Чужого в дереве не коммитить. Не пушить.

### Команды

```sh
cd "/Users/dimasik/Antigravity Project/claude agent/neo3-glass"
npm run typecheck                                    # типы клиента и сервера
TMPDIR="$(node -p 'require("node:fs").realpathSync(require("node:os").tmpdir())')" npm test   # все тесты
node_modules/.bin/tsx --tsconfig server/tsconfig.json --test <файл.test.ts> [ещё…]            # выборочно
node_modules/.bin/vite build --outDir "$(mktemp -d /tmp/neo3-client-check.XXXXXX)"            # сборка клиента «вхолостую»
```

**Одна проверка таска** = `npm run typecheck` + весь `npm test` + сборка клиента вхолостую. Все три зелёные.

### Договорились — не пересматривать (из прошлых сборок, дословно)

- «Результаты» наполняются сами: HTML/SVG, записанные агентом в чате, появляются без ввода пути.
- Второй чат справа = тот же `ChatInterface` с `embedded`, а не своя упрощённая лента.
- Глобальное (звуки, `[Done]`, сторож соединения, быстрые настройки, бар всех проектов, материалы «Отправить агенту», выбор движка) делает только основной чат.
- Рабочий стол переключаемый, обычный чат остаётся; мод выкл — прежний переключатель вкладок.
- Браузер агентов — только Safari; Chrome/Playwright не использовать. *(С 05.11 в Neo3 — встроенный браузер, см. выше.)*
- Тему `claudeLight` Диме НЕ включать. Motion — «уже есть».
- Прод и рестарт — только с согласия Димы; строить в отдельном worktree, `cloudcli-fork/` не трогать.
- Менять MCP-серверы и навыки может только админ.
- Роль агента — скрытый блок `<agent_brief>` в первом сообщении (ADR 0030).

Следствие для этой сборки: подмена убранной темы никогда не ведёт на `claudeLight`; `ChatComposer` правится так,
чтобы режим `embedded` (второй чат) выглядел так же, как основной.

## Границы, решённые в спецификации

### 1. Стекло — `src/index.css` (владелец: таск 02)

Значения темы, задаются в каждом из 6 блоков `[data-theme='…']`:

| Переменная | Что это | Форма значения |
|---|---|---|
| `--glass-bg` | фон плавающего элемента | готовый цвет с альфой, напр. `hsl(0 0% 100% / 0.08)` |
| `--glass-bg-strong` | фон там, где под стеклом текст (поле ввода, шапки) | цвет с альфой |
| `--glass-blur` | радиус размытия | `px` |
| `--glass-saturate` | насыщенность под стеклом | число |
| `--glass-border` | кромка | цвет с альфой |
| `--glass-highlight` | светлый блик по верхней кромке (inset) | цвет с альфой |
| `--glass-shadow` | тень | значение `box-shadow` |
| `--glass-fallback-bg` | плотный фон, когда размытия нет | непрозрачный цвет |

Классы (никаких других способов сделать стекло в компонентах):

| Класс | Для чего |
|---|---|
| `.glass-surface` | небольшая плавающая карточка: поле ввода, нижняя панель, меню, полосы. Размытие остаётся и под `has-live-wallpaper` |
| `.glass-sheet` | крупная поверхность: шапка, шторка, шапка панели. Под `html.has-live-wallpaper` размытие снимается |
| `.glass-pill` | пилюля (высота ≥ 36, зона нажатия ≥ 44 за счёт `::before`) |
| `.glass-button` | круглая кнопка 44×44 |
| `.glass-button-primary` | залитая акцентом круглая кнопка (отправить, новый чат) |
| `.glass-active` | модификатор активного пункта |

Отклик на нажатие, фокус, `prefers-reduced-motion`, `prefers-reduced-transparency`, `@supports not (backdrop-filter…)` —
внутри этих классов. Компоненты `backdrop-blur-*` и `backdrop-filter` сами не пишут.

Нижняя панель: `:root { --bottom-bar-space: 0px }`, `html.has-bottom-bar { --bottom-bar-space: calc(64px + var(--safe-bottom)) }`.
Правило задаёт таск 02; класс `has-bottom-bar` на `<html>` ставит и снимает `BottomBar` (таск 04). Кто должен
освободить место под панель — читает `--bottom-bar-space`.

Удаляется: `.nav-glass`, `.mobile-nav-float`, `.nav-tab-active` и все их переопределения, `--nav-glass-*`,
`--nav-tab-*`, `--nav-float-*`, `--mobile-nav-*`, `spacing['mobile-nav']` в `tailwind.config.js`.
**Живые, не трогать:** `.nav-divider`, `.nav-search-input`, `--nav-divider-color`, `--nav-input-bg`,
`--nav-input-focus-ring`, `--header-*`, `--panel-*`, `--shell-*` (ими управляет тонкая настройка).

### 2. Реестр тем — `src/contexts/` (владелец: таск 02)

- `THEMES = ['ember', 'codex', 'bio', 'neon', 'glass', 'claudeLight']`, `DEFAULT_THEME = 'ember'`,
  `LIGHT_THEMES = ['glass', 'claudeLight']` (и копия в `index.html`).
- `THEME_LABELS`: `ember 'Оранжевая'`, `codex 'Графит'`, `bio 'Био'`, `neon 'Неон'`, `glass 'Бирюзовая'`, `claudeLight 'Светлая Claude'`.
- Новый чистый модуль `src/contexts/themeMigration.js` (без DOM и React):
  - `NEON_VARIANTS`: `[{ id, label, legacyTheme, file }]` — `city` «Голубой» ← `neonCity`, `synthwave` «Розовый» ← `synthwaveDrive`,
    `nebula` «Мятный» ← `nebulaFlow`, `mission` «Синий» ← `missionControl`, `bento` «Зелёный» ← `bento3d`,
    `chrome` «Сиреневый» ← `liquidChrome`, `zen` «Янтарный» ← `zenParticles`, `kinetic` «Лаймовый» ← `kineticType`;
    `file` — прежнее фото `<legacyTheme>.jpg` из `public/theme-bg/` (файлы не переименовывать и не удалять).
  - `DEFAULT_NEON_VARIANT = 'city'`.
  - `LEGACY_THEME_MAP` — убранный id → `{ theme, neonVariant? }`: 8 фото-тем → `neon` + вариант; `gt`, `claude` → `ember`; `editorial` → `glass`.
  - `migrateThemeId(id)` → `{ theme, neonVariant, migrated }`; неизвестный id → `ember`.
- `index.html` (скрипт до отрисовки) держит свою копию `LEGACY_THEME_MAP` и списка светлых тем; тест сверяет обе копии.
- Вариант «Неона»: атрибут `data-theme-variant="<id>"` на `<html>` только при теме `neon`; ключ устройства
  `localStorage.neonVariant`; в значении контекста `useTheme()` — `neonVariant`, `setNeonVariant(id)`.
  В CSS: `[data-theme='neon']` — полный набор значений, `[data-theme='neon'][data-theme-variant='<id>']` — только акцент и то, что от него зависит.
- Сохранённая тонкая настройка (`themeTweaks`) убранных тем не переносится: записи с чужими id отбрасываются при чтении.
- `ThemeBackground.tsx`: `FLAT_THEMES = codex, glass, claudeLight, bio`; `PHOTO_THEMES = neon` (файл — по варианту); `ember` — видео, как было.
- Условие фона в `AppContent.tsx:269` — без `'claude'`, `'claudeLight'` остаётся (его ищет тест).

### 3. Тема на устройстве и выбор — `src/contexts/ThemeContext.jsx`, `src/components/settings/` (владелец: таск 03)

- Истина — `localStorage.appTheme` (+ `neonVariant`). Ответ `GET /api/settings/ui-preferences` применяет `theme`
  только если на устройстве темы ещё нет. `setTheme` по-прежнему шлёт `PUT {theme}` (стартовая тема аккаунта).
- Остальные ключи (`shaderEnabled`, `uiScale`, `themeBackgrounds`, `themeTweaks`, `customBackground`, моды) — как было.
- Предложение агента `settings.propose {theme}` меняет только стартовую тему аккаунта — это следствие, не чинить.
- Один компонент `ThemePicker` (`src/components/settings/view/tabs/ThemePicker.tsx`) — карточки тем + ряд вариантов «Неона»;
  его ставят и `AppearanceSettingsTab.tsx`, и `QuickSettingsContent.tsx` вместо своих `<select>`.

### 4. Нижняя панель — `src/components/bottom-bar/` (владелец: таск 04)

- `bottomBarModel.ts` (чистые функции, тест без браузера):
  - `isBottomBarVisible({ isMobile, isHome, drawerOpen, keyboardOpen, searchActive })` → `boolean`
    (`isMobile && (isHome || drawerOpen) && (!keyboardOpen || searchActive)`);
  - `activeBottomBarItem({ isHome, drawerOpen })` → `'home' | 'projects' | null`;
  - `pickNewChatProject(projects)` → проект с самым свежим чатом или `null`.
- `BottomBar.tsx` — монтируется в `AppContentInner` ребёнком `div.app-shell`, **не внутри `<Sidebar>`**;
  позиция `fixed inset-x-0 bottom-0 z-[60]` (без `inset-0` — его двигает `body.pwa-mode`). Пункты: `home`, `projects`, `search`, `new-chat`, `settings`.
- Строка поиска панели — одно состояние в `AppContentInner` (`navQuery`, `setNavQuery`): на «Домой» его получает
  `HomeLauncher` (вместо своего `HomeSearchField` на телефоне), в шторке — `Sidebar` как `searchFilter`.
- Счётчик «Канцелярии» на кнопке настроек — из `usePlannerAttention()`.

### 5. Экраны бывшего «Меню» — `src/components/tools/` (владелец: таск 04)

- `toolPanels.ts`: `TOOL_PANELS: { key, label, purpose, iconKey, access: 'all' | 'owner', mod? }[]` — 12 записей
  (`nightshift`, `consigliere`, `mazda`, `agent-workspace`, `schedules`, `pipelines`, `governance`, `server`, `duet`,
  `agents`, `queue`, `krabik`); `visibleToolPanels({ isOwner, mods })`; `isToolPanelKey(key)`.
  Права — те же, что сейчас в `SidebarFooter.tsx` (`isOwner`, `modDuet`, `modAgents`, `modAgentQueue` требует `modAgents`, `modKrabikAgent`).
- `ToolPanelsHost.tsx` — смонтирован всегда (в `AppContentInner`): держит `openPanel`, слушает `?panel=`,
  `notification:navigate`, `OPEN_HUB_PANEL_EVENT`, `neo3:workspace-close`, рисует те же `PanelModal` и `NightshiftModal`.
  Все три входа принимают один набор ключей — `TOOL_PANELS`.
- Открыть экран откуда угодно — `requestHubPanel(key)` из `hub/hubPanels.ts`; `HubPanelKey` расширяется до всех 12 ключей + `'settings'`.
- Вкладка настроек — id **`instruments`** (не `tools`: он занят), подпись «Инструменты»; компонент
  `InstrumentsSettingsTab.tsx`; добавить в `SettingsMainTab`, `BASE_NAV_ITEMS`, `KNOWN_MAIN_TABS`, `SETTINGS_MAIN_TABS`, `mainTabs.instruments` (ru, en).
- `SidebarFooter.tsx` после таска: баннер перезапуска, разделитель, кнопка «Настройки» (на `md+`), строка версии. Ни списка, ни слушателей.

### 6. Стенд — `scripts/preview-stand/` (владелец: таск 01)

- Одна точка входа `scripts/preview-stand/stand.mjs` с командами `up`, `down`, `status`.
  `up`: сборка клиента этой копии, сервер через `tsx server/index.js` с временным `HOME`/базой на свободном порту,
  тестовый пользователь, печать адреса и готовой ссылки «рамка телефона».
- Рамка телефона — страница с `<iframe>` шириной 390 или 430 на том же адресе; тема, вариант и вход задаются параметрами ссылки.
- Точные команды и параметры после таска 01 — в разделе «Что построено» ниже.

### Швы для тестов

`migrateThemeId` и таблицы (`themeMigration.js`) · чтение значений тем из `index.css` (как в `theme-registry.test.ts`) ·
`bottomBarModel.ts` · `toolPanels.ts` · рендер-тесты `renderToStaticMarkup` для `BottomBar`, `InstrumentsSettingsTab`, `ThemePicker`.

## Что построено

<!-- дописывается после каждого таска: что появилось и как этим пользоваться -->

### Таск 02 — стекло и шесть тем (сдан)

- Реестр: `THEMES = ember, codex, bio, neon, glass, claudeLight`; `LIGHT_THEMES = glass, claudeLight`.
- Значения стекла в каждой теме: `--glass-bg`, `--glass-bg-strong`, `--glass-blur`, `--glass-saturate`, `--glass-border`,
  `--glass-highlight`, `--glass-shadow`, `--glass-fallback-bg`, а также `--glass-scrim` (цвет затемнения за листом).
  Производные в `:root`: `--glass-ring`, `--glass-accent-bg`, `--glass-accent-fg`, `--glass-active-bg`, `--glass-active-fg`, `--glass-radius`.
- Классы: `.glass-surface`, `.glass-sheet`, `.glass-pill`, `.glass-button`, `.glass-button-primary`, `.glass-active`,
  `.glass-scrim` (затемнение и размытие ЗА листом — для оверлея шторки и подобных). Раздел в `src/index.css`
  между `/* glass:start` и `/* glass:end */`. В экранах классы ещё не расставлены — это таски 03–05.
- `--bottom-bar-space` (`0px`) и `html.has-bottom-bar` заданы.
- `src/contexts/themeMigration.js`: `NEON_VARIANTS`, `DEFAULT_NEON_VARIANT`, `LEGACY_THEME_MAP`, `migrateThemeId(id)`,
  `isNeonVariant(id)`, `resolveNeonVariant(id)`, `neonVariantFile(id)`. `ThemeContext` реэкспортирует `NEON_VARIANTS`, `DEFAULT_NEON_VARIANT`.
- `useTheme()` += `neonVariant`, `setNeonVariant(id)`; id вариантов: `city, synthwave, nebula, mission, bento, chrome, zen, kinetic`.
- `parseTweakMap(json, themeIds?)` отбрасывает записи чужих тем.
- `ShaderBackground.tsx` удалён (не импортировался).
- `useAuth` в коде, который грузится тестами под node, брать из `auth/context/AuthContext`, а не из бочки `../auth`
  (бочка тянет терминал и `xterm.css`) — так починен D01.
- Характер тем: Оранжевая — Geologica, 10px, тёплое дымчатое стекло; Графит — системный шрифт, 8px, матовый, без теней;
  Био — General Sans + IBM Plex Mono в чипах, 12px, чёрный с волосяными линиями; Неон — JetBrains Mono, 6px, свечение акцента;
  Бирюзовая — Outfit, 16px, белый иней; Светлая Claude — системный + засечные заголовки, 10px, бумага и калька.
