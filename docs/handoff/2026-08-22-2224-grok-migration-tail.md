Продолжить доводку Neo3 на движке Grok после полного переноса 22.08: закрыть хвосты миграции и держать паритет с Claude.

СТЕК/КОНТЕКСТ: форк CloudCLI (Neo3 Agent System), `/home/agents/Antigravity Project/claude agent/cloudcli-fork`, ветка `dima/fork-customizations`, прод на этом же VPS под `neo3.service` (порт 3001, edge https://claude.neo3.ru). Дима купил SuperGrok Plus ($100), временно живёт без Claude Code — Grok = основной движок. Прод перезапущен 22.08 21:45 со всеми правками. Пуш идёт в remote `backup` (origin — чужой апстрим, 403).

ЧТО УЖЕ СДЕЛАНО — НЕ ПЕРЕДЕЛЫВАТЬ (коммиты d3aeba3 + c4a3841, оба в проде):
- recordRunOutcome на всех исходах grok-прогона + маркер «⏹ Прогон прерван» в истории (grok-cli.js, grok-sessions.provider.ts)
- transient-ретрай ×3 при обрывах xAI с видимым «повторяю сам»; Стоп работает и во время паузы (стаб в activeGrokProcesses)
- РЕЖИМЫ РАБОТЫ: `--rules` headless МЁРТВ (БАНАН-эксперимент) → правила едут В ПРОМПТЕ тегом `<work_mode_rules>` (embedGrokRulesInPrompt), HARD RULE-хвосты в grok-диалекте work-mode.ts (grok-4.5 low сносил вежливые), AUTO_PLAN_RULE требует план видимым текстом; тег режется из истории (extractGrokUserTurn)
- ХУКИ: Grok сам НЕ исполняет хуки Claude → collectGrokHookContext в grok-cli.js исполняет их за него (SessionStart раз на новую сессию, UserPromptSubmit каждый ход, budget-hook пропущен сознательно — он про окно Claude) → блок `<session_context>` в промпте, тоже режется из истории. Проверено: свежая сессия цитирует вольт (1190 заметок)
- plan-режим реально read-only: `--disallowed-tools search_replace,write` (гейт CLI пропускает ПЕРВЫЙ файловый write; тул `write` есть в живом тулсете, README врёт про 16)
- Стоп убивает всё дерево: walk по ppid + kill группы + SIGKILL-эскалация 2.5с (bash-обёртки Grok живут в своей сессии)
- result.result-фолбэк (прогон без assistant-text больше не пустой)
- /api/agent stream:false: ResponseCollector понимает NormalizedMessage (было пусто для ВСЕХ движков), токены без двойного кэша; effort прокинут в grok-ветки headless (agent-run.service.js:199, routes/agent.js)
- Настройка «Открывать новые чаты на этом движке»: колонка default_provider (+миграция), PUT /api/settings/provider-preferences/default-provider, тумблер в Настройки → Агенты → <движок> → Новые чаты, применяется на кнопке «Новый чат» (ChatInterface, newSessionTrigger) и при первом рендере (readStoredProvider), кэш localStorage `default-chat-provider`
- Тесты: 584 зелёных (было 563), typecheck чистый. Полный боевой прогон: 17 кейсов Workflow (34+10 агентов), всё зелёное после фиксов — матрица в вольте `wiki/synthesis/neo3-grok-full-migration-2026-08-22.md`

РАЗВЕДКА КОДА (не искать заново):
- Вся grok-механика: server/grok-cli.js (спавн/ретрай/аборт/хуки/правила), grok-sessions.provider.ts (парсер live+history, фильтр сабагентов по parent_tool_use_id), provider-capabilities.service.ts:129 (матрица), grok-models.provider.ts (пресеты grok-mode-build/fast, разворот ТОЛЬКО в buildGrokArgs)
- Headless-прогон через продукт: runHeadlessPrompt (agent-run.service.js) — им ходят расписания/Telegram; сам прогон в обход UI: `npx tsx --tsconfig server/tsconfig.json` + import spawnGrok с writer-коллектором (паттерн харнесса описан в вольт-заметке миграции)
- Кэш каталога моделей 3 суток: правка формы каталога = бамп PROVIDER_MODELS_CACHE_VERSION (provider-models.service.ts:25, сейчас 5)
- Второй инстанс для UI-проверок: SERVER_PORT=3099 (НЕ PORT), юзер id 3 fakedr722, убивать ТОЛЬКО по PID из `ss -lntp | grep :3099` (по маске = убьёшь прод)
- deploy.sh собирает С ДИСКА; отложенный рестарт scripts/restart-after-reply.sh N (ждёт тишины CPU); не рестартить сервис изнутри своего чата
- ~/.grok/auth.json: OAuth-токен живёт 6ч, рефрешится сам; зелёный кружок в UI срок НЕ проверяет

ОСТАВШИЕСЯ ЗАДАЧИ (по приоритету):
1. Незакоммиченный хвост: 24 грязных файла (тема ember + фронт-доработки прошлой сессии: ThemeVideoBackground, chatFormatting, providerModelState и др.) — уже в прод-бандле (деплой с диска), но НЕ в гите. Закоммитить одним коммитом «накопленный фронт», критерий: git status чистый.
2. Grok Bot уже стоит у Димы на маке (бот «Старший маркетолог» живой). Если попросит мост Bot→VPS: единственный легальный путь — remote MCP-сервер с публичным HTTPS на VPS (localhost/приватные IP Grok Bot отвергает); SSH-ключи прода в VM бота НЕ класть (общая VM без изоляции). Досье: вольт `wiki/entities/grok-bot-xai-cursor.md`.
3. Опционально: Stop-хуки на Grok не эмулированы (напоминание «запиши в вольт») — можно добавить правило в CLAUDE.md-стиле или хвост в session_context; решить с Димой, не раздуёт ли промпт.
4. Опционально: сабагенты Grok — главный агент транслирует их блоки текстом (стиль модели); если Дима пожалуется на «простыни» — думать про сворачивание в UI.
5. Следить за апдейтами grok CLI (сейчас 1.0.5, авто-апдейт launchd): если `--rules` починят — канал в промпте можно будет сузить.

ГРАБЛИ / ПОДВОДНЫЕ КАМНИ:
- pre-commit eslint красный ЧУЖИМ долгом boundaries/no-unknown (7 ошибок, agent-run.service.js, решение Димы — оставить) → коммитить с --no-verify и причиной в теле
- grok-4.5 на low игнорирует мягкие инструкции — любые новые правила формулировать жёстко (HARD RULE, no exceptions)
- `npx tsx -e "..."` в репо молча ничего не печатает — код проверок писать во временный файл
- Тесты «rules never name a tool it does not have» (grok-cli.test.js) — при правке диалектов не называть AskUserQuestion/Skill
- Vite-бандл при рестарте сервиса пересобирается с другим хэшем — сверять код грепом по dist, а не хэшем

ЖЁСТКИЕ ОГРАНИЧЕНИЯ:
- Расписания/сценарии/Telegram НЕ переводить на Grok (решение Димы 22.08)
- Не пушить в origin (чужой), только в backup; коммит/пуш — по запросу
- Прод не рестартить при живых чужих прогонах; kill только по точному PID

ОТ ДИМЫ НУЖНО:
- Ничего блокирующего. По желанию: включить тумблер «Открывать новые чаты на этом движке» в Настройки → Агенты → Grok → Новые чаты (сам не включал — выбор за ним).

КРИТЕРИЙ ГОТОВНОСТИ:
- npm test + typecheck зелёные; https://claude.neo3.ru/health = ok; новый grok-чат: режим «Брифы» останавливается с планом, стоп убивает всё, свежая сессия цитирует вольт.
