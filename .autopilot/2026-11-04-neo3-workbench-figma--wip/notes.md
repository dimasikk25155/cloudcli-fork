# Карта кода (разведка 04.11 17:06, worktree от 3e2e8862)

Пути от корня worktree. Что построила прошлая сборка — `.autopilot/2026-11-04-neo3-workbench-video/interfaces.md` («Что построили сданные таски»).

## Шапка и вкладки
- `src/components/main-content/view/subcomponents/MainContentHeader.tsx`: `relative flex items-center gap-3`; слева `MobileMenuButton`, «Домой» (мобила), `MainContentTitle` (`md:hidden`); по центру абсолютный `main-content-title` (`hidden md:flex`, `max-w-[52%]`); справа: `workbenchToggle` (только `activeTab==='chat'`), `CodeStatusChip` (мод `modCodeStatus`, только чат), `BotHealthButton`, `PlannerAttentionButton` (колокольчик), прокручиваемый `MainContentTabSwitcher` (кнопка «Т» `Type` → `toggleCompact`, localStorage `neo3-compact-tab-labels`).
- `mainContentTabs.ts`: `BASE_TABS` = chat, shell, files, stats; `AUTOPILOT_TAB` (id `autopilot`, `shouldShowAutopilotTab`); плагины `plugin:<name>` (без `project-stats`); `assembleMainTabs({terminalDisabled, shouldShowAutopilotTab, plugins, localize})`. `git`/`browser` в `AppTab` (`src/types/app.ts:84`) есть, в свитчере нет.
- `activeTab/setActiveTab` — пропсы из `AppContent.tsx` в `MainContent`. В `MainContent.tsx` тела: `ChatInterface` всегда смонтирован (block|hidden); `files` → `<FileTree selectedProject onFileOpen={handleFileOpen}/>` (`handleFileOpen` из `useEditorSidebar`); `shell` → `ShellModeSwitcher` + `<StandaloneShell key={shellMode} project session={shellMode==='plain'?null:selectedSession} isPlainShell showHeader={false} isActive/>` (`shellMode` локальный state); `stats` → `ProjectStatsPanel selectedProject`; `autopilot` → `AutopilotPanel url={autopilot.url}` из `useAutopilotDashboard(selectedProject?.projectId)`; `plugin:*` → `PluginTabContent pluginName selectedProject selectedSession`; аварийные сбросы на `'chat'`.
- 390 px: кнопки справа `h-8 w-8 flex-shrink-0`, сжимается только прокручиваемый блок свитчера; заголовок обрезается, `CodeStatusChip` давит правый блок.

## Рабочий стол `src/components/workbench/`
- `workbenchTabs.ts`: union `WorkbenchTabKind` = inspector|limits|artifacts|artifact|btw|chat|advisor|report; `registerWorkbenchTabKind(kind, {render(tab, ctx), icon, defaultTitle, inMenu?})`, `getWorkbenchTabKind`, `listWorkbenchTabKinds`; `WorkbenchRenderContext {sessionId, project, session, openTab, closeTab}`.
- `WorkbenchCanvas.tsx` (`{project, session, onBack?}`): меню «+» = `listWorkbenchTabKinds().filter(d => d.inMenu)` (сейчас только inspector, limits); `EMPTY_SHORTCUTS`; рендерит **только активную** вкладку (`<React.Fragment key={activeTab.id}>`).
- Регистрация видов: свой файл + импорт в `index.ts` (там `sidechat/registerSideChatTabs`, `artifacts/artifactTabs`, `advisor/registerAdvisorTab`); `builtinTabs.tsx` (inspector, limits).
- `workbenchStore.ts`: `createWorkbenchStore`, `openTab/closeTab/setActive`, localStorage `neo3.workbench.tabs.<sid|draft>`, `WORKBENCH_DRAFT_SESSION='draft'`; метода переноса draft→sid нет. `useWorkbench.ts`.
- Телефон: в `MainContent.tsx` `workbenchOn = useModEnabled('modWorkbench')`, `mobileCanvasOpen`, оверлей `fixed inset-0 z-40 data-workbench-mobile` при `workbenchOn && isMobile && mobileCanvasOpen`; `WorkbenchToggle` (мобила — иконка `PanelRightOpen`); холст закрывается при `!isMobile || !workbenchOn || activeTab!=='chat'`. Мод выкл → `workbenchToggle=null`, холста нет.
- Терминал: `Shell` — живой PTY через WS (`useShellTerminal.ts`, xterm). Размонтирование при смене вкладки холста — проверить, переживает ли PTY (`autoConnect`, `isActive`).

## Панель диалогов
- `src/components/session-hub/SessionHubPanel.tsx:38` `const { items, byId, markSeen, refresh } = useAttention()`; «Прочитано» по строке → `markSeen({ sessionIds: [item.sessionId] })` при `canMarkRead(item)` (`sessionHubModel.ts`).
- `src/components/attention/useAttention.ts` → `attentionStore.markSeen(target)` → `POST /api/attention/seen`; `AttentionSeenTarget` уже допускает `{all:true}` (тест в `attentionStore.test.ts`). Сервер (`session-attention.routes.ts`, `service ~825`) `{all:true}` помечает done/failed и мягкие вопросы, открытые запросы не трогает.

## Шаги помощника
- `src/components/chat/utils/toolGrouping.ts` `groupConsecutiveTools(messages, showThinking)`, `TOOL_GROUP_THRESHOLD = 1`, группирует только `isToolUse && toolName && !isSubagentContainer`; `isTaskNotification` не группируются и разрывают серию. Вызов — `ChatMessagesPane.tsx:134`.
- `view/subcomponents/ToolGroupContainer.tsx`: свёрнут по умолчанию, метка `t('toolGroup.mixedLabel')` или `config.label`, `x{N}`, превью; английские `+N more`.
- `isTaskNotification` ставит `useChatMessages.ts` (~229 из `<task-notification>`, ~371 из кадра `task_notification`, `content = summary`); `useChatSessionState.ts:77`; рендер `MessageComponent.tsx:137` (точка + серый текст).
- i18n `src/i18n/locales/{ru,en}/chat.json`: только `toolGroup.mixedLabel`.
- **Параллельная сессия в `cloudcli-fork/` (незакоммичено)** делает то же: `ToolGroupItem.isTaskNotifications?`, `TASK_NOTIFICATION_GROUP_THRESHOLD = 2`, ветка в `groupConsecutiveTools`, правки `ToolGroupContainer.tsx`, `chat.json`.

## Баги
- (а) `workbench/artifacts/ArtifactView.tsx`: `draftAnchor` (стр.45), `draftText` (46) — локальный state, textarea ~380. Образец стора — `createSideChatStore()` в `sidechat/sideChatModel.ts` (`getDraft/setDraft`, ключ `tab.id`, использование в `WorkbenchChatPane.tsx`).
- (б) Новый id сессии: `useChatComposerState.ts:1239` `onSessionEstablished?.(id, …)` → `ChatInterface.tsx:221` `handleSessionEstablished` → `AppContent.tsx:325–330` навигация + `registerOptimisticSession`.
- (в) `src/components/relay/useAutoRelay.ts`: общий модульный `statuses` Map; каждый экземпляр хука на кадр `auto_relay` делает `publish(next)` и сравнивает `shouldFollowMove(previous, next, openRef.current)` (`autoRelayModel.ts:43`) по общему previous — второй подписчик видит `previous===done` и не зовёт `onMoved`. Подписчики: `RelayBand` (ChatInterface, реальный `onMoved`) и `ContextLimitsCard` (`ignoreMoved`).
- (г) `workbench/inspector/SessionInspector.tsx` + `inspectorModel.ts`: строка `changes` «Изменения файлов» из `useCodeStatus(project.projectId)` (`git.lists.files`), `MAX_FILES_SHOWN=12`. Данные хода: Claude tool_use `Edit/Write/MultiEdit` `toolInput.file_path`; Codex `FileChanges` — история `toolInput.changes[{kind,path,moveTo?}]`, живой поток `toolInput` = массив; Grok — `search_replace`/`write_file` (поля проверить по фикстурам `providers/tests/fixtures/grok-*`). Факты сессии — `useSessionFacts.ts`.
- (д) `server/modules/master-session/master-session.service.ts:231` `delivered = new Map` ключ `${userId}:${batchId}:${sessionId}`, `BATCH_TTL_MS=24h`, `MAX_REMEMBERED=2000`, провал (кроме forbidden) удаляется. Хранилище есть: `workspace_records` через `createWorkspaceStore(db)` (`server/modules/agent-workspace/`), индексы `(owner_user_id, kind)`.
- (е) `server/modules/providers/provider.routes.ts:503–523` `GET /:provider/mcp/servers`: с `?scope=` отдаёт `servers` целиком; без scope — `listProviderMcpServers`, при `fields=names` → `mcpServerNamesByScope` (`providers/services/mcp.service.ts`). Админа не проверяет. `isAdminUser(user)` — `server/shared/project-access.ts:38`. Клиент холста `useSessionFacts.ts:177 useMcpNames` уже шлёт `fields=names`.
- Motion: `docs/video-mods-coverage.md` строка 52 `| 21 | Motion (17:06) | отложено | …|`, строка 150 «Платный Jev, Motion, облако…».

## Артефакты — сервер `server/modules/artifacts/`
- `artifacts.service.ts`, `artifacts.routes.ts`, `artifacts.runtime.ts`, `index.ts`; тесты `tests/artifacts.service.test.ts`, `tests/artifacts.routes.test.ts`; общие `shared/artifacts.ts`.
- `createArtifactsService({store, projectPath, canAccessProject, sessionProjectId?, isModOn?, fs?, snapshotRoot?, now?, limits?})`; `guard(userId, projectId)` = `modWorkbench` (409 MOD_OFF) + проект (404) + доступ (403).
- Хранилище `workspace_records` (`store.get/list/create/update(id, revision, payload)/transaction`), kind `artifact`, `artifact-version`, `artifact-comment`; у записей `revision`, `store.update` бросает при несовпадении.
- `ArtifactVersionPayload {artifactId, n, sha256, size, snapshotFile|null, createdAt, source, restoredFrom?}`, `ARTIFACT_VERSION_SOURCES = publish|change|restore`; снимки `~/.cloudcli/artifacts/<id>/v<n><ext>`; лимиты `ARTIFACT_TEXT_LIMIT_BYTES=2МБ`, binary 20МБ.
- `addVersion(userId, projectId, artifact, current, source, extra)`; `snapshotIfChanged`; `restore` уже пишет файл `fs.writeFile(resolved.absPath, data)` — образец для правки (но писать по проверенному realpath).
- `resolvePath`: `..`/`\0` → `ARTIFACT_PATH_INVALID`; `PRIVATE_SEGMENT` → `ARTIFACT_PATH_PRIVATE`; вне корня → `ARTIFACT_PATH_OUTSIDE_PROJECT`; `isPrivateRealPath(realRoot, realPath)` (baf761c4), повтор в `readCurrent`.
- REST `/api/projects/:projectId/artifacts` (index.js:309, authenticateToken): GET /, POST /, GET /:id, POST /:id/refresh, GET /:id/versions/:n/content (CSP `sandbox; default-src 'none'…`, HTML как text/plain), POST /:id/versions/:n/restore, comments…; ответ `{success, data}`, `AppError(message,{code,statusCode})`, `asyncHandler`, `context(req)`, `body(req)`.
- WS-кадра об изменении артефакта нет; агент пере-публикует путь → версия `change`.

## Артефакты — клиент `src/components/workbench/artifacts/`
- `artifactTabs.tsx` (виды `artifacts`, `artifact`, ref = id | `path:<путь>` → `PendingArtifact`), `ArtifactView.tsx` (448 строк), `RegionLayer.tsx`, `artifactModel.ts` (`rectFromDrag`, `MIN_SIDE`, `clamp01`), `artifactsApi.ts` (`authenticatedFetch`, `call<T>`, list/publish/detail/refresh/restore/addComment/updateComment/sendComments/versionBlob/fileBlob), `useArtifactContent.ts`, `lineDiff.ts` (`lineDiff(before, after)`, `MAX_DIFF_LINES=4000`, `DiffLine`), `ArtifactsList.tsx`, `OpenInCanvasButton.tsx`.
- HTML живьём: `useHtmlPreview(projectId, absPath, enabled)` (`src/components/code-editor/hooks/useHtmlPreview.ts`) → `POST /api/projects/:id/files/preview {path}` → url `/api/file-preview/<token>/<rel>`; `CodeEditorHtmlPreview.tsx` `<iframe src sandbox="allow-scripts" referrerPolicy="no-referrer">`. Только последняя версия; старые — текст в `<pre>`.
- Сервер превью `server/modules/file-preview/` (`file-preview.routes.ts`, `file-preview.service.ts`), монтаж index.js:297 без JWT (токен 24 байта, TTL 30 мин, ≤500 грантов, корень гранта = корень проекта, `ASSET_EXTENSIONS`, приватные сегменты запрещены), `res.sendFile` без правки; CSP `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' https: http:; style-src 'unsafe-inline' https: http:; img-src data: blob: https: http:; font-src …; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`.
- Комментарии: `RegionLayer({active, markers, draft, onRegion})` поверх iframe, доли от кадра iframe.
- Отправка: `sendToComposer(text, {autoSend, hiddenBrief, workMode})` (`src/utils/composerDraft.ts`, событие `COMPOSER_DRAFT_EVENT`, слушатель `useChatComposerState.ts:1479`), картинок не поддерживает; `sendTarget({artifactSessionId, currentSessionId}) → here|elsewhere|none`, `openSourceChat`. Вложения композера: `attachedImages`, `replaceAttachedImage` (793), `uploadAttachedImages` (963) → `POST /api/assets/images`.
- Пометки: `ImageMarkupEditor.tsx` (`{file, onSave(file), onCancel}`), `screenshotCaption.ts` (`ScreenshotMeta`, `withScreenshotContext`).
- Зависимостей для скриншота DOM (html2canvas и т.п.) нет; есть `dompurify`. Новых пакетов не ставить.
- Слайды: `artifactKindForPath` + `SLIDES_RE` → `'slides'`, разбиения на страницы нет.

## Моды
`shared/mods.ts` `MOD_KEYS` (22), `MODS {key, title, description, requires?, engines?}`; тесты `server/shared/tests/mods.test.ts` (EXPECTED_KEYS руками, «twenty-two»), `mods-engines.test.ts`; `ALLOWED_KEYS` включает `...MOD_KEYS`; клиент `useModEnabled`.
