# Границы и правила сборки

Читать первым. Карта кода — `notes.md`. Пути от корня `cloudcli-fork/`.

## Правила проекта (не нарушать)
- «Договорились» прошлых сборок: сохранить «Планирование + обход», модели и effort по умолчанию; использовать существующие модули и общую систему доступа; работать с исходниками, проверять изолированными сборками, не менять исполняемые файлы текущего Neo3.
- Не запускать `npm run build`, не трогать `dist/`, `dist-server/`, не рестартовать `com.dimasik.neo3-local`, не ставить зависимости (`npm install`) — новых npm-пакетов не добавлять.
- Тесты по одному — только с временными `HOME` и `DATABASE_PATH`.
- Доступ — только `server/shared/project-access.ts` и `requireSessionAccess`; админ — только `isAdminUser`.
- Новые служебные WS-кадры не добавлять в `CHAT_ROW_KINDS`; `GatewayEventKind` менять в обоих зеркалах.
- Новый файл в `server/shared/` — регистрировать в eslint `boundaries/elements`.
- Модели/провайдеры/effort/сессии: старые не удалять, новый выбор провайдеров не расширять.
- Секреты не выводить ни в UI, ни в логи, ни в отчёты; `.env`, `.secrets*` не читать в агентных инструментах.
- Ключевые папки (`~/.claude`, `~/.claude.json`, `~/.codex`, `~/.grok`, `~/.cloudcli`, вольт, LaunchAgents) — не удалять и не переносить. Правка `~/.claude/settings.json` — только ключ `statusLine`, с копией.
- Тексты интерфейса — по-русски, просто. Каждая новая функция — за своим модом.
- Коммит только своих файлов, пути явно; чужие изменения в `.autopilot/` и в штабе не трогать.

## Границы, решённые в спецификации

### Моды — `shared/mods.ts` (владелец: T05 добавляет ВСЕ 7 ключей сразу)
`modWorkbench`, `modSessionHub`, `modSideChat`, `modGroups`, `modThinkingTime`, `modKeepAwake`, `modDiagnostics` + записи `MODS` (title, description; строка поддержки движков — поле `engines?: string` в записи `MODS`, рендер в `BuiltInModsSection`). T03 заполняет `engines` для существующих модов. `server/shared/tests/mods.test.ts` обновляется.
Чтобы В1 не ждал T05: T02 и T03 используют уже существующие ключи или добавляют свой ключ сами — **T02 добавляет `modThinkingTime`**, **T03 добавляет поле `engines`**; T05 добавляет остальные шесть. Конфликт правок одного файла решается последовательностью коммитов (rebase на свежий HEAD перед коммитом).

### Тема (T01)
Ключ `claudeLight`, подпись `'Светлая Claude'`, в `LIGHT_THEMES`, `FLAT_THEMES`, условие фона `AppContent.tsx`. Экспорт для терминала: `terminalThemeFor(isDarkMode: boolean)` в `src/components/shell/constants/constants.ts`. Electron: IPC `neo3:theme-changed {isDark: boolean, background: string}` из preload → `win.setBackgroundColor`. Скрипт до первой отрисовки — inline в `index.html` читает `localStorage.appTheme`.

### Время размышления (T02)
- `run_durations.thinking_ms INTEGER NULL`.
- `RunDurationRow.thinking_ms`, `NormalizedMessage.thinkingDurationMs?: number` (оба зеркала типов), кадр `complete` несёт `completionDurationMs` и `thinkingDurationMs`.
- Клиент: `formatAnswerTiming({completionDurationMs, thinkingDurationMs})` → `"Думал 12 с · ответ за 1 мин 3 с"` в `src/components/chat/utils/completionDuration.ts`; показ при `modThinkingTime` (выкл — прежнее «Выполнено за …»).

### Фон (T03)
- `server/modules/providers/list/codex/codex-background-tasks.ts`: `createCodexBackgroundTaskTracker()` с контрактом `BackgroundTaskTracker` (`apply(event) → BackgroundTask[] | null`, `list()`, `has()`), `getCodexBackgroundTasks(sessionId)` экспортируется из `server/openai-codex.js`.
- Остановка: `server/shared/process-tree.ts` `findDescendantProcess(rootPid, match: (cmd: string) => boolean) → Promise<{pid, command} | null>` и `killProcessTree(pid)`; `stopCodexTask`, `stopGrokTask` с сигнатурой `(sessionId, taskId) => Promise<{ok: boolean, reason?: 'turn_ended'|'not_running'|'failed'|'unsupported'}>`; регистрация в `server/index.js` `stopTaskFns`/`backgroundTasksFns` только если механизм реально работает.

### Рабочий стол (T05) — владелец холста
- `src/components/workbench/`: `WorkbenchLayout.tsx` (сплит чат | холст, ресайз по образцу `useEditorSidebar`), `WorkbenchCanvas.tsx` (полоса вкладок + тело), `workbenchStore.ts`, `workbenchTabs.ts` — **реестр видов вкладок**, расширяемый другими тасками:
  ```ts
  type WorkbenchTabKind = 'inspector' | 'limits' | 'artifacts' | 'artifact' | 'btw' | 'chat' | 'advisor' | 'report';
  interface WorkbenchTab { id: string; kind: WorkbenchTabKind; title: string; ref?: string /* artifactId | sessionId | reportId */ }
  registerWorkbenchTabKind(kind, { render: (tab, ctx) => ReactNode, icon, defaultTitle })
  openWorkbenchTab(sessionId: string, tab: Omit<WorkbenchTab,'id'> & {id?: string}): void   // откроет и включит стол
  closeWorkbenchTab(sessionId: string, tabId: string): void
  useWorkbench(sessionId) → { enabled, tabs, activeTabId, ratio, setEnabled, setActive, setRatio }
  ```
  Состояние: `workbenchLayout` в ui-preferences (`{enabled, ratio}`), вкладки — по `sessionId` в localStorage `neo3.workbench.tabs.<sessionId>`.
- Переключатель в `MainContentHeader.tsx`; на ≤768 px — кнопка «Холст» и полноэкранный холст.
- Вкладки `inspector` и `limits` реализует T05/T06; `artifacts`/`artifact`/`report` — T08; `btw`/`chat` — T09/T10; `advisor` — T13.

### Контекст и лимиты (T06)
`src/components/workbench/limits/ContextLimitsCard.tsx` из существующих `TokenUsageSummary`/`codexUsageLimits`/`/api/usage/limits`; общий нормализатор `src/utils/providerLimits.ts` `normalizeProviderLimits(provider, raw) → { context: {usedPct|null, used|null, window|null}, windows: [{label, utilization|null, resetsAt|null}], known: boolean }`. Grok → `known:false`. Перенос — существующий `POST /api/sessions/:id/auto-relay/start`.

### Панель диалогов и мастер-сессия (T07, T12)
- T07: `src/components/session-hub/` `SessionHubBar.tsx` (над композером в `ChatInterface.tsx`, рядом с `ThreadsBar`), `SessionHubPanel.tsx` (правая выдвижная), данные — только `useAttention()`; без нового серверного API.
- T12: сервер `server/modules/master-session/` — `GET /api/master-session/questions` (ждущие по `projectAccessFor`), `POST /api/master-session/drafts {sessionIds[]}` → `{drafts:[{sessionId, text, choice?}]}` (модель, readOnly), `POST /api/master-session/send {batchId, items:[{sessionId, expectedUpdatedAt, answer:{choice?|text}}]}` → `{results:[{sessionId, status:'sent'|'stale'|'failed', reason?}]}`; доставка — `pendingAnswers.answer()` для структурных вопросов, иначе обычная отправка сообщения в чат через `beginChatSend`; идемпотентность по `batchId+sessionId`. Клиент — секция «Мастер-сессия» в `SessionHubPanel` и в `hubSections.ts`.

### Артефакты (T08)
- Сервер `server/modules/artifacts/`: kind записей `artifact {path, title, kind:'html'|'markdown'|'pdf'|'image'|'slides'|'other', sessionId, messageId?, latestVersion}`, `artifact-version {artifactId, n, sha256, size, snapshotFile, createdAt, source:'publish'|'change'|'restore'}`, `artifact-comment {artifactId, versionN, anchor:{type:'rect', x,y,w,h /* доли 0..1 */}|{type:'quote', text}, text, status:'open'|'sent'|'resolved'}`.
- REST `/api/projects/:projectId/artifacts`: `GET` список, `POST {path, title?, sessionId?, messageId?}` публикация, `GET /:id` (+ версии), `POST /:id/refresh` (снимок, если файл изменился), `GET /:id/versions/:n/content`, `POST /:id/versions/:n/restore`, `POST /:id/comments`, `PATCH /:id/comments/:cid`, `POST /:id/send-comments {sessionId}` → сообщение в чат. Пути — строго внутри проекта (как relay-file: `..` и симлинк наружу — отказ).
- Агент: `workspace_action` действия `artifact.publish {path, title?}`, `artifact.list`.
- Клиент `src/components/workbench/artifacts/`; кнопка «Открыть в холсте» у ссылок на файлы в `Markdown.tsx` через `openWorkbenchTab`.

### Побочный чат, второй чат, дерево (T09, T10)
- `shared/session-links.ts` `SESSION_RELATIONS` += `'btw'` (T09).
- T09: `POST /api/sessions/:id/btw {question, quote?, provider?, model?}` → `{sessionId}`: создаёт ребёнка (тот же движок/модель/effort, что родитель), первое сообщение = вопрос + скрытый блок `<btw_context>` (цитата + последний ответ родителя, ≤4000 символов), блок срезается `stripAgentOnlyBlocks`. Не трогает прогон родителя.
- T10: дерево — `src/components/sidebar/` по `links.children` (все `relation`); второй чат — вкладка `chat` (`ref=sessionId`): компонент `WorkbenchChatPane.tsx` с собственной лентой и полем ввода, отправка `chat.send` с явным `sessionId` этой вкладки.

### Группы и закрепы (T11)
- Таблицы `sidebar_groups(id TEXT PK, user_id, name, position, collapsed, created_at)`, `sidebar_group_items(group_id, item_type 'project'|'session', item_id, position, PK(group_id,item_type,item_id))`, `session_pins(user_id, session_id, pinned_at, PK(user_id,session_id))`.
- Модуль `server/modules/sidebar-groups/` REST `/api/sidebar-groups` (GET всё дерево; POST/PATCH/DELETE группы; PUT items; PUT/DELETE `/pins/:sessionId`), WS-кадр `sidebar_groups_changed` (без содержимого, только сокетам пользователя).
- Агент: `workspace_action` `group.list`, `group.create {name}`, `group.rename {id, name}`, `group.add {id, itemType, itemId}`, `group.remove {id, itemType, itemId}`, `pin.set {sessionId, pinned}`. Удаления групп агентом нет.

### Диагностика и профиль (T13)
- `server/modules/diagnostics/`: `runDoctor() → DoctorReport {checks:[{id, title, status:'ok'|'warn'|'fail'|'unknown', detail}]}`, `runSkillDoctor() → SkillReport {skills:[…], issues:[{kind:'duplicate'|'no_description'|'broken_link'|'conflict', skill, detail}]}` — admin; `POST /api/diagnostics/advisor {sessionId, question}` → `{answer}`.
- Профиль: `server/modules/settings-profile/` — `POST /api/settings-profile/preview {changes}` → дифф по `ALLOWED_KEYS`; `POST /apply` (снимок → применить → `notifyUiPreferencesChanged`); `POST /restore {snapshotId}`. Агент: `workspace_action` `settings.propose {changes, reason}` → запись-предложение, применяет только человек.
- Keep-awake: `server/modules/keep-awake/` подписка на `sessionAttention.onChange`; счёт `working`; `caffeinate -i` дочерним процессом; освобождение 2 мин после последнего working, предел 3 ч без новой активности; не macOS — ничего.
- Слэш-команды `/btw` (T09), `/doctor`, `/skill-doctor`, `/advisor` (T13) — в `server/routes/commands.js` и `handleBuiltInCommand`.

### Терминальный пакет (T04) — вне форка
`~/.claude/statusline/neo3-statusline.mjs` (читает stdin JSON Claude Code, кэш лимитов `~/.cloudcli/statusline-cache.json` ≤60 с), навыки `~/.claude/skills/{skill-doctor,setup-doctor,advisor,jev}/SKILL.md`, копии для Codex в `~/.codex/skills/{skill-doctor,jev}` если каталог навыков Codex существует. Имена не перекрывают встроенные команды Claude Code.

## Швы для тестов
`createIsModOn`; фабрики сервисов с зависимостями (`createArtifactsService({store, fs, now})`, `createMasterSessionService({attention, pendingAnswers, send, drafts})`, `createKeepAwake({spawn, platform, now})`, `createDiagnostics({exec, fs})`); `fetchImpl` у моделей; фикстуры JSONL для трекера Codex (`providers/tests/fixtures/codex-background-*.jsonl`).

## Что построили сданные таски
(дописывается после каждого таска)

## Как работать в репозитории
- Стек: Node 24, React 18 + TS + Tailwind (Vite), Express + better-sqlite3 (TS через tsx/tsc), Electron. Зависимости стоят; новых не ставить.
- **Где строим:** отдельный worktree `/Users/dimasik/Antigravity Project/claude agent/neo3-workbench-build` (ветка `feat/neo3-workbench-build`, node_modules — ссылка на форк). Все правки и команды — только там; основную папку `cloudcli-fork/` не трогать (в ней работают другие сессии). Файлы прогона (`.autopilot/…`) читать из `cloudcli-fork/.autopilot/2026-11-04-neo3-workbench-video--wip/`.
- **Исходное состояние (e492e939):** typecheck зелёный, тестов 1662/0; `npm run lint` уже красный (96 ошибок до сборки) — поэтому lint только своих файлов: `node_modules/.bin/eslint <свои изменённые файлы>` без новых ошибок.
- **Одна проверка:** `npm run typecheck && TMPDIR="$(node -p 'require("node:fs").realpathSync(require("node:os").tmpdir())')" npm test`. Клиентская сборка в изоляции: `node_modules/.bin/vite build --outDir "$(mktemp -d /tmp/neo3-client-check.XXXXXX)"`.
- **Один тест:** `HOME=$(mktemp -d) DATABASE_PATH=$(mktemp -d)/auth.db node_modules/.bin/tsx --tsconfig server/tsconfig.json --test <path>`.
- Таски одной волны работают в одном рабочем дереве параллельно. **Общие файлы** — `server/index.js` (монтирование роутов, `chatDependencies`), `server/shared/types.ts` и `src/types/app.ts` (зеркала типов), `eslint.config.js` (boundaries), `src/i18n/locales/*` — правятся только точечным добавлением своих строк в своём месте, без переформатирования; перед коммитом `git diff` этих файлов — только свои строки; коммит — только своих путей (`git commit -- <пути>`), никогда `git add -A`.
- Владельцы файлов (не трогать чужие): `shared/mods.ts` — 01; `MessageComponent.tsx`, `chat-run-registry.service.ts`, `openai-codex.js`, `grok-cli.js` — 04; `ChatInterface.tsx` — 05 (точка монтирования полосы), 07 ставит свой компонент через проп/слот, который 05 не трогает — если нужен — 07 добавляет одну строку монтирования; `ChatMessagesPane.tsx` — 07; `server/threads-mcp.ts` и `agent-workspace/tools.ts` — 06 (волна 2), 08 (волна 3); `schema.ts`/`migrations.ts` — 04 (волна 2), 08 (волна 3); `server/routes/commands.js` и `useChatComposerState.ts` — 07 (волна 2), 09 (волна 3); `src/components/sidebar/` — 07 (волна 2), 08 (волна 3); `Markdown.tsx` — 06.
- **03 (терминальный пакет):** `~/.claude/statusline/neo3-statusline.mjs` — `render(input, deps?) → Promise<string>`, `resolveLimits(input, deps?)`, deps `{now, readCache, writeCache, fetchUsage}`; строка `Opus · контекст 8% · 5ч 24% ↻2ч00 · нед 41% ↻3д`, сбой — `лимиты: ?`; кэш `~/.cloudcli/statusline-cache.json` 60 с. Не подключён (в settings.json уже ccusage). Навыки: `skill-audit` (встроенный `/skill-doctor` уже есть в Claude Code), `setup-doctor`, `second-opinion` (встроенный `/advisor` есть), `jev`; Codex видит их ссылками в `~/.codex/skills`; Grok — через compat `~/.claude/skills`. Док `docs/claude-code-terminal-pack.md`. **В Neo3 имена слэш-команд T09 сверить с этим: `/doctor`, `/skill-doctor`, `/advisor` в Neo3 — свои команды Neo3, конфликта с Claude Code нет, т.к. Neo3 перехватывает их до движка.**
- **01 (рабочий стол, 3463b9c5):** из `src/components/workbench`: `registerWorkbenchTabKind(kind, {render(tab, ctx), icon, defaultTitle, inMenu?})`, `getWorkbenchTabKind`, `listWorkbenchTabKinds`, `WorkbenchRenderContext {sessionId, project, session, openTab, closeTab}`, `openWorkbenchTab(sessionId|null, tab)`, `closeWorkbenchTab(sessionId|null, tabId)`, `useWorkbench(sessionId) → {enabled, tabs, activeTabId, ratio, openSeq, setEnabled, setActive, setRatio}`; id вкладки = `id ?? kind[:ref]`, повторное открытие фокусирует. Встроенные виды — `builtinTabs.tsx` (inspector, limits); свои виды регистрировать в своём файле и импортировать его из `src/components/workbench/index.ts` одной строкой. `createWorkbenchStore({storage, saveLayout?})`; localStorage `neo3.workbench.layout`, `neo3.workbench.tabs.<sid|draft>`; ui-preferences `workbenchLayout` = JSON `{enabled, ratio}` (ratio — доля холста 0.25..0.75, ключ добавлен в `ALLOWED_KEYS`). `normalizeProviderLimits(provider, {tokenUsage, contextWindow, limits}) → {context:{usedPct, used, window}, windows:[{label, utilization, resetsAt}], known}` (`src/utils/providerLimits.ts`). `ModDef.engines?: string`. Все 7 новых модов уже в `shared/mods.ts` (T02/T04 ключ не добавляют). Заготовки, уже смонтированные в `server/index.js` (не трогать index.js — только наполнять модуль): `masterSessionRoutes` (`/api/master-session`), `artifactsRoutes` (`/api/projects/:projectId/artifacts`, mergeParams), `sidebarGroupsRoutes` (`/api/sidebar-groups`), `settingsProfileRoutes` (`/api/settings-profile`), `diagnosticsRoutes` (`/api/diagnostics`), `startKeepAwake({sessionAttention}) → {stop}`.
- **Из ревью 01 — правила для следующих тасков:** (1) `WorkbenchCanvas` рендерит только активную вкладку — вид вкладки с полем ввода/лентой (07 `btw`/`chat`, 09 `advisor`) хранит черновик и прокрутку вне компонента (свой стор по id вкладки), чтобы переключение вкладок ничего не теряло. (2) Перед `openWorkbenchTab` вызывающий проверяет `useModEnabled('modWorkbench')`; выключен — не открывать (и не предлагать кнопку). (3) keep-awake (09): `caffeinate -i -w <process.pid>` — процесс сам умрёт вместе с сервером; `startKeepAwake` уже вызван в index.js.
- **06 (артефакты, f7bc4147):** `createArtifactsService({store, projectPath, canAccessProject, sessionProjectId?, isModOn?, fs?, snapshotRoot?, now?, limits?})` → list/publish/detail/refresh/versionContent/restore/addComment/updateComment/sendComments; `getArtifactsService()`; REST как в разделе «Артефакты», ответ `{success, data}`, ошибки MOD_OFF 409, ARTIFACT_PATH_* 400, ARTIFACT_*_NOT_FOUND 404; `workspace_action` `artifact.publish {data:{path,title?}}`, `artifact.list`; `createWorkspaceTools(deps, {artifacts?})`; `shared/artifacts.ts` (`artifactKindForPath`, `isCanvasFile`, `isJevReportPath`, `buildArtifactCommentsMessage`); вкладки `artifacts`, `artifact` (ref = id | `path:<путь>`); `OpenInCanvasButton({filePath})`; отправка комментариев — клиентом через `sendToComposer(text,{autoSend:true})`. `workbench-mounts.test.ts` проверяет только монтирование — наполнять модули можно.
- **07 (побочный чат, 8de0b8e6):** `POST /api/sessions/:id/btw {question, quote?, provider?, model?}` → 201 `{data:{sessionId, parentSessionId, relation:'btw', provider, model, effort, permissionMode, title}}`, ошибки 400 BTW_QUESTION_REQUIRED, 409 MOD_OFF/BTW_NOT_STARTED, 503 BTW_UNAVAILABLE (пока нет строки `btwService.setRunControl(createAutoRelayRunControl(chatDependencies))` в index.js — добавится после 04). Из `@/modules/session-links/index.js`: `btwService`, `createBtwService`, `createBtwRoutes`, `buildBtwFirstMessage`, `BTW_CONTEXT_MAX=4000`. В `server/routes/commands.js`: **`builtInCommandsFor(userId, isModOn?)` и `executeBuiltInCommand(name, args, ctx, userId, isModOn?)`** — новые команды добавлять через них (09). Клиент: `askAside(parentId, {question, quote?})`, `openSideChatTab(parentId, {sessionId, title})`, `chatSendFrame(tab, text, engine)`, `sideChatStore`, `buildSessionTree(sessions, folded)`; localStorage `neo3.sidebar.foldedChats`.
- **05 (панель диалогов, 8e97ee55):** `createMasterSessionService({attention, pendingAnswers, send, drafts, sessionProjectPath, isModOn?, now?})` → listQuestions/prepareDrafts/send; `setMasterSessionRunControl(ThreadRunControl)` (пока runtime подменяет `threadsService.setRunControl` — заменить явной строкой в index.js после 04); REST `/api/master-session/{questions,drafts,send}`; клиент `SessionHubBar({onOpenSession})`, `SessionHubPanel({onClose,onOpenSession,getProviderLabel?})`, `MasterSessionSection`, секция хаба `master-session`.
- **09 (диагностика, f9c372c7):** `createDoctor(...)`, `createSkillDoctor(...)`, `createAdvisor(...)`; REST `/api/diagnostics/{doctor,skill-doctor}` (админ), `POST /api/diagnostics/advisor {sessionId, question}`; `createKeepAwake({spawn, platform, now, pid?, isModOn?})`; `builtInCommandsFor(userId, isModOn?, isAdmin?)`, `executeBuiltInCommand(name, args, ctx, userId, isModOn?, isAdmin?)` (действия doctor, skill-doctor, advisor); клиент `askAdvisor`, `advisorStore`, вкладка `advisor`.
- **04 (паритет движков):** кадр `complete` несёт `thinkingDurationMs?`; `RunDurationRow.thinking_ms`; `formatAnswerTiming`, `applyLiveAnswerTimings`, `sessionStore.recordAnswerTiming`; `createCodexBackgroundTaskTracker({now})`, `getCodexBackgroundTasks`, `stopCodexTask`/`stopGrokTask (sid, taskId)→{ok, reason?}` зарегистрированы в `stopTaskFns`; `server/shared/process-tree.ts` (`findDescendantProcess(s)`, `killProcessTree`, `stopEngineTask`, `markStoppableTasks`); у задачи `stoppable?: boolean`, клиент `canStopTask`. Таблица модов — `$R/t04-mods-audit.md`.
- **08 (группы и профиль, 918cebb7):** REST `/api/sidebar-groups` (GET, POST, PUT /order, PATCH/DELETE /:id, PUT /:id/items, PUT|DELETE /pins/:sessionId), `/api/settings-profile` (GET, POST preview/apply/restore, proposals/:id/dismiss); `workspace_action` `group.*`, `pin.set`, `settings.propose`; кадр `sidebar_groups_changed` (`notifySidebarGroupsChanged(userId)`); таблицы `sidebar_groups`, `sidebar_group_items`, `session_pins`; `isUiPreferenceKey`, `uiPreferencesDb.removeUiPreferenceKeys`.
- **Ремонт 05/07 (7e642bbf):** в index.js `btwService.setRunControl(createAutoRelayRunControl(chatDependencies))`, `setMasterSessionRunControl(createThreadRunControl(chatDependencies))`.
