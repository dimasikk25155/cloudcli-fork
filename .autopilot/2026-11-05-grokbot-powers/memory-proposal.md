# Предложение для `claude agent/CLAUDE.md` (grokbot-powers)

Файл CLAUDE.md не тронут. Ниже — раздел для вставки (после «Второй чат справа на холсте») и список устаревших строк.

---

## Агенты, штаб, конвейер, рутины, запрос ключа (05.11, ветка `feat/neo3-grokbot`, worktree `claude agent/neo3-grokbot`, не выкачено)

Разбор Grok Bot и что из него взято — `docs/grokbot-in-neo3.md`. Три мода, всё только для админа, исполнители — CLI-движки по подпискам (платных API нет). Моды: `modAgents`, `modAgentQueue` (requires `modAgents`), `modSecretRequest` (requires `modAttention`); тексты карточек — `shared/mods.ts`.

- Агент = имя, роль, `checks` («Проверка результата»), движок/модель/effort, папка проекта, файлы-знания, правила с версией (V1, V2…). Сервер: `server/modules/agents/` (`agents.service.ts` — `createAgentsService`, `agents.routes.ts` — `/api/agents`, admin + `MOD_OFF`); БД `server/modules/database/repositories/agents.db.ts` (`agents`, `agent_rules`, `agent_sessions`).
- `<agent_brief>`: `shared/agent-brief.ts` (`buildAgentBrief`, `withAgentBrief`) кладёт роль, правила и файлы скрытым блоком в первое сообщение; блок срезает `shared/agent-only-blocks.ts` (пузыри, заголовки). Блок, а не системный промпт — поэтому работает в Claude, Codex и Grok.
- Чат агента: `agentsService.startChat` → `createAgentRunControl` (`server/modules/websocket/services/chat-websocket.service.ts`, доступ `{kind:'agent', userId}`), подключён в `server/index.js`. Метка в сайдбаре — `agentName` (`projects-with-sessions-fetch.service.ts`, `src/components/sidebar/utils/agentLabel.ts`).
- Самопроверка: ответ кончается строкой `ВЕРДИКТ: OK|FAIL — причина`; разбор и текст требования — `shared/queue-verdict.ts` (`parseVerdict`, `VERDICT_INSTRUCTION`); нет строки = FAIL «нет вердикта».
- Штаб: `spawn_thread{agent}` (`server/modules/threads/threads.service.ts`, `server/threads-mcp.ts`; явные provider/model приоритетнее агента; нет агента — `AGENT_NOT_FOUND` со списком имён); `workspace_action agent.list` и `agent.remember {text}` — `server/modules/agent-workspace/tools.ts` (правило идёт агенту ЭТОГО чата и всем его следующим чатам).
- Конвейер: `server/modules/agent-queue/` (`agent-queue.service.ts`, роуты `/api/agent-queue`, `agent-queue.runtime.ts` — сторож, тик 5 с); БД `repositories/agent-queue.db.ts` (`agent_queues`, `agent_queue_items`). ≤500 пунктов, `{{item}}` в шаблоне, 1–3 параллельно, 1–4 попытки; брак — причина FAIL уходит в повтор; ≤3 очереди в работе; Claude ждёт `checkUsageGuard`; после рестарта `recoverOnBoot` возвращает running в pending; «Стоп» окончательный; итог — один пуш и Telegram `queue.done` → `/?panel=queue`. Актор аудита `queue` (`KNOWN_ACTORS` в `server/modules/agent-run/agent-run.service.js`).
- Рутины: `server/modules/schedules/` — у расписания `agent_id`, `notify`, `last_result` (≤600 знаков), `notified_at` (`repositories/schedules.db.ts`); агент удалён — статус «агент удалён», без прогона; сторож итогов `schedule-result-watch.ts` (тик 60 с) → `sendOwnerNotice` (`server/modules/notifications/services/owner-notice.service.ts`), код `schedule.result` → `/?panel=schedules`; UI — `src/components/schedules/SchedulesPanel.tsx`.
- Запрос ключа: `workspace_action secret.request {name, why}` (имя `^[A-Z][A-Z0-9_]{2,63}$`) → `server/modules/secret-requests/` (запрос только в памяти сервера, не в БД; тул ждёт до 600 с, потом «Дима пока не ответил»); `/api/secret-requests` (`GET`, `POST /:id {value, replace?}`, `POST /:id/decline`); значение идёт в `server/modules/secrets-stash/` с `onExisting: 'reject'|'replace'` (`SECRET_EXISTS`), агенту уходит только имя. Клиент — `src/components/attention/secret-requests/` (поле `type=password`, значение чистится после отправки), секция в `hubSections.ts`.
- Клиент: `src/components/agents/` и `src/components/agent-queue/` (`*Panel.tsx`, `*Model.ts`, `use*.ts`), пункты `AGENTS_PANEL` (`?panel=agents`) и `QUEUE_PANEL` (`?panel=queue`) в `SidebarFooter.tsx`; конвейер опрашивает раз в 5 с, пока панель открыта.

Env (только имена):
- `NEO3_AGENT_QUEUE_WATCH=off` — сторож конвейера не берёт пункты.
- `NEO3_SCHEDULE_NOTIFY_WATCH=off` — не шлёт итоги расписаний.
- `NEO3_SECRETS_FILE` — куда запрос ключа пишет значение (как у stash).

Тесты (все в `npm test`): `server/modules/{agents,agent-queue,secret-requests}/tests/`, `server/modules/schedules/tests/schedules-agent.test.ts`, `server/modules/threads/tests/threads-agent.test.ts`, `server/modules/database/tests/agents.db.test.ts`, `server/modules/websocket/tests/chat-agent-run.test.ts`, `server/shared/tests/{agent-brief,queue-verdict}.test.ts`; клиент — `agentsModel`, `agentQueueModel`, `secretRequests`, `agentLabel`.
- Целиком: `npm run typecheck && TMPDIR="$(node -p 'require("node:fs").realpathSync(require("node:os").tmpdir())')" npm test` — 2163 passed, 0 failed. Новые модули по одному — как в «Выборочные тесты», с временными `HOME` и `DATABASE_PATH` (103/103).

Подводные камни:
- Чистый клон: `npm ci` падает `husky: command not found`, если у агента Neo3 `NODE_ENV=production` — ставить `NODE_ENV=development npm ci`.
- Сервер слушает `SERVER_PORT`, не `PORT`; 3001 на маке занят Dolphin по IPv6 — запускать на другом порту.
- Временная папка `/var/...` против `/private/var/...`: файлы агента проверяются по каноническому пути (`agents.service.ts`), иначе `FILE_OUTSIDE_PROJECT`; в тестах брать `realpathSync`.
- Уникальность имени агента без регистра для кириллицы держит сервис, не индекс БД.
- Списки моделей агентов скопированы из threads (иначе цикл threads-agents) — менять в двух местах.
- Первый прогон чата агента идёт в режиме разрешений движка по умолчанию, не в bypass.
- Выкл `modAgentQueue`: тик не берёт пункты, `running` становится `paused`, уведомлений нет; выкл `modSecretRequest` или `modAttention`: агент сразу получает отказ, а не ждёт.
- Тиммейтам агенты, конвейер и запрос ключа закрыты; метку агента их список чатов не отдаёт.
- Новый актор прогонов — в `KNOWN_ACTORS` и в фильтр ленты аудита (`server/modules/governance/governance.routes.ts`), иначе его не видно.

---

## Что в нынешнем CLAUDE.md стало неправдой

- «`MOD_KEYS` (12): `modAttention` … `modCacheTimer`» → в `shared/mods.ts` ключей 27 (после `modCacheTimer`: `modKrabikAgent`, `modDuet`, `modImprovementIdeas`, `modWorkbench`, `modSessionHub`, `modSideChat`, `modGroups`, `modThinkingTime`, `modKeepAwake`, `modDiagnostics`, `modArtifactEditor`, `modSafariLive`, плюс эта сборка: `modAgents`, `modAgentQueue`, `modSecretRequest`); писать «27» или убрать число.
- «Запуск треда — `beginChatSend` с доступом `{kind:'thread', …}`» (волна 2) → видов доступа два: ещё `{kind:'agent', userId}` у чата агента (`createAgentRunControl`).
- «`POST /api/secrets/stash` (admin) переносит вставленный ключ в файл секретов» → для композера так же (имя получает суффикс `-2`), но у сервиса появились режимы `onExisting: 'suffix'|'reject'|'replace'` для запроса ключа.
- «Тред: инструменты `spawn_thread`, `thread_status`, `message_thread`, `stop_thread`» (волна 2) → у `spawn_thread` новый параметр `agent`; у `workspace_action` новые действия `agent.list`, `agent.remember`, `secret.request`.
- «Хаб `AttentionHub*`; слот секций `hubSections.ts` — туда же предложения памяти» → в слоте теперь и «Агент просит ключ» (`attention/secret-requests/`).
- «Дуэт: … `modDuet` (14-й)» и «`modKrabikAgent` (13-й)» остаются верными, но «13-й/14-й» теперь не конец списка: всего 27.
