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
