# Предложение для `claude agent/CLAUDE.md` (сам файл не тронут)

Ветка `feat/neo3-glass-themes` (worktree `claude agent/neo3-glass`, сборка `08e23a90..HEAD`), в `dima/fork-customizations` не влита, боевой Neo3 её не содержит. Пути ниже — от корня этой копии.
Вставить новым разделом после «Очередь сообщений и удержание фона».

## Часть А. Добавить

```md
## Стекло, шесть тем, нижняя панель, «Инструменты» (23.11, ветка `feat/neo3-glass-themes`, НЕ влита и НЕ выкачена)

- Темы: `THEMES = ember, codex, bio, neon, glass, claudeLight` (`src/contexts/ThemeContext.jsx`); убранные id (8 фото-тем, `gt`, `claude`, `editorial`) подменяет `migrateThemeId` в `src/contexts/themeMigration.js` (копия таблицы — в `index.html` до отрисовки, тест сверяет обе). «Неон» имеет 8 вариантов (`NEON_VARIANTS`, `data-theme-variant`, ключ устройства `neonVariant`).
- Тема живёт на устройстве (`localStorage.appTheme`); ответ сервера применяется только на пустом устройстве — `src/contexts/deviceTheme.js`. Выбор — один `settings/view/tabs/ThemePicker.tsx` (и в настройках, и в быстрых).
- Стекло: значения `--glass-*` в каждом `[data-theme]` блоке `src/index.css`, классы между `/* glass:start` и `/* glass:end */` (`.glass-surface|sheet|pill|button|button-primary|dense|scrim|handle|active`). В компонентах `backdrop-filter`/`backdrop-blur-*` не писать. Правила и палитра — `DESIGN.md` в корне.
- Нижняя панель телефона: `src/components/bottom-bar/` (`bottomBarModel.ts` — видимость и активный пункт, `BottomBar.tsx`); монтируется в `AppContent.tsx` рядом с `ToolPanelsHost`, место под неё — `--bottom-bar-space`.
- «Инструменты»: реестр `src/components/tools/toolPanels.ts` (`TOOL_PANELS`, 12 экранов, права `access`/`mod`); хозяин `ToolPanelsHost.tsx` смонтирован всегда, три входа: `?panel=`, `notification:navigate`, `requestHubPanel(key)` (`hub/hubPanels.ts`). Вкладка настроек — `instruments` (`InstrumentsSettingsTab.tsx`). Новый экран = строка в `TOOL_PANELS` + значок в `menu-icons/`.
- Строки настроек — через `SettingsRow` (на телефоне элемент управления уходит под текст); кнопки поля ввода — `chat/view/subcomponents/composerChips.tsx`.
- Стенд (экраны телефона без боевого Neo3, только из этой копии, временный `HOME`): `node scripts/preview-stand/stand.mjs up [--port N] [--no-build]` (порт 3917; печатает ссылки рамки), `status`, `down`; после правок кода — `down` и снова `up`. Рамка `/stand/frame.html?w=390|430&theme=&variant=&themes=…&key=<секрет из up>`; в странице — `window.stand.info()/click()/clickText()/each()`. Тест частей стенда: `node --test scripts/preview-stand/lib.test.mjs` (в `npm test` не входит).
- Проверка ветки: `npm run typecheck` и `TMPDIR="$(node -p 'require("node:fs").realpathSync(require("node:os").tmpdir())')" npm test` (2509 прошли, 0 упали), клиент вхолостую — `node_modules/.bin/vite build --outDir "$(mktemp -d /tmp/neo3-client-check.XXXXXX)"`.
- Грабли: встроенный браузер Neo3 не рисует `backdrop-filter` в снимок (размытие проверять по CSS, не по картинке); рамка стенда не воспроизводит «с домашнего экрана», вырезы и клавиатуру — это проверять на айфоне.
- Грабли: размытие у предка ломает `position: fixed` потомков — `BottomBar` вне `<Sidebar>`, окна (например «Где мой код») порталом в `body`; позиция панели `inset-x-0 bottom-0`, без `inset-0` (его двигает `body.pwa-mode`).
- Грабли: `useAuth` в коде, который грузят тесты под node, брать из `auth/context/AuthContext`, не из бочки `auth` (тянет терминал и `xterm.css`).
- Грабли: блок значений темы в `index.css` — плоский до первой `\n}` (так его читает `theme-registry.test.ts`); id вкладки настроек `tools` занят, «Инструменты» = `instruments`.
- Грабли: под нагрузкой машины `threads-mcp`, `pipelines.service`, `safari-live.browser` падают по таймауту, по отдельности зелёные.
```

## Часть Б. Стало неправдой (после влития ветки)

1. Строка 262 — «Новый пункт меню = ключ + рисунок + градиент там же.» → «Новый экран бывшего меню = строка в `TOOL_PANELS` (`src/components/tools/toolPanels.ts`) + ключ, рисунок и градиент в `menu-icons/`; значки там нужны карточкам «Инструментов» в настройках».
2. Строка 263 — «`SidebarFooter.tsx` → `SidebarMenuItems.tsx` (`variant: 'list'` … 'grid' …). Складка «Меню» на всех ширинах; … проп `drawerOpen` … `sidebarMenuState.ts`.» → «Складки «Меню» нет: `SidebarMenuItems.tsx`, `sidebarMenuState.ts` и пропа `drawerOpen` удалены; экраны открывает `ToolPanelsHost`, из шторки и «Домой» — нижняя панель и вкладка настроек «Инструменты»; `SidebarFooter.tsx` — баннер перезапуска, «Настройки» на `md+`, версия».
3. Строка 263 (конец) — «Док главной (`HomeLauncher.tsx`) рисуется `NeonTile`» уже была неправдой с 23.11 (дока нет); заменить на «Значки проектов на «Домой» — `NeonTile` в `home/HomeProjectTile.tsx`».
4. Строка 265 — «тема `glass` гасит svg в `.sidebar-footer-item` … Тесты: … `SidebarMenuItems.test.ts`, `sidebarMenuState.test.ts`» → убрать два удалённых теста и правило про `.sidebar-footer-item` (проверить `[data-menu-tile]` в `index.css`); тема `glass` теперь «Бирюзовая» светлая, не «серое стекло».
5. Строка 280 — «☰ и шестерёнка — круглые `NeonTile` по бокам часов (`HomeClockRow`, глиф `menu`)» → «На компьютере у часов только шестерёнка «Настройки»; на телефоне у часов цифры одни, а проекты, поиск и настройки — в нижней панели `bottom-bar/`».
6. Строка 279 — «шестерёнка «Настройки» у часов (`NeonTile shape='circle'`), под датой — `SessionHubBar`» → добавить «только на компьютере; на телефоне настройки в нижней панели».
7. Строки 323 и 389 — «пункт меню `KRABIK_PANEL` / `AGENTS_PANEL` / `QUEUE_PANEL` в `SidebarFooter.tsx`» → «запись в `TOOL_PANELS` (`src/components/tools/toolPanels.ts`)»; `SidebarFooter.tsx` списка пунктов больше не держит.
8. Строка 268 — «Тема `bio` … видна во всех темах» верно, но список тем в проекте теперь шесть: `ember, codex, bio, neon, glass, claudeLight`; тема `bio` — одна из них; остальные id (`neonCity`, `gt`, `claude`, `editorial` …) подменяются, не используются.
9. Строка 297 — «2467 тестов, 2466 прошли; падает только `HomeLauncher.render.test.ts`» относится к ветке `no-wait`; для ветки glass — 2509/0 (не путать при сравнении).
