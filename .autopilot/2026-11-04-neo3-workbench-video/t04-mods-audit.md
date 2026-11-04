# T04 — проверка 15 модов на Codex и Grok (04.11.2026)

Ветка `feat/neo3-workbench-build` (worktree `neo3-workbench-build`), до коммита.
Все тесты ниже входят в `npm test` (временные HOME/DATABASE_PATH). «Живой» —
прогон настоящего движка из Neo3-кода в изоляции: временные HOME/CODEX_HOME/GROK_HOME
(вход — ссылкой на существующий `auth.json`), временная БД, временная папка проекта,
без HTTP-сервера, без `dist/`, без рестарта.

Обозначения: **работает** — сценарий проходит; **исправлено** — было криво, исправлено
в T04; **ограничение** — движок не даёт механизма, карточка говорит об этом.

| Мод | Codex | Доказательство Codex | Grok | Доказательство Grok |
|---|---|---|---|---|
| modImprovementIdeas | работает | `improvement-ideas/tests/gateway.test.ts` (сессия Codex, модель/effort сохраняются); идеи собирает реестр прогонов для всех движков | работает | тот же сбор в `chat-run-registry.service.ts` (`run.ideas.event`), `improvement-ideas/tests/service.test.ts` |
| modAttention | работает | `session-attention.test.ts` «Codex: a bare per-turn complete… ends as done»; `attention-push.test.ts` «Codex turn ending with a question» | работает (огранич.: после рестарта вопрос без кнопок) | `session-attention.test.ts` «Grok: question asked, CLI killed…», «reconcileOnBoot: a Grok question stays waiting» |
| modAnswerButtons | ограничение — только «Открыть» и ответ в чате | `attention-push.test.ts` «push with «Открыть» only»; exec-адаптер Codex не принимает ответы (нужен App Server) | работает | `chat-permission-response.test.ts` «a Grok question answered from a push resumes the session…» |
| modReplyChips | работает | `reply-suggestions.service.ts` читает историю через общий `sessionsService` (провайдер-независимо) | работает | `reply-suggestions.test.ts` (сессия Grok) |
| modSecretGuard | работает (огранич.: CLI-хук — только Claude Code) | страж в `useChatComposerState.ts` → `handleSubmit` для любого движка; `secretGuard` тесты клиента | работает (то же) | то же |
| modMemoryNotes | работает | `memory-suggestions/tests/quiet-session.test.ts` (инструменты Codex: Bash, FileChanges) | работает | там же (run_terminal_command, search_replace, write) |
| modCodeStatus | работает | git/сайт по папке проекта — от движка не зависит (`code-status` тесты) | работает | то же |
| modRelay | работает | `auto-relay.service.test.ts` (Codex, `planBypass` сохраняется); «Фон» Codex теперь тоже задерживает авто-перенос (`backgroundTaskCount`) | работает | `auto-relay.service.test.ts`, `server/grok-relay-note.test.js` |
| modBackgroundConsole | **исправлено**: «Фон: N» не было → есть; «Стоп» не было → есть, когда процесс найден | `codex-background-tasks.test.ts` (фикстура из rollout, 3 фоновых процесса), `server/codex-background-run.test.js` (кадры, мод выкл — нет кадров), `chat-background-codex.test.ts`, `process-tree.test.ts`; **живой**: `sleep 90` в «Фон», процесс найден, «Стоп» → `{ok:true}`, ход 16 с вместо 90 | **исправлено**: живой поток Grok 1.0.70 отдаёт старт JSON `BackgroundTaskStarted` — трекер его не понимал, «Фон» вживую не появлялся; конца в потоке нет → снятие по `pid`; «Стоп» добавлен | `grok-background-tasks.test.ts` (новая реальная фикстура `grok-background-live-json.jsonl`), `server/grok-background-run.test.js`; **живой**: «Фон» появился, процесс найден по `pid`, «Стоп» → `{ok:true}`, Grok сообщил о завершении по сигналу |
| modThreads | работает | `threads-mcp-registration.test.ts` (`~/.codex/config.toml`, `env_vars`, `tool_timeout_sec`), `threads.service.test.ts` «the agent may pick Claude, Codex…» | работает (огранич.: у тиммейтов нет) | `threads.service.test.ts` «spawn_thread … runs the prompt on Grok build-fast» |
| subagentCrabs | работает | `codex-subagents.test.ts` | работает | `grok-subagents.test.ts`, `SubagentContainer.test.ts` (Grok `spawn_subagent`) |
| modScreenshots | работает | `provider-image-history.test.ts` «codex history: … images»; подпись `<screenshot_context>` срезается в `codex-session-title.ts` | работает | `grok-session-title.ts` (`stripAgentOnlyBlocks`), картинки в `grok-cli.js` (`--prompt-json`) |
| modCacheTimer | ограничение | `promptCacheApplies` (`src/utils/promptCache.ts`) — только `claude`; Codex не публикует TTL кэша | ограничение | то же |
| modKrabikAgent | частично — подготовлен, включение после выпуска панели | `krabik/tests/krabik-codex.test.ts` (история Codex, `state.provider`, без лишнего Enter); `docs/codex-mods-parity-2026-11-01.md` | ограничение — нет | Herdr-агент Крабика — Claude/Codex |
| modDuet | работает (анализ без инструментов) | `agent-run/tests/codex-read-only.test.ts`; `duetProvider()` | ограничение — нет | `duet.runtime.ts` выбирает только claude/codex |

Новый мод `modThinkingTime` (не входит в 15, проверен попутно): Claude — **исправлено**
(текст размышления Claude пустой, адаптер его отбрасывал → реестр не видел момент;
теперь пустой маркер), живой Claude: «думал 22,7 с» в кадре и в `run_durations`;
Codex — работает, если Codex прислал reasoning (в живом прогоне с effort по умолчанию
reasoning не пришёл → только «ответ за»); Grok — живой: «думал 10,7 с».
Тест: `chat-run-thinking-time.test.ts` на трёх фикстурах.

## Находки вне зоны T04
- `shared/mods.ts`: описание `modBackgroundConsole` говорит «остановка — только для
  Claude» — после T04 неверно (зона T04 — только поле `engines`).
- `CLAUDE.md` штаба, таблица «Мод | В Grok»: «Стоп» фоновой задачи — «нет» → теперь есть
  (когда процесс найден); `docs/video-mods-coverage.md` (истории 46–47) — таблицу перенести туда.
- Живая проверка Claude шла с настоящим HOME (временная только БД): осталась тестовая
  сессия `~/.claude/projects/-private-tmp-t04-live-cproject/` — не удалялась (правило ключевых папок).
