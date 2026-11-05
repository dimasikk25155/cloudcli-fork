# 01 — Агенты: фундамент и сервер

**Требования:** R01, R02, R04, R06i, R07i, R08i, R09i, R10i
**Зависит от:** —
**Зона:** `shared/` · `server/modules/database/` · `server/modules/agents/` · `server/modules/agent-run/` · `server/modules/websocket/services/chat-websocket.service.ts` · `server/index.js` · `eslint.config.js`
**Волна:** 1
**Ревью:** да — фундамент
**Модель:** сильная

## Что должно заработать

В Neo3 есть сущность «агент»: имя, роль, правила самопроверки, движок/модель/effort, папка проекта, файлы-знания и память правил с версиями. Админ создаёт и правит агентов через `/api/agents`, а по `POST /api/agents/:id/chat {task}` сервер сам открывает обычный чат проекта на движке агента. Первое сообщение несёт скрытый блок роли `<agent_brief>`, человек его не видит. Здесь же закладывается общий фундамент для следующих тасков: все новые таблицы (включая конвейер и колонки расписаний), три мода, разбор вердикта, актор `queue`.

## Из брифа, дословно

> «потяни все возможности grok bot в наш cli»
> «сделай апгрейд»

## Разделы спецификации

Истории 2, 2a, 3, 4, 5 (сервер), 6, 20, 21, 22. `interfaces.md` §1, §2 целиком; из §4 и §5 — только схема БД (таблицы `agent_queues`, `agent_queue_items`, колонки `schedules`) и `KNOWN_ACTORS += queue`.

## Критерии приёмки

- [ ] `shared/mods.ts` содержит `modAgents`, `modAgentQueue` (requires `modAgents`), `modSecretRequest` с русскими карточками; тест ui-preferences-mods обновлён и зелёный
- [ ] `buildAgentBrief`/`withAgentBrief` (`shared/agent-brief.ts`) собирают блок с именем, ролью, проверкой результата, путями файлов и правилами «(Vn)»; `stripAgentOnlyBlocks` срезает `<agent_brief>` — тесты
- [ ] `parseVerdict` (`shared/queue-verdict.ts`) различает OK, FAIL с причиной (`—`, `-`, `:`), `VERDICT` латиницей и отсутствие строки; `VERDICT_INSTRUCTION` экспортирован — тесты
- [ ] Миграции создают `agents`, `agent_rules`, `agent_sessions`, `agent_queues`, `agent_queue_items` и колонки `schedules.agent_id|notify|last_result|notified_at` на старой БД без потерь (повторный запуск миграций безопасен) — тест
- [ ] `createAgentsService`: CRUD с валидацией (имя уникально без регистра, провайдер ∈ claude|codex|grok, модель из каталога, папка — зарегистрированный проект, файлы только внутри папки: `..` и симлинк наружу — отказ, ≤20); правила: добавить/удалить, версия растёт, история версий видна, ≤50 живых — тесты на временной БД
- [ ] `POST /api/agents/:id/chat` создаёт app-сессию на провайдере агента, связь `agent_sessions`, имя чата «<агент>: <начало задачи>», стартует прогон через `createAgentRunControl` (новый `access.kind:'agent'`) с моделью/effort агента и содержимым `withAgentBrief(...)`; `GET /api/agents/by-session/:sessionId` отдаёт агента — тесты с фейковым run control
- [ ] Роуты `/api/agents`: не-админ → 403; мод `modAgents` выкл → 409 `MOD_OFF` — тесты
- [ ] Сессии сайдбара несут `agentName` для чатов агента (там же, где `links`)
- [ ] `KNOWN_ACTORS` содержит `queue`; новые файлы `server/shared/*` (если есть) зарегистрированы в `eslint.config.js`
- [ ] `npm run typecheck` и `npm test` (с каноническим TMPDIR) зелёные
- [ ] Боевое не тронуто: ни `npm run build`, ни рестарта, ни правок `~/.claude*`, `~/.codex`, LaunchAgents; тесты второго чата, Safari вживую, новой вкладки и рабочего стола зелёные
