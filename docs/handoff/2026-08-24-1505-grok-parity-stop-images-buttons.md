Довести паритет Grok с Claude по трём фишкам, которые Дима явно снял с «не чинить»: (1) напоминалка «запиши в память» после ответа, (2) картинки в чате как картинки, не как пути, (3) кнопки с вариантами вместо нумерованного текста. Готово = три живых проверки на проде https://claude.neo3.ru, без регресса 10 фиксов движка от 22.08.

СТЕК/КОНТЕКСТ:
- Форк CloudCLI / Neo3: `/home/agents/Antigravity Project/claude agent/cloudcli-fork`, ветка `dima/fork-customizations` (ahead 1 от `backup/dima/fork-customizations`). origin — чужой апстрим, пуш только в `backup`.
- Прод: этот же VPS, `neo3.service`, порт 3001, edge https://claude.neo3.ru. Рестарт после аудита 24.08 ~14:18 МСК прошёл (лог `/tmp/neo3-deploy-autopilot.log`).
- Движок по умолчанию теперь Grok: подписка Claude Max умерла 24.08. CLI `grok 1.0.5 (5115b46bc9)`. Модель в этом продукте — `grok-4.6` (пресет `grok-mode-build`).
- Грязное дерево ОГРОМНОЕ и живое: панель «Аудит и деньги» (не закоммичена) + фикс безнадзорных на Grok от этой сессии. `git stash` / `git checkout --` = потеря суток работы. Коммит/пуш — только если Дима скажет «да».
- Вольт: `/home/agents/Antigravity Project/Dimasik-Obsidian/Dimasik`. Скилл `obsidian-memory`. Стиль ответа — `ponyatno` (отчёт-шаблон, без жаргона Диме).
- Предыдущие эстафеты: `docs/handoff/2026-08-22-2224-grok-migration-tail.md` (хвост закрыт 23.08 коммитом `50bd320`; пункт «расписания остаются на Claude» СНЯТ 24.08).

ЧТО УЖЕ СДЕЛАНО — НЕ ПЕРЕДЕЛЫВАТЬ:
- 10 фиксов движка 22.08 (коммиты `d3aeba3`, `c4a3841`): правила в промпте `<work_mode_rules>`, хуки SessionStart/UserPromptSubmit через `collectGrokHookContext`, killTree, ретраи xAI, `result.result`, effort, plan `--disallowed-tools search_replace,write`, identity rule. Матрица: вольт `wiki/synthesis/neo3-grok-full-migration-2026-08-22.md`.
- Безнадзорные (расписания/сценарии/Telegram) и `/api/agent` / git-commit-message по умолчанию на Grok, не на Claude. Резолвер `resolveRunEngine` в `server/modules/agent-run/agent-run.service.js`. Тесты: `server/modules/agent-run/tests/resolve-run-engine.test.ts`. Дима user_id=1 в БД: `default_provider=grok`.
- Учёт токенов Grok: `options.meter?.addMessage(rawFrame)` в `spawnGrok`. Цену в $ НЕ выдумывать (подписка, другой множитель кэша).
- MCP-баннеры не становятся пузырём: `isGrokHarnessNoise` в `grok-sessions.provider.ts`.
- Панель «Аудит и деньги» на проде с 13:55 24.08. Код — untracked `server/modules/governance/` + `src/components/governance/`.
- Фронт-бандл на проде: `assets/index-D5lcYuAB.js` (сборка 24.08 14:16).
- «Обрыв чата» = Stop посреди хода: фикс в `useChatComposerState.ts` (вольт `wiki/concepts/neo3-obryv-chata-stop-and-send-2026-08-24.md`). Не путать с этой задачей.

РАЗВЕДКА КОДА (не искать заново):

1) СТОП-ХУК / «запиши в память»
- Claude Stop в `~/.claude/settings.json` → `hooks.Stop[0]`: команда печатает JSON `{"decision":"block","reason":"Перед завершением сессии примени навык obsidian-memory..."}`. Сентинел `/tmp/claude-mem-${sid}` — срабатывает РАЗ за сессию. Второй Stop-хук — `token-log.mjs auto` (не block).
- Claude runtime: `decision:block` НЕ заканчивает ход, а будит агента ещё раз с `reason` как инструкцией. Именно поэтому на Claude после ответа прилетает «записал в память → путь».
- Grok: `collectGrokHookContext` в `server/grok-cli.js` гоняет ТОЛЬКО SessionStart + UserPromptSubmit. Stop НАМЕРЕННО не эмулировали 22.08 («механика block — интерактив Claude», «риск раздуть промпт»). `extractHookContext` уже отбрасывает JSON без `additionalContext` — сырой `{decision:block}` в промпт не класть.
- Grok CLI после `-p` ВЫХОДИТ. Удержать процесс как Claude SDK (held-open stdin) нельзя. Нативный Stop Grok — это `.grok/hooks/` / `[[hooks.*]]` в config.toml, события pre/post-tool и session start/end, БЕЗ `decision:block`.
- Правильная эмуляция: ПОСЛЕ успешного `complete` (не abort/fail) прогнать Stop-хуки с stdin JSON `{session_id}`; если `decision=block` и reason — второй `spawnGrok` с `--resume` той же uuid и промптом = reason. Сентинел хука сам не даст крутиться вечно. Follow-up ход в истории пользователя НЕ должен выглядеть как его сообщение (резать тегом, как `<work_mode_rules>`).
- НЕ впихивать reason в каждый UserPromptSubmit — это и есть «раздуть промпт», от которого отказались 22.08. Дима 24.08 явно сказал делать, но механику block не менял.
- Грабля стиля: после Stop-хода в чат ТОЛЬКО строка «записал в память → /путь», отчёт не дублировать (вольт `wiki/concepts/otvety-bez-zhargona-style-ponyatno.md`, правка хука 24.08 день).

2) КАРТИНКИ
- Матрица: `provider-capabilities.service.ts` grok `supportsImages: false` с комментарием «Image blocks would need --prompt-json content blocks; not wired yet.»
- Шлюз уже кладёт картинки в `runtimeOptions.images` и дописывает пути тегом `appendVisibleImagePathsTag` (`chat-websocket.service.ts`). `spawnGrok` поле `images` ИГНОРИРУЕТ.
- Claude: `buildClaudeUserContent` в `server/shared/image-attachments.ts` — text-блок + `{type:image, source:{type:base64, media_type, data}}`. Путь тег оставляют, чтобы агент мог КОРМИТЬ файл в тулы (`vis --ref`, ffmpeg).
- Cursor/OpenCode: нет зрения, только `<images_input>` (сет `PROVIDERS_WITH_RUNTIME_IMAGE_TAG`).
- Grok CLI 1.0.5: флаг `--prompt-json <JSON>` = «Single-turn prompt as JSON content blocks». Сейчас `buildGrokArgs` всегда шлёт `-p` строкой. Нельзя одновременно -p и --prompt-json (проверить одним броском, не гадать).
- Модель Grok 4.6 картинки УМЕЕТ (вольт `wiki/entities/grok-build-cli.md`: «вход текст+картинки»). Врать «модель слепая» нельзя — слепой рантайм.
- План: (а) дешёвый live-пробник `--prompt-json` с одной png «какой цвет»; (б) хелпер рядом с `buildClaudeUserContent` (не копипастить base64-логику — вынести общее чтение файла); (в) `buildGrokArgs` переключает `-p` → `--prompt-json` если есть images; (г) `supportsImages: true`; (д) путь-тег ОСТАВИТЬ. Бамп `PROVIDER_MODELS_CACHE_VERSION` сейчас = 6, если меняется форма каталога — нет, capabilities не кэшируются каталогом.
- UI загрузки спрятан, пока `supportsImages` false — после флага чип вложения появится сам.

3) КНОПКИ С ВАРИАНТАМИ
- У Grok НЕТ инструмента `AskUserQuestion` (живой тулсет 16+write, README врёт). Называть его в grok-диалекте ЗАПРЕЩЕНО: тест `rules sent to Grok never name a tool it does not have`.
- Claude: CLI шлёт control-request → `claude-sdk.js` эмитит `kind: 'permission_request'` с `toolName: 'AskUserQuestion'` → `AskUserQuestionPanel` (`src/components/chat/tools/components/InteractiveRenderers/AskUserQuestionPanel.tsx`) → `onDecision({allow:true, updatedInput:{..., answers}})`. `supportsPermissionRequests: true` только у Claude.
- Grok `supportsPermissionRequests: false`. Headless permission gate = мгновенный `cancelled`, не пауза.
- grok-диалект `work-mode.ts` уже велит: нумерованные варианты, END YOUR TURN. Это и есть «вопрос». Кнопки должны родиться из этого текста, а не из несуществующего тула.
- Правильная эмуляция: после `complete` (или по живому assistant-text) распарсить последний пузырь на паттерн «N — вариант» / «1. …»; если это вопрос (ход кончился, есть ≥2 нумерованных опции) — синтетический `permission_request` с `toolName: 'AskUserQuestion'` и `input.questions` в форме панели (поле `options[].label`). Ответ юзера = ОБЫЧНОЕ следующее user-сообщение через `--resume` («1» / текст варианта), НЕ tool_result в CLI. Панель уже умеет `answers` в updatedInput — на Grok это просто сериализуется в текст хода.
- Не держать grok-процесс открытым в ожидании клика: его нет. Состояние «ждём ответ» живёт в UI/сессии Neo3, как pendingPermissionRequests.
- Режимы: «Дотошный» обязан остановиться с кнопками; «Брифы» с 23.08 НЕ спрашивает «продолжать?» после каждой стадии — кнопки только на настоящей развилке (work-mode.ts `askAtFork`). Не откатывать это.
- Парсер не должен срабатывать на обычные нумерованные списки в отчёте. Эвристика: ход закончился, последний assistant-text содержит явный вопрос / «выбери» / HARD RULE interrogate, опции короткие. Лучше недопарсить, чем рисовать кнопки на каждом todo.

ОСТАВШИЕСЯ ЗАДАЧИ (по приоритету, три независимых PR-кусочка):
1. Stop-хук на Grok: второй resume-ход с reason, раз за сессию. Критерий: в grok-чате после содержательной работы появляется «записал в память → /абсолютный/путь.md», отчёт не дублируется, сентинел не даёт цикл. Прогон без сути (пинг) — молчит.
2. Картинки: `--prompt-json` + `supportsImages: true` + путь-тег. Критерий: вложить png в grok-чат, модель описывает пиксели (цвет/что на фото), не галлюцинирует «не вижу». Путь файла она тоже знает (для тулов).
3. Кнопки: синтетический AskUserQuestionPanel из нумерованного вопроса Grok, клик = resume с выбранным текстом. Критерий: режим «Дотошный» на новой задаче рисует кнопки; клик по «2» продолжает ход; ввод «2» текстом по-прежнему работает.

ГРАБЛИ / ПОДВОДНЫЕ КАМНИ:
- `--rules` headless мёртв на 1.0.5 — не открывать этот канал заново без БАНАН-эксперимента на новой версии CLI.
- grok-4.5 low сносит вежливое. Новые инструкции — HARD RULE.
- `npx tsx -e` в этом репо молчит — проверки во временный файл.
- pre-commit eslint красный чужим `boundaries/*` (pipelines/schedules/telegram/agent-run) → коммит с `--no-verify` и причиной, если Дима разрешит.
- Не рестартить `neo3.service` при живых чужих прогонах. Фронт живой с диска сразу после `npm run build:client`. Сервер — `scripts/restart-after-reply.sh 90` или `./deploy.sh --restart` когда чаты пусты. Свой чат умрёт вместе с сервисом.
- Второй инстанс UI: `SERVER_PORT=3099` (не PORT), юзер id 3 `fakedr722`. Убивать только PID с `ss -lntp | grep :3099`.
- Кэш каталога моделей 3 суток, версия 6. Capabilities не через этот кэш.
- Не деплоить изнутри CloudCLI вслепую — `deploy.sh` собирает С ДИСКА.
- Тесты гонять так: `npx tsx --tsconfig server/tsconfig.json --test --test-timeout=30000 <файлы>`. Голый `node --test` не резолвит `@/`.

ЖЁСТКИЕ ОГРАНИЧЕНИЯ:
- Не откатывать дефолт безнадзорных обратно на Claude.
- Не класть Stop-reason в каждый промпт.
- Не называть в grok-диалекте AskUserQuestion / Skill tool.
- Не пушить в origin. Коммит/пуш — по «да».
- Секреты не в код. Вольт без токенов.
- Картинки: не читать файлы вне `~/.cloudcli/assets` и cwd (уже есть `isAllowedImageSourcePath`).
- Не жечь SuperGrok на 8 параллельных сабагентов ради пробника картинки — один маленький png.

ОТ ДИМЫ НУЖНО:
- Ничего блокирующего. Порядок трёх пунктов он уже задал списком (стоп → картинки → кнопки). Если в ходе кнопки парсер будет путать списки с вопросами — показать 1-2 живых примера, не угадывать тон.

КРИТЕРИЙ ГОТОВНОСТИ:
- Три живых проверки на https://claude.neo3.ru в чате Grok 4.6 Build.
- `npx tsx --tsconfig server/tsconfig.json --test` по `grok-cli.test.js`, `grok-sessions.test.ts`, `work-mode.test.ts`, новым тестам трёх фич — зелёные.
- `npm run typecheck` чистый.
- Старые 10 фиксов не сломаны: стоп убивает дерево, брифы не спрашивают «продолжать?», план read-only, свежая сессия цитирует вольт из SessionStart.
