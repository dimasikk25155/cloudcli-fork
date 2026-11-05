# Границы и правила проекта

Читать первым. Пути — от корня worktree `claude agent/neo3-grokbot` (ветка `feat/neo3-grokbot`). Карта кода — `notes.md` рядом.

## Правила проекта (не пересматривать)

- Второй чат справа = тот же `ChatInterface` с `embedded`, а не своя упрощённая лента (Дима 05.11: «второй чат должен выглядеть аналогично первому, иначе смысла нет»).
- Глобальное (звуки, `[Done]`, сторож соединения, быстрые настройки, бар всех проектов, материалы «Отправить агенту», выбор движка) делает только основной чат.
- Рабочий стол переключаемый, обычный чат остаётся; мод выкл — прежний переключатель вкладок.
- Мастер-сессия по всем проектам Димы, отправка после показа адресатов; права тиммейтов не расширять.
- Браузер агентов — только Safari; Chrome/Playwright не использовать.
- Тему `claudeLight` Диме НЕ включать. Облачные проекты на VPS и кнопки ответа у Codex — не делать. Motion — «уже есть».
- Прод и рестарт — только с согласия Димы; строить в отдельном worktree, `cloudcli-fork/` не трогать.
- Менять MCP-серверы и навыки может только админ; тиммейту значения env/headers/args не отдаются.
- Правка артефактов идёт над исходником файла, не над живой страницей (ADR 0024); конфликт с агентом — по содержимому файла (ADR 0026).

- Из `CLAUDE.md` (`claude agent/CLAUDE.md`): админ — только `isAdminUser(user)`; доступ к проекту/сессии — только `server/shared/project-access.ts` и `requireSessionAccess`; новый файл в `server/shared/` — строка в `eslint.config.js` (boundaries/elements); новые WS-кадры в `CHAT_ROW_KINDS` не добавлять; тест по одному — только с временными `HOME` и `DATABASE_PATH`; `npm run build`, рестарт, правка `~/.claude*`/LaunchAgents/прод — НЕ делать.
- Платные API, Kie.ai, on-demand — запрещены. Исполнители — CLI-движки по подпискам и локальные модели.

## Границы, решённые в спецификации

### 1. Общее (`shared/`)
- `shared/mods.ts`: ключи `modAgents`, `modAgentQueue` (requires `modAgents`), `modSecretRequest` + карточки в `MODS` (рус. тексты). Тест `server/modules/database/tests/ui-preferences-mods.test.ts` обновить.
- `shared/agent-brief.ts` (новый, без БД):
  - `type AgentBriefInput = { name: string; role: string; checks: string; files: string[]; rules: { text: string }[]; rulesVersion: number }`
  - `buildAgentBrief(input): string` → `<agent_brief>…</agent_brief>` (имя, роль, «Проверка результата: …» + «в конце ответа строка ВЕРДИКТ: OK|FAIL — причина» если `checks` не пусто, «прочитай перед работой: <пути>», «Правила (Vn): 1… 2…», подсказка «новое правило — workspace_action agent.remember»).
  - `withAgentBrief(brief: string, text: string): string` — блок + `\n\n` + текст.
- `shared/agent-only-blocks.ts`: добавить `agent_brief` в `AGENT_ONLY_BLOCK` (пузыри, заголовки сессий).
- `shared/queue-verdict.ts` (новый): `parseVerdict(text): { verdict: 'ok'|'fail'; reason: string }` — последняя строка вида `ВЕРДИКТ: OK` / `ВЕРДИКТ: FAIL — причина` (регистр, `-`/`—`/`:` после FAIL, латиница `VERDICT` тоже); нет строки → `{fail, 'нет вердикта'}`. `VERDICT_INSTRUCTION: string` — текст требования, который добавляется к заданию.

### 2. Агенты — `server/modules/agents/` (владелец: T01)
- БД (`schema.ts`/`migrations.ts`, `repositories/agents.db.ts`, экспорт `agentsDb` из `database/index.ts`):
  - `agents(id TEXT PK, user_id INT FK users CASCADE, name TEXT, role TEXT, checks TEXT DEFAULT '', provider TEXT, model TEXT, effort TEXT NULL, project_path TEXT, files TEXT JSON '[]', created_at, updated_at)`, UNIQUE(user_id, name COLLATE NOCASE).
  - `agent_rules(id INTEGER PK, agent_id TEXT FK agents CASCADE, text TEXT, created_at, removed_at NULL, version_added INT, version_removed INT NULL)`; текущая версия агента = max(version_added, version_removed); «версия Vn» = набор правил, живых на n.
  - `agent_sessions(session_id TEXT PK, agent_id TEXT, user_id INT, created_at)` — без FK на sessions.
- Сервис `createAgentsService(deps)` (синглтон `agentsService`):
  - `list(userId)`, `get(userId, id)`, `create(userId, input)`, `update(userId, id, patch)`, `remove(userId, id)` — валидация: имя 1–40, роль 1–8000, checks 0–2000, provider ∈ claude|codex|grok, модель через каталог (`isAllowedModel`-логика тредов), `project_path` — зарегистрированный проект с доступом, `files` — существующие файлы строго внутри `project_path` (без `..`, симлинк наружу — отказ), ≤20.
  - `rules(userId, id)` → `{ version, rules: [{id,text,versionAdded}] , history: [{version, added?:text, removed?:text}] }`; `addRule(userId, id, text, by:'user'|'agent')`, `removeRule(userId, id, ruleId)`. Правило 1–500 знаков, ≤50 живых.
  - `findByName(userId, name)` (без регистра).
  - `briefFor(userId, agentId): string` — собирает `buildAgentBrief` из агента и текущих правил.
  - `startChat(userId, agentId, task): Promise<{sessionId}>` — `createAppSession(provider, project_path)` → `agent_sessions` → имя чата «<агент>: <начало задачи>» → run control `start({sessionId,userId,content: withAgentBrief(brief, task), options:{model,effort,projectPath}})`.
  - `agentOfSession(sessionId): {id,name} | null`.
- Run control: в `chat-websocket.service.ts` новый `ChatSendAccess` `{kind:'agent', userId}` (доступ: админ + доступ к проекту сессии) и экспорт `createAgentRunControl(dependencies)` по образцу `createThreadRunControl`; подключение в `server/index.js` (`agentsService.setRunControl(...)`).
- Роуты `/api/agents` (authenticateToken + requireAdmin + `MOD_OFF`): `GET /`, `POST /`, `PUT /:id`, `DELETE /:id`, `GET /:id/rules`, `POST /:id/rules {text}`, `DELETE /:id/rules/:ruleId`, `POST /:id/chat {task}` → `{sessionId}`, `GET /by-session/:sessionId` → `{agent|null}` (`requireSessionAccess`).
- Сайдбар: сессиям с агентом — поле `agentName` (там же, где `links`), клиент показывает метку.

### 3. Штаб — инструменты агента (владелец: T02)
- `server/threads-mcp.ts`: `spawn_thread` получает `agent?: string`; описание инструмента обновить. `workspace_action` — действия `agent.list` и `agent.remember {text}`.
- `threads.service.ts` `openThread`: если `agent` — `agentsService.findByName(userId, agent)` (нет → AppError 404 `AGENT_NOT_FOUND` с перечнем имён); provider/model/effort из агента, если не заданы явно; `content = withAgentBrief(briefFor(...), prompt)`; `agent_sessions` для треда; заголовок треда «<агент>: …». Мод `modAgents` выкл → `agent` в вызове = `MOD_OFF`.
- `agent.remember` (в `agent-workspace/tools.ts`): агент сессии по `agentOfSession(sessionId из токена)`; нет агента → «этот чат не привязан к агенту»; `addRule(..., by:'agent')` → «Правило добавлено, версия Vn».
- `agent.list` → `[{name, role: первая строка ≤120, provider, model}]`, только агенты пользователя токена; не-админ → пусто + пояснение.

### 4. Конвейер — `server/modules/agent-queue/` (владелец: T04)
- БД: `agent_queues(id TEXT PK, user_id INT FK CASCADE, agent_id TEXT, title TEXT, template TEXT, parallel INT 1..3, max_attempts INT 1..4, status 'running'|'paused'|'stopped'|'done', created_at, updated_at, finished_at NULL, notified_at NULL)`; `agent_queue_items(id INTEGER PK, queue_id TEXT FK CASCADE, position INT, input TEXT, status 'pending'|'running'|'ok'|'rejected', attempts INT, pass INT DEFAULT 1, verdict TEXT NULL, reason TEXT NULL, excerpt TEXT NULL, session_id TEXT NULL, manual INT DEFAULT 0, updated_at)`.
- Сервис `createAgentQueueService(deps)`: `create(userId,{agentId,title,template,items[],parallel,maxAttempts})` (≤500 пунктов, пункт 1–2000 знаков, шаблон обязан содержать `{{item}}`, иначе пункт дописывается в конец); `list`, `get` (с пунктами), `pause`, `resume`, `stop`, `retryRejected(queueId)` (брак → pending, attempts=0, pass+1), `markOk(itemId)` (manual=1), `remove`. `tick()` — берёт пункты в работу (≤ parallel на очередь, ≤3 очереди в работе всего), для Claude — `checkUsageGuard`; исполнитель `runHeadlessPrompt({actor:'queue', provider, model, effort, projectPath, prompt})`, где prompt = `withAgentBrief(brief, template.replace('{{item}}', input) + (попытка>1 ? причина прошлого FAIL : '') + VERDICT_INSTRUCTION)`; результат → `parseVerdict`; `recoverOnBoot()` — running → pending. Все внешние зависимости — через deps (`run`, `checkUsageGuard`, `notify`, `now`, `isModOn`).
- `KNOWN_ACTORS` += `queue`.
- Runtime `startAgentQueueWatch()` (тик 5 с, `.unref()`, `NEO3_AGENT_QUEUE_WATCH=off`), запуск в `server.listen`, остановка в shutdown.
- Итог: статус `done` → `notify({code:'queue.done', title, body:"N OK, M брак"})` один раз (`notified_at`). Мод `modAgentQueue` выкл → тик не берёт новые пункты, очереди `running` → `paused`, уведомлений нет.
- Роуты `/api/agent-queue` (admin + MOD_OFF): `GET /`, `POST /`, `GET /:id`, `POST /:id/pause|resume|stop|retry-rejected`, `POST /items/:itemId/mark-ok`, `DELETE /:id`.

### 5. Рутины — `server/modules/schedules/` (владелец: T06)
- Колонки `schedules`: `agent_id TEXT NULL`, `notify INTEGER DEFAULT 0`, `last_result TEXT NULL` (≤600 знаков выжимки или текст ошибки), `notified_at TEXT NULL`.
- `runScheduleNow`: при `agent_id` — provider/model/effort/projectPath агента и `withAgentBrief(...)`; агент удалён → статус «агент удалён», без прогона; записывает `last_result`.
- Сторож в сервере (в runtime T06, тик 60 с): `notify=1` и `last_run_at > notified_at|null` → `notify({code:'schedule.result', …})`, `notified_at = now`.
- Роуты/клиент `SchedulesPanel.tsx`: поля «Агент» (если `modAgents` вкл) и «Прислать итог»; вывод `last_result`.

### 6. Запрос ключа — `server/modules/secret-requests/` (владелец: T07)
- `workspace_action secret.request {name, why}` → запись в памяти сервера (не в БД) `{id, userId, sessionId, name, why, createdAt}`; инструмент **ждёт ответа** до 600 с (как `thread_status wait`), затем «Дима пока не ответил — спроси позже» и запрос остаётся.
- `GET /api/secret-requests` (admin + MOD_OFF) → список без значений; `POST /api/secret-requests/:id {value, replace?}` → `secrets-stash` → ответ агенту «NAME сохранён в файле секретов»; `POST /:id/decline` → «Дима отказал». WS-кадр без содержимого `secret_requests_changed`.
- Клиент: секция в хабе «Ждут тебя» (`hubSections.ts`), поле `type=password`, `autocomplete=off`; значение чистится из состояния после отправки; пуш «Агент просит ключ NAME» без значения.

### 7. Клиент (владельцы: T03 агенты, T05 конвейер)
- `src/components/agents/` — `AgentsPanel.tsx`, `agentsModel.ts` (+ тест), `useAgents.ts`; пункт меню `AGENTS_PANEL` (`?panel=agents`) в `SidebarFooter.tsx` — админ + `modAgents`. Метка агента у чата в сайдбаре.
- `src/components/agent-queue/` — `AgentQueuePanel.tsx`, `agentQueueModel.ts` (+ тест), `useAgentQueue.ts`; пункт `QUEUE_PANEL` (`?panel=queue`) — админ + `modAgentQueue`; обновление опросом 5 с, пока панель открыта.
- Разрешённые движки/модели — `src/utils/providerSelectionPolicy.ts`, без своих списков.

## Тестовые швы
- Фабрики сервисов с deps: `createAgentsService`, `createAgentQueueService`, `createSecretRequestsService` — тесты на фейках + временной БД (`notes.md` §9).
- Чистые функции: `buildAgentBrief`, `parseVerdict`, `stripAgentOnlyBlocks` с `agent_brief`, клиентские `*Model.ts`.
- Роуты — `express()` + `generateToken` (образец `safari-live/tests/safari-live.routes.test.ts`).

## Стек и команды (из корня worktree; `node_modules` — симлинк на `../cloudcli-fork/node_modules`, ничего не ставить)
- Node 24, TypeScript, Express, better-sqlite3, React 18 + Vite. Новых зависимостей сборка не добавляет.
- Проверка целиком: `npm run typecheck && TMPDIR="$(node -p 'require("node:fs").realpathSync(require("node:os").tmpdir())')" npm test` (+ `npx eslint <изменённые файлы>`).
- Один тест: `T=$(mktemp -d) && HOME=$T DATABASE_PATH=$T/auth.db node_modules/.bin/tsx --tsconfig server/tsconfig.json --test --test-timeout=30000 <путь.test.ts>`.
- Клиент в изоляции: `node_modules/.bin/vite build --outDir "$(mktemp -d /tmp/neo3-client-check.XXXXXX)"`.
- Не трогать: `cloudcli-fork/` и другие worktree, `dist/`, `dist-server/`, `~/.claude*`, `~/.codex`, `~/.cloudcli` (кроме временных HOME в тестах), LaunchAgents, боевой сервер.

## Что построили готовые таски

### T01 (агенты, фундамент) — коммит 8b9785ff
- `agentsService` / `createAgentsService({listModels?, createSession?, broadcastUpsert?, newId?})` из `@/modules/agents/index.js`: `list(userId)`, `get(userId,id)`, `create`, `update`, `remove`, `findByName(userId,name): AgentView|null`, `rules(userId,id): AgentRulesView`, `addRule(userId,id,text,by:'user'|'agent')`, `removeRule(userId,id,ruleId)`, `briefFor(userId,agentId): string`, `startChat(userId,agentId,task): Promise<{sessionId}>`, `agentOfSession(sessionId): {id,name}|null`, `setRunControl`. Ошибки — AppError: ADMIN_ONLY 403, AGENT_NOT_FOUND 404, AGENT_NAME_TAKEN 409, RULE_LIMIT 409. Все методы, кроме `agentOfSession`, для не-админа → ADMIN_ONLY.
- `AgentView` = поля агента без userId + `rulesVersion`; `AgentRulesView = {version, rules:[{id,text,versionAdded,addedBy}], history:[{version, added?, removed?, by?}]}` (новые сверху).
- `agentsDb` (`@/modules/database/index.js`): create, get, listByUser, findByName, update, delete, listRules, rulesVersion, liveRuleCount, addRule, removeRule, linkSession, unlinkSession, `agentOfSession(id): {id,name,userId}|null`, `agentNamesForSessions(ids): Map`.
- `createAgentRunControl(deps)` из `@/modules/websocket/index.js` → `{start({sessionId,userId,content,options}): boolean}`; доступ `{kind:'agent',userId}`.
- `shared/agent-brief.ts`: `AgentBriefInput`, `buildAgentBrief`, `withAgentBrief`; `shared/queue-verdict.ts`: `QueueVerdict`, `parseVerdict`, `VERDICT_INSTRUCTION`; `KNOWN_ACTORS` (с `queue`) из `@/modules/agent-run/index.js`.
- Таблицы `agent_queues`, `agent_queue_items` созданы по §4 (репозиториев нет — их пишет T03); `schedules` += `agent_id, notify, last_result, notified_at`. Сайдбар: `agentName?` только у чатов агента.
- Оговорки: уникальность имени без регистра для кириллицы держит сервис (не индекс); списки моделей скопированы из threads, чтобы не было цикла threads↔agents; первый прогон чата агента идёт в режиме разрешений движка по умолчанию; фильтр ленты аудита (`governance.routes.ts`) про актор `queue` не знает — дописывает T03.

### T02 (панель «Агенты», штаб)
- `spawn_thread{agent?}`: явные provider/model приоритетнее агента; effort агента — если движок и модель не менялись; заголовок «<агент>: …»; тред в `agent_sessions`; ошибки `AGENT_NOT_FOUND` 404 (со списком имён), `MOD_OFF` 409, `ADMIN_ONLY`.
- `ThreadsDependencies.agents?`; `WorkspaceToolsOptions` += `agents?`, `isModOn?` (по умолчанию — боевые синглтоны).
- `workspace_action agent.list` → `{agents:[{name, role, provider, model}], note?}`; `agent.remember {data:{text}}` → `{message, agent, version}`. Действия добавляются в `server/modules/agent-workspace/tools.ts` (switch по action) и описываются в `server/threads-mcp.ts`.
- Клиент: `src/components/agents/AgentsPanel.tsx({onOpenChat?})`; меню — `AGENTS_PANEL` в `src/components/sidebar/view/subcomponents/SidebarFooter.tsx` (образец для `QUEUE_PANEL`: тип ключа панели, whitelist `?panel=`, переход из пуша, рендер); метка агента — `src/components/sidebar/utils/agentLabel.ts`.

### T03 (конвейер — сервер, рутины) — коммит b22148fc
- `/api/agent-queue` (authenticateToken + requireAdmin; `modAgentQueue` или `modAgents` выкл → 409 MOD_OFF): `GET /` → `{queues: QueueSummary[]}`; `POST /` `{agentId, title?, template?, items: string[] | строка с переводами строк, parallel? 1..3 = 1, maxAttempts? 1..4 = 2}` → `{queue}`; `GET /:id` → `{queue: QueueView}`; `POST /:id/pause|resume|stop|retry-rejected` → `{queue}`; `POST /items/:itemId/mark-ok` → `{queue}`; `DELETE /:id` → `{removed:true}`.
- `QueueSummary = {id, agentId, agentName|null, title, template, parallel, maxAttempts, status: running|paused|stopped|done, createdAt, updatedAt, finishedAt, counts:{pending,running,ok,rejected,total}}`; `QueueView = QueueSummary + items[]`; пункт `{id, position, input, status: pending|running|ok|rejected, attempts, pass, verdict: ok|fail|null, reason, excerpt (≤1000), sessionId, manual: boolean, updatedAt}`.
- Ошибки: NO_ITEMS / TOO_MANY_ITEMS / ITEM_TOO_LONG / QUEUE_INVALID (400), QUEUE_STATE / NO_REJECTED / ITEM_STATE (409), QUEUE_NOT_FOUND / ITEM_NOT_FOUND / AGENT_NOT_FOUND (404), ADMIN_ONLY (403). «Стоп» окончательный.
- Уведомления: `sendOwnerNotice({userId, code, title, body, severity?, meta?, icon?})` из `@/modules/notifications/index.js` — пуш + Telegram; `queue.done` → `/?panel=queue` (тег `queue:<id>`), `schedule.result` → `/?panel=schedules`. Сторожа `startAgentQueueWatch`/`stopAgentQueueWatch`, `startScheduleResultWatch`/`stopScheduleResultWatch` в `server/index.js`.
- Расписания API: `agentId: string|null`, `notify: boolean`, `lastResult: string|null`; с агентом `projectPath` не нужен; `schedulesDb`, `pipelinesDb` в баррели БД.
