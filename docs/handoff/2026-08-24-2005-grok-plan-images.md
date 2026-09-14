Довести и не сломать паритет Grok с Claude по картинкам и двум чипам плана в Neo3. Готово = живые проверки на https://claude.neo3.ru: фото не пропадает; фиолетовый «Планирование + обход» = вопросы → ответ → план и работа до конца без второго «ок»; синий «Режим планирования» = план на экране, Build делает, Revise переписывает.

СТЕК/КОНТЕКСТ:
- Форк CloudCLI / Neo3: `/home/agents/Antigravity Project/claude agent/cloudcli-fork`, ветка `dima/fork-customizations`. origin — чужой апстрим, пуш только в `backup`. Коммит/пуш — только по «да».
- Прод: этот VPS, `neo3.service`, порт 3001, https://claude.neo3.ru. Последний рестарт этой сессии: **2026-08-24 19:25:10 MSK** (`ActiveEnterTimestamp`). Фронт-бандл после сборки 19:23: `dist/assets/index-vsWPEYhA.js`.
- Движок по умолчанию Grok. CLI `grok 1.0.5 (5115b46bc9)`. Пресет `grok-mode-build` → модель `grok-4.6`.
- Грязное дерево ОГРОМНОЕ и живое (панель «Аудит и деньги» untracked `server/modules/governance/` + `src/components/governance/` + куча модифицированных файлов не из этой сессии). `git stash` / `git checkout --` = потеря суток. Не прибирать чужое.
- Вольт: `/home/agents/Antigravity Project/Dimasik-Obsidian/Dimasik`. Стиль Диме — `ponyatno`. Скилл `handoff` = ЧАСТЬ А в чат + этот файл.
- Предыдущие эстафеты: `docs/handoff/2026-08-24-1505-grok-parity-stop-images-buttons.md` (стоп-память / картинки / кнопки — картинки тогда ещё не были доведены до телефото). Хвост миграции 22.08 закрыт коммитом `50bd320`. Последний коммит на ветке: `dcf9e9c` (docs handoff grok parity). Правки этой сессии **не закоммичены**.

ЧТО УЖЕ СДЕЛАНО — НЕ ПЕРЕДЕЛЫВАТЬ:
- 10 фиксов движка 22.08 (`d3aeba3`, `c4a3841`): правила в `<work_mode_rules>`, хуки SessionStart/UserPromptSubmit, killTree, ретраи xAI, effort, identity. Не откатывать.
- Stop-хук / «записал в память → путь» на Grok: второй `--resume` после `complete`, сентинел `/tmp/claude-mem-<uuid>`, reason в `<session_followup>`. На вопросе с кнопками Stop не гонять.
- Кнопки вариантов: парсер `parseGrokNumberedQuestion` → синтетический `AskUserQuestion`. Клик = обычный `chat.send`. `supportsPermissionRequests` у Grok остаётся false.
- Картинки (эта сессия): `supportsImages: true`. Маленький png → `--prompt-json` ACP `{type, mimeType, data}`. Телефото как один argv бьёт Linux MAX_ARG_STRLEN 128 КБ (`E2BIG`) → CLI не стартует → refresh стирает пузырь. Фоллбек: `--prompt-file` + тег «прочитай файлы через read_file». Потолок argv: `MAX_GROK_PROMPT_ARGV_CHARS = 96 * 1024` в `server/grok-cli.js`. Живая проверка 24.08 ~19:13: фото Димы дошло, модель его прочитала.
- Фиолетовый «Планирование + обход» (`planBypass`): две фазы в `buildGrokRules`. `ask` = HARD RULE вопросы 3–4 про цель/срок/объём, конец хода, `--disallowed-tools search_replace,write`. `run` = план видимым текстом и работа до «готово, проверяй», все тулы. Защёлка `planBypassAwaitingAnswers` + файл `/tmp/neo3-plan-bypass/<appSessionId>.latch` (переживает рестарт neo3). Живая проверка: вопросы пришли. Фаза `run` после ответа в этой сессии один раз снова получила ASK — защёлка тогда была только в памяти, рестарт 19:25 её стёр; теперь на диске, **вживую после ответа «делай до конца» не проверяли**.
- Синий «Режим планирования» (`plan`): native grok `--permission-mode plan` отменяет прогон на первом туле. Теперь `resolveGrokPermissionMode('plan')` → `bypassPermissions` + запрет записи + `PLAN_MODE_RULE` (напиши план и остановись) + синтетический `ExitPlanMode` (карточка Build/Revise). Build → `handleChatSend` с `permissionMode: bypassPermissions` и промптом «план одобрен, делай». Revise → остаёмся в `plan`. Чип после Build сам уходит в «Обход» (`decisionExitsPlanMode` только для `plan`, не для `planBypass`). **Build/Revise вживую не прожимали.**
- `complete` больше не выкидывает pending `ExitPlanMode` (`useChatRealtimeHandlers.ts`) — иначе кнопки Build пропадали бы сразу: Grok эмитит ExitPlanMode ПОСЛЕ выхода процесса.
- i18n подсказки режимов в `src/i18n/locales/{ru,en}/chat.json` (`codex.descriptions.plan` / `planBypass`).
- Вольт: `wiki/concepts/neo3-plan-bypass-grok.md`, правки `wiki/concepts/neo3-grok-parity-stop-images-buttons.md`, `wiki/synthesis/neo3-grok-parity-stop-images-buttons-2026-08-24.md`.

РАЗВЕДКА КОДА (не искать заново):
- Картинки: `server/shared/image-attachments.ts` — `buildGrokUserContent`, `appendImagesInputTag` vs `appendVisibleImagePathsTag`. Шлюз: `chat-websocket.service.ts` (`splitAttachmentsByKind`, `filterImagesToUploadStore`). Спавн: `spawnGrok` в `server/grok-cli.js` — если JSON не влезает в argv, `writeGrokPromptFile` + `--prompt-file`. `-p` и `--prompt-json` вместе нельзя. `--prompt-json /path` и `@file` grok 1.0.5 НЕ принимает (argv parse: Invalid JSON).
- План+обход: `src/components/chat/utils/autoPlanMode.ts` — на Claude wire=`plan` и клиент авто-одобряет ExitPlanMode; на Grok wire=`planBypass` целиком в рантайме. `toWirePermissionMode(..., 'grok')` отдаёт `planBypass`.
- Фазы: `consumeGrokPlanBypassAwaitingAnswers(appSessionId)` в начале `spawnGrok`. Маркер ставит `maybeEmitGrokQuestion` при `planBypassPhase === 'ask'`. Клик по кнопке вопроса → `takeGrokQuestion` + `handleChatSend` с `resumeOptions` (там всё ещё `permissionMode: planBypass`) → consume → phase `run`.
- Синий план: `registerGrokPlanExit` / `takeGrokPlanExit` в `server/shared/grok-question.ts`. Эмит: `maybeEmitGrokPlanExit` после `code === 0`. UI: `PlanDisplay.tsx` (кнопки Build/Revise), конфиг `toolConfigs.ts` `ExitPlanMode.input.plan`. Баннер и композер ExitPlanMode скрывают — карточка должна быть в ленте как `tool_use`.
- Тесты: `cd cloudcli-fork && ./node_modules/.bin/tsx --tsconfig server/tsconfig.json --test --test-timeout=30000 server/grok-cli.test.js server/shared/tests/grok-question.test.ts` (36 тестов, зелёные 24.08 19:23). Голый `npx tsx` из корня `claude agent` не видит `server/tsconfig.json`.
- Сборка: `npm run build:client && npm run build:server`. Сервер подхватывает только после рестарта `neo3.service`. Рестарт: `scripts/restart-after-reply.sh 90` — ждёт пока этот grok-процесс умрёт, иначе убьёт чат. Не рестартить при чужих живых прогонах.
- `npx tsx -e` в этом репо молчит. pre-commit eslint красный на чужом `boundaries/*` — коммит с `--no-verify` и причиной, если Дима разрешит.

ОСТАВШИЕСЯ ЗАДАЧИ (по приоритету):
1. Живая проверка синего плана на https://claude.neo3.ru: новый чат, синяя точка, задача → план и кнопки Build/Revise. Build делает по плану до «готово». Revise оставляет синий чип и просит переписать план. Критерий: не сдыхает на первой команде, не пилит без Build.
2. Живая проверка фиолетового после ответа: вопросы → клик/«2» → в том же продолжении видимый план и работа до конца, БЕЗ второго раунда вопросов. Если снова ASK — смотреть `/tmp/neo3-plan-bypass/` и `consumeGrokPlanBypassAwaitingAnswers`.
3. Не регрессить картинки: вложить телефонное фото + текст — пузырь остаётся, модель описывает пиксели (или читает файл), путь знает.
4. Не коммитить и не пушить, пока Дима не скажет «да». В коммит этой темы не тащить `governance/` и прочий чужой dirty.

ГРАБЛИ / ПОДВОДНЫЕ КАМНИ:
- `--prompt-json` с base64 фото на argv = `spawn E2BIG` = сообщение «просто удаляется». Не возвращать «всегда prompt-json».
- Native grok `--permission-mode plan` = cancelled на первом туле. Не возвращать `resolveGrokPermissionMode('plan') === 'plan'`.
- `complete` раньше дропал ExitPlanMode как non-actionable leftover (заточен под Claude, где ExitPlanMode резолвится ДО complete). На Grok эмит ПОСЛЕ выхода процесса.
- Фиолетовый чип сам НЕ выключается (`decisionExitsPlanMode` его не трогает). После рестарта neo3 in-memory Set фаз пустой — без файла-защёлки следующее сообщение снова QUESTIONS FIRST. Дима из-за этого злится: скилл хэндоффа / «привет» тоже ловят вопросы. Не лечить это откатом фаз — лечить либо защёлкой (уже на диске), либо исключением рецептов/хэндоффа из ASK (он явно сказал: «клоуд не спрашивал»).
- В части ходов этой сессии не было инструментов Write/Edit — правки шли через python в bash. Не считать дерево «не менялось».
- Не открывать `--rules` как живой канал: на 1.0.5 headless мёртв, правила едут в промпте тегом `<work_mode_rules>`.
- Не называть в grok-диалекте AskUserQuestion / Skill tool (тест `rules sent to Grok never name a tool it does not have`).

ЖЁСТКИЕ ОГРАНИЧЕНИЯ:
- Не откатывать дефолт безнадзорных на Claude.
- Не пушить в origin. Коммит — по «да».
- Секреты не в код и не в этот файл.
- Не рестартить `neo3.service` при живых чужих прогонах.
- Картинки читать только из `~/.cloudcli/assets` и cwd (`isAllowedImageSourcePath`).
- Не жечь SuperGrok на пачку сабагентов ради пробника картинки.

ОТКРЫТЫЕ ВОПРОСЫ / ОТ ДИМЫ НУЖНО:
- Ничего блокирующего для проверки 1–2. Коммит — когда скажет.
- Отдельное продуктовое решение (не в этом хвосте, если сам не попросит): должен ли фиолетовый чип спрашивать на скилл вроде `handoff` / «привет», или ASK только на новую задачу. Дима 24.08 20:05: «клоуд не спрашивал, этот скилл позволяет сделать краткую выжимку».

КРИТЕРИЙ ГОТОВНОСТИ:
- На https://claude.neo3.ru в чате Grok 4.6 Build: фото живое; фиолетовый = бриф → работа до конца; синий = план → Build/Revise.
- `tsx --tsconfig server/tsconfig.json --test` по `grok-cli.test.js` и `grok-question.test.ts` зелёные.
- Старые 10 фиксов и Stop-память не сломаны.
