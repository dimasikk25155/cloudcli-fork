# F1 — Ремонт по ревью ветки

**Требования:** R01, R05i, R07i, R08i
**Зависит от:** —
**Зона:** `shared/mods.ts` · `shared/queue-verdict.ts` · `server/shared/types.ts` · `server/shared/utils.ts` · `server/shared/tests/` · `src/types/app.ts` · `server/modules/secret-requests/` · `server/modules/agent-queue/` · `server/modules/projects/` · `server/modules/database/tests/` · `src/components/sidebar/` · `docs/grokbot-in-neo3.md`
**Волна:** 4
**Ревью:** да — ремонт ветки
**Модель:** сильная

## Что должно заработать

Закрыты находки общего ревью ветки: запрос ключа не повисает, если «Ждут тебя» выключен; брак всегда несёт причину; тиммейт не видит меток агента; значение ключа не попадает в лог даже при битом запросе; документ называет кнопки так же, как интерфейс.

## Из брифа, дословно

> «потяни все возможности grok bot в наш cli»
> «пронализиуй»

## Критерии приёмки

- [ ] `shared/mods.ts:252` + `server/modules/secret-requests/secret-requests.service.ts:115-118` + `src/components/sidebar/view/Sidebar.tsx:263` — у `modSecretRequest` стоит `requires: 'modAttention'`, `allow()` проверяет `isModActive`, и при выключенном «Ждут тебя» `secret.request` сразу отвечает текстом `modOffMessage` (тест)
- [ ] `server/shared/types.ts:258`, `src/types/app.ts:54` — строка `secret_requests_changed` с комментарием «без содержимого» есть в обоих `GatewayEventKind`
- [ ] `shared/queue-verdict.ts:31` + `agent-queue.service.ts:317` — FAIL с пустым текстом → причина «причина не указана»; повтор получает её как причину прошлой попытки (тест)
- [ ] `docs/grokbot-in-neo3.md` — тексты совпадают с `AgentQueuePanel.tsx` и `SchedulesPanel.tsx`: строка 76 «Ещё проход» → «Ещё проход по браку»; строка 74 «Параллельность» → «Параллельно»; строка 93 «в задании» → поле «Промпт»; строка 37 «тиммейты агентов не видят» — исправить на правду после пункта ниже
- [ ] Безопасность · `server/modules/projects/services/projects-with-sessions-fetch.service.ts:174-181` — `agentName` у сессий отдаётся только админу (`isAdminUser`); тиммейт с доступом к проекту метки агента не получает (тест)
- [ ] Безопасность · `server/shared/utils.ts:113` — ошибка разбора тела запроса (битый JSON, `type: 'entity.parse.failed'`) отвечает 400 и в лог не печатает `err.body`/сырое тело; прочие ошибки логируются как раньше (тест: POST `/api/secret-requests/:id` с телом `{"value":"abc` — строки значения нет в выводе `console.error`)
- [ ] Боевое не тронуто; `npm run typecheck` и `npm test` зелёные
