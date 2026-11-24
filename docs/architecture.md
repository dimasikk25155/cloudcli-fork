# Архитектура workspace

## Запросы и данные

`server/index.js` монтирует приватный `/api/agent-workspace` за `authenticateToken`; `/api/public-intake` подключён отдельно, до аутентифицированных роутов. `server/modules/agent-workspace/runtime.ts` лениво собирает зависимости после старта БД, связывает feature-сервисы и их handoff-resolver. Не переносить инициализацию БД на import-time.

`agent-workspace/store.ts` — общий SQLite-репозиторий `workspace_records`: типизированный `kind`, владелец, проект, JSON payload и revision. Обновление — compare-and-set по ожидаемой revision; конфликт отдаётся как 409. Права на пользователя и проект каждый запрос проверяет через `projectAccessFor`/`isAdminUser` и `requireWorkspaceProject`; присланный owner не является источником прав.

Основной router владеет задачами дня, приоритетами и передачей материалов. Почта, документы/знания и команда подключаются feature-роутерами. Публичные анкеты имеют собственные ограниченные capability-токены и не дают посетителю указать проект или исполнителя. Доступ к данным сотрудника после выдачи поручения всё равно зависит от актуального project grant.

## Передача в чат и агентные инструменты

UI `SendToAgentButton` запрашивает серверный handoff; сервер заново проверяет доступ к проекту и источнику, сохраняет grant с версией/контекстом. Клиент добавляет текст к черновику проекта и хранит grant в session storage. При создании обычного чата grant привязывается к его session id; сбой связывания сохраняет ещё не обработанные передачи. Так handoff не запускает отдельный, неограниченный agent-run.

`server/modules/agent-workspace/tools.ts` определяет allowlist действий MCP. Перед каждым вызовом проект чата повторно определяется и проверяется; письмо читается/черновик создаётся только при наличии handoff этого письма в этот чат. Агент может читать и готовить материалы, но не утверждать шаблоны/версии, отправлять почту или публиковать формы. UI-человек выполняет эти действия явно.

## Границы и проверка

Провайдер почты использует только фиксированный AgentMail API; inbox привязан к владельцу конфигурации. Без credentials статус остаётся `configured:false`, сообщения могут отвечать 503 — это не доказывает доставку или работоспособность live-интеграции. Документные версии неизменяемы, согласование связано с конкретной версией; новая редакция сбрасывает прежнее согласование. Поиск знаний ограничен включёнными документами и правом на проект.

Схемы общих DTO находятся в `shared/agent-workspace.ts` и соседних `shared/agent-mail.ts`, `shared/managed-documents.ts`, `shared/workspace-team.ts`. Изменяя форму записи, поддерживайте сервер, клиент и схемы вместе. Не добавляйте данные личного vault в индекс знаний без отдельного opt-in.

Приёмка 2026-11-02 подтвердила сборку, старт локального сервера и HTTP сценарии в изолированной копии. Она не подтвердила браузерный UI (Edge отсутствовал), live AgentMail, запуск модели, чистую установку или production. Зависимости в рабочей копии подключены symlink; установка пакетов отдельно не проверена.

## Рабочий стол и правка артефактов (04.11.2026)

Рабочий стол (`modWorkbench`) — холст вкладок в `src/components/workbench/`; режим «Правка» (`modArtifactEditor`, требует `modWorkbench`) — в `workbench/artifact-editor/`. Обычный чат остаётся; при включённом столе шапка (`MainContentHeader.tsx`) не показывает свитчер вкладок, `resolveActiveTab` (`mainContentTabs.ts`) держит `activeTab='chat'`, а терминал, файлы, статистика, автопилот и плагин-вкладки открываются в холсте (`projectTabs.tsx`).

### Вкладки холста

Вид вкладки описан в `workbenchTabs.ts` (`WorkbenchTabKindDef`: `keepMounted`, `available(ctx)`, `inMenu`); решения принимает чистая модель `workbenchCanvasModel.ts` (`buildWorkbenchMenu`, `markVisitedKeepMounted`, `planCanvasPanes`), состояние — `workbenchStore.ts` (по сессии, черновик `draft` переезжает через `moveDraftTabs`). Открытая хоть раз `keepMounted`-вкладка остаётся смонтированной; скрытая получает `invisible absolute`, не `display:none` (иначе xterm меряет себя как 2×1).

### Поток данных правки

1. Исходник: `useArtifactContent` читает файл последней версии артефакта (html, slides или svg), запоминает `baseVersionN`.
2. Копия: `instrumentSource` (`editorModel.ts`) парсит исходник через `DOMParser` и ставит каждому элементу `data-neo3-id`; оригинальная строка не меняется. Идентификаторы живут одну сессию правки.
3. Превью: `previewHtml` вставляет в начало `<head>` инлайн-мост `buildBridgeScript(nonce)` (`bridge.ts`; внутри — `applyOpToDocument.toString()`). Клиент отправляет копию в `POST /api/projects/:projectId/artifacts/:id/editor-preview` → `artifactsService.editorPreview` → `filePreviewService.createDocumentGrant` (грант «копия документа»: HTML из памяти, остальные файлы относительно корня — с диска; ≤ 20 грантов). iframe: `sandbox="allow-scripts"` без same-origin.
4. Операции: пользователь выбирает и двигает элементы в оверлее (`SelectionOverlay.tsx`, `snap.ts`, `zoomModel.ts`); `ArtifactEditor` формирует `EditorOp` и через `createStackEntry` снимает обратную операцию и отпечаток; операция применяется и к живой копии (`editorStore` держит её в памяти — переживает смену вкладки), и в iframe через сообщение `apply`. Мост отвечает `ready`/`hover`/`pick`/`rects`/`siblings`/`textCommitted`/`snapshot`/`scroll`; каждое сообщение проходит `validateBridgeMessage` и проверку `event.source` + `nonce`.
5. Сохранение: `serializeDocument` убирает `data-neo3-id`, сохраняет doctype и текст до `<body>` и после `</body>` байт в байт → `PUT .../artifacts/:id/edit {content, baseVersionN}` → `artifactsService.saveEdit`.
6. Версия: сервис сверяет sha файла с sha версии `baseVersionN` (она должна быть последней), пишет файл по realpath после `isInside`/`isPrivateRealPath`, добавляет версию с источником `'edit'` («Правка вручную») и возвращает `ArtifactDetail`. При расхождении — 409 `ARTIFACT_EDIT_CONFLICT` с `details.latestVersion`: правка агента уже записана версией, клиент берёт новый исходник и переигрывает свой стек `replayOps` (элемент ищется по `fingerprintFor`: путь тегов + начало текста).

Вторая дорожка — «Попросить агента» (`artifact-editor/askAgent/`): правку формулирует человек (в том числе с вырезкой области `cropRegion.ts` и снимком элемента `snapshot`), `askAgentModel.ts` собирает сообщение, `sendToComposer` кладёт его и картинки в композер чата. Агент меняет файл сам, и появляется версия, а не `'edit'`. Для растровых картинок это единственный путь.

### Границы модулей

- Чистая логика (без React): `editorModel.ts`, `snap.ts`, `frames.ts`, `editorProtocol.ts`, `zoomModel.ts`, `editorUiModel.ts`, `askAgentModel.ts`. Тестируются в node, кроме DOM-функций `editorModel.ts` (их проверяет `selftest.ts` в браузере, `?neo3EditorSelfTest=1`).
- `applyOpToDocument` самодостаточна: ни импортов, ни замыканий — её исходный текст исполняется внутри iframe. Любая зависимость внутри неё ломает мост молча.
- Только `bridge.ts` и `useEditorBridge.ts` знают о `postMessage`; остальные части видят `ArtifactEditorApi` через `editorContext.ts` (`useArtifactEditor`).
- Сервер: `artifacts.service.ts` владеет правилами (мод, kind, размер, sha, realpath, очередь `serialized(id, …)`); `file-preview.service.ts` не знает про артефакты — только про грант с HTML; `artifacts.routes.ts` лишь разбирает тело (`express.json({limit:'3mb'})` на роутах правки).
- Доступ — `server/shared/project-access.ts`; админ — `isAdminUser`; мод — `isModOn`/`modOffError` (`shared/mods.ts`). Запись MCP и значения `env`/`headers` — только админу (`requireMcpAdmin`, `redactMcpServerSecrets`).
- Мастер-сессия (`server/modules/master-session/`): идемпотентность отправки — ledger `master-send` поверх `workspace_records`; права тиммейтов не расширяются.

### Соглашения

- Ошибка API: `{success:false, error:{code, message, details}}` (`apiErrorHandler`, `server/shared/utils.ts`); клиент читает `body.error.details`.
- Сдвиг элемента: HTML — CSS `translate`, SVG — атрибут `transform` в единицах viewBox; `transform` авторского HTML не трогается.
- `Rect` в сообщениях моста — CSS-пиксели документа без масштаба; масштаб (`zoom`) применяет родитель (`docRectToScreen`).
- Новая операция правки добавляется в `EditorOp`, `applyOpToDocument`, `inverseOp`, `validateBridgeMessage` (если ходит через мост) и в самопроверку одновременно.
- Тексты интерфейса — по-русски; каждая функция за своим модом; служебные WS-кадры не входят в `CHAT_ROW_KINDS`.
- Проверка без живого Chrome: самопроверка и клиент в WKWebView (маленькое Swift-приложение вне репозитория), сервер — отдельным процессом с временными `HOME` и `DATABASE_PATH`. Боевой runtime, `dist/` и `dist-server/` не изменяются.

## Оформление и оболочка телефона (23.11.2026, ветка `feat/neo3-glass-themes`)

Правила вида (палитры, радиусы, что можно и нельзя) — в `DESIGN.md`; здесь только устройство и границы.

### Темы
- Реестр — `src/contexts/ThemeContext.jsx`: `THEMES` (`ember, codex, bio, neon, glass, claudeLight`), `THEME_LABELS`, `LIGHT_THEMES` (копия — в `index.html`). Контекст пишет `data-theme` (и `data-theme-variant`, только при `neon`) на `<html>`; значения темы — плоский блок `[data-theme='…']` в `src/index.css`, который читает `theme-registry.test.ts`.
- Вариант «Неона» — акцент и производные в `[data-theme='neon'][data-theme-variant='<id>']`; список и фото фона — `NEON_VARIANTS` в `src/contexts/themeMigration.js`. Тема и вариант хранятся на устройстве (`localStorage.appTheme`, `neonVariant`).
- Убранные id подменяет чистая `migrateThemeId` (`themeMigration.js`, без DOM и React) дважды: скриптом в `index.html` до первой отрисовки (своя копия таблицы, тест сверяет обе) и в контексте. Подмена никогда не ведёт на `claudeLight`. Сохранённая тонкая настройка чужих тем отбрасывается при чтении (`parseTweakMap`).
- Устройство против аккаунта: `deviceTheme.js` решает, применять ли тему из `GET /api/settings/ui-preferences` (только когда человек на этом устройстве ещё не выбирал; тема, записанная самим кодом, выбором не считается). `setTheme` шлёт `PUT {theme}` — это стартовая тема аккаунта. `AuthProvider` стоит выше `ThemeProvider` (`src/App.tsx`), настройки перечитываются при смене токена.
- Выбор темы — один `settings/view/tabs/ThemePicker.tsx`, его ставят `AppearanceSettingsTab` и быстрые настройки. Фон — `branding/ThemeBackground.tsx` (`FLAT_THEMES`, фото только у `neon`, видео у `ember`).

### Слой стекла
- Поток: значения `--glass-*` в блоке темы → закрытый набор классов в `src/index.css` (между `/* glass:start` и `/* glass:end */`: `.glass-surface|sheet|dense|pill|button|button-primary|handle|scrim|active`) → компоненты, которые лишь вешают класс. Размытие, кромку, запасной плотный фон (`@supports not`, `prefers-reduced-transparency`), отклик и зону нажатия 44 px знают только эти классы; компоненты `backdrop-filter` не пишут.
- `.glass-surface` — небольшие плавающие вещи (поле ввода, панель); `.glass-sheet` — крупные (шапки, шторка), под `has-live-wallpaper` размытие снимают. Производные (`--glass-ring`, `--glass-accent-*`) пересчитываются в любом элементе с `data-theme`.
- Размытие у предка делает его контейнером для `position: fixed` потомков: плавающее выносят из такого предка (панель — не в `<Sidebar>`, окна — порталом в `body`).

### Нижняя панель
- `src/components/bottom-bar/`: `bottomBarModel.ts` (чистые `isBottomBarVisible`, `activeBottomBarItem`, `pickNewChatProject`) и `BottomBar.tsx`. Монтируется в `AppContentInner` (`components/app/AppContent.tsx`) ребёнком `app-shell`, рядом с `ToolPanelsHost`, не внутри шторки; поэтому видна и на «Домой», и поверх шторки.
- Единственное состояние строки поиска (`navQuery`, `navSearchOpen`) живёт в `AppContentInner`: на «Домой» его принимает `HomeLauncher`, в шторке — `Sidebar` как `searchFilter`. Панель ставит на `<html>` класс `has-bottom-bar`; место под неё задаёт `--bottom-bar-space`, кому нужно освободить низ — читает его.

### «Инструменты»
- Реестр — `src/components/tools/toolPanels.ts` (`TOOL_PANELS`: ключ, подпись, значок из `menu-icons/`, `access: 'all'|'owner'`, `mod`); `visibleToolPanels` и `canOpenToolPanel` применяют права (`useToolPanelAccess`). Сайдбар списка экранов не знает.
- `ToolPanelsHost.tsx` смонтирован всегда и один держит открытый экран. Три входа принимают один набор ключей: `?panel=`, сообщение `notification:navigate` и событие `requestHubPanel(key)` (`hub/hubPanels.ts`; `HubPanelKey = ToolPanelKey | 'settings'`).
- В настройках — вкладка `instruments` (не `tools`, он занят): `InstrumentsSettingsTab.tsx` рисует карточки из реестра и зовёт `onOpenPanel`; константы вкладок — `settings/constants/constants.ts`.

### Стенд
- `scripts/preview-stand/` (`stand.mjs up|status|down`, `seed.mjs`, `lib.mjs`, `frame/`): собирает клиент этой копии, поднимает сервер на `127.0.0.1` с временным `HOME`/базой и тестовыми данными, отдаёт `/stand/frame.html` — `<iframe>` 390/430 с темой и входом из параметров ссылки; секрет сессии свой для каждого `up`. Границы: только из рабочей копии, боевой `~/.cloudcli` не читает и не пишет. Не воспроизводит режим «с домашнего экрана», вырезы, клавиатуру; встроенный браузер не рисует размытие в снимок.
