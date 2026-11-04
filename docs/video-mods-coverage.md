# Покрытие двух роликов в Neo3 (сборка 04.11.2026)

Сборка «Рабочий стол Neo3 по двум роликам», ветка `feat/neo3-workbench-build`.
Источники разбора — в папке прогона `cloudcli-fork/.autopilot/2026-11-04-neo3-workbench-video--wip/`:
`video-review.md` (каталог ролика Claude Code 2.0 с таймкодами), `reference.md` и кадры
`reference-frames/storyboard-00.jpg … storyboard-15.jpg` (что видно на экране), журнал сквозной
проверки `t10-e2e.md`, скриншоты `shots/t02-*.png`, `shots/t10-*.png`.
Ролик Jev разобран в `docs/jev-visual-qa.md` штаба (17 приёмов).

Статусы:
- **уже было** — работало до сборки, сборка только сверила;
- **сделано** — построено в этой сборке;
- **ограничение** — сделано, насколько позволяет движок или платформа; граница названа;
- **отложено** — сознательно не делали, причина в «Вне рамок» спецификации.

Все новые функции — за выключателями в «Настройки → Плагины → Встроенные моды» (`shared/mods.ts`):
`modWorkbench`, `modSessionHub`, `modSideChat`, `modGroups`, `modThinkingTime`, `modKeepAwake`,
`modDiagnostics`. У каждой карточки мода есть строка «Claude ✓ · Codex … · Grok …» (поле `engines`).

## 1. Три авторских мода ролика Claude Code 2.0

| Мод (таймкод) | Статус | Где в Neo3 |
|---|---|---|
| Контекст и лимиты ([18:51](https://www.youtube.com/watch?v=Xq9YfQV8C-o&t=1131s)) | сделано (Grok — ограничение) | Рабочий стол → вкладка «Контекст и лимиты» (`src/components/workbench/limits/ContextLimitsCard.tsx`, нормализатор `src/utils/providerLimits.ts`); в поле ввода — «N%», «5ч N% · 7д N%». Занятость = последняя занятость / окно модели. Claude и Codex — окна со временем сброса; Grok — «лимиты не сообщает» (`known:false`). Раскладка по категориям — не показывается: движки её не отдают (п. 09) |
| Session Hub ([19:53](https://www.youtube.com/watch?v=Xq9YfQV8C-o&t=1193s)) | сделано | Полоса «работают / ждут / готово» над полем ввода (`src/components/session-hub/SessionHubBar.tsx`), выдвижная панель (`SessionHubPanel.tsx`) по всем проектам; данные — существующий «Ждут тебя» (`GET /api/attention`). «Прочитано» не останавливает задачу |
| Handoff / перенос ([21:31](https://www.youtube.com/watch?v=Xq9YfQV8C-o&t=1291s)) | уже было + сделано | «Эстафета» существовала (`server/modules/auto-relay/`); в карточке «Контекст и лимиты» добавлена кнопка «Перенести» (тот же `POST /api/sessions/:id/auto-relay/start`). Пороги 50% / 400K / 12 ч не менялись (в ролике 60%) |

## 2. Каталог ролика: 25 пунктов

| № | Пункт (таймкод) | Статус | Где в Neo3 / почему |
|---|---|---|---|
| 01 | Настройка рабочего места словами ([01:45](https://www.youtube.com/watch?v=Xq9YfQV8C-o&t=105s)) | сделано | Агент предлагает профиль `workspace_action settings.propose` (только разрешённые ключи), применяет человек: «Настройки → Внешний вид → Профиль настроек» (`src/components/settings/view/tabs/profile/SettingsProfileSection.tsx`, `server/modules/settings-profile/`) |
| 02 | Защита ключей и опасных команд (02:04) | уже было | Страж секретов в поле ввода (`modSecretGuard`), песочница тиммейтов (`server/shared/user-jail.ts`), страж удаления. В сборке: инспектор получает только имена MCP, без `env`/`headers` (`?fields=names`, исправлено в T10) |
| 03 | Русский интерфейс и простые ответы (02:24) | уже было | Правила Димы и тексты интерфейса |
| 04 | Продолжение с телефона / Remote Control (02:46) | отложено | Neo3 уже веб-приложение. Remote Control Claude не включали (вне рамок). Проверена только телефонная вёрстка 390 px (скриншоты `shots/t02-*-390*.png`) |
| 05 | Не засыпать во время работы (02:50) | сделано (только macOS) | Мод «Не засыпать» (`server/modules/keep-awake/`): пока есть работающие прогоны — `caffeinate -i -w <pid сервера>`; отпускает через 2 мин без работы, предел 3 ч |
| 06 | Уведомления о завершении, вопросе, разрешении (03:00) | уже было | «Ждут тебя», пуши, Telegram (`session-attention`, `notifications`, `telegram`) |
| 07 | Резервная копия настроек и отчёт (03:07) | сделано | Перед применением профиля — снимок, список «ключ: было → стало», «Вернуть как было» (`POST /api/settings-profile/restore`) |
| 08 | Правая панель сессии ([03:32](https://www.youtube.com/watch?v=Xq9YfQV8C-o&t=212s)) | сделано | Рабочий стол → вкладка «Сессия» (`src/components/workbench/inspector/SessionInspector.tsx`): папка, ветка и незакоммиченное, движок/модель/effort, статус, контекст, подключения (имена MCP), результаты, изменения хода |
| 09 | Состав контекста (04:03) | ограничение | Ни Claude SDK, ни `codex exec`, ни Grok CLI не отдают раскладку контекста по категориям — показывается только общая занятость; чего движок не сообщает, то «неизвестно» (`inspectorModel.ts`) |
| 10 | Среда, дополнительные папки, переменные (04:29) | ограничение | Обзор есть (папка, ветка, MCP-имена в инспекторе). Расширение доступа к папкам и правка переменных/секретов из чата — не делали: это защищённые операции, не поля в чате |
| 11 | Разделы проектов/чатов и закрепы ([05:01](https://www.youtube.com/watch?v=Xq9YfQV8C-o&t=301s)) | сделано | Мод «Группы и закрепы»: «Новая группа» в сайдбаре (`src/components/sidebar/groups/`), закреп чата наверху проекта; хранится на сервере (`/api/sidebar-groups`), между устройствами — кадр `sidebar_groups_changed`. Права и файлы не меняются |
| 12 | Управление разделами из диалога (05:20) | сделано | `workspace_action` `group.list/create/rename/add/remove`, `pin.set` в MCP neo3-threads — один набор для трёх движков; удаления групп агентом нет |
| 13 | Вложенные сессии ([06:22](https://www.youtube.com/watch?v=Xq9YfQV8C-o&t=382s)) | уже было + сделано | Треды и эстафета были; добавлено дерево в сайдбаре: дети (тред / перенос / побочный) под родителем, сворачиваются (`src/components/sidebar/utils/sessionTree.ts`, `neo3.sidebar.foldedChats`) |
| 14 | Мастер-сессия ([08:53](https://www.youtube.com/watch?v=Xq9YfQV8C-o&t=533s)) | сделано | Панель диалогов → секция «Мастер-сессия» (`src/components/session-hub/MasterSessionSection.tsx`, `server/modules/master-session/`): все ждущие вопросы доступных проектов, «Подготовить ответы» (черновики Claude, только чтение, без выдуманных фактов — `[ВПИШИ: …]`), экран проверки, «Отправить всё»; устаревший вопрос — «вопрос изменился», повтор пачки не шлёт дважды |
| 15 | Побочный чат /btw ([11:34](https://www.youtube.com/watch?v=Xq9YfQV8C-o&t=694s)) | сделано | `/btw <вопрос>` → новый чат-ребёнок (связь `btw`) в том же движке/модели, вкладка холста; основной прогон не прерывается (`server/modules/session-links/btw.service.ts`, `src/components/workbench/sidechat/`) |
| 16 | Побочный чат по цитате, несколько вкладок (12:26) | сделано | «Спросить в стороне» на выделенном тексте (`AskAsideSelection.tsx`), цитата и короткий контекст — в скрытом `<btw_context>` (срезается для человека); сколько угодно вкладок; закрытие вкладки чат не удаляет |
| 17 | Несколько сессий рядом ([13:11](https://www.youtube.com/watch?v=Xq9YfQV8C-o&t=791s)) | сделано | Вкладка холста «Чат» (`WorkbenchChatPane.tsx`): своя лента, своё поле, свой статус; `chat.send` с явным `sessionId` вкладки |
| 18 | Облачные проекты ([13:50](https://www.youtube.com/watch?v=Xq9YfQV8C-o&t=830s)) | отложено | Нужен перенос движков на VPS и другая модель доступа — не UI-правка (вне рамок) |
| 19 | Артефакты: Design, Docs, Slides, Dashboards ([15:15](https://www.youtube.com/watch?v=Xq9YfQV8C-o&t=915s)) | сделано | Вкладки «Результаты» и артефакт в холсте (`src/components/workbench/artifacts/`, `server/modules/artifacts/`): HTML — в песочнице file-preview, Markdown — отрендерен, PDF/картинки — превью; «Открыть в холсте» у ссылок на файлы в ответе; агент публикует `artifact.publish`; версии со сравнением и восстановлением |
| 20 | Визуальные правки, комментарии на участке, параметры макета (15:52–16:54) | сделано частично / отложено | Сделано: комментарий к области (прямоугольник на HTML/картинке, цитата в тексте) → «Отправить агенту» → новая версия → «учтён/открыт». Отложено: редактор как Figma (перетаскивание элементов, параметры макета) — решение Димы 04.11, отдельный этап |
| 21 | Motion (17:06) | отложено | В ролике нет воспроизводимой демонстрации; генерация видео платная |
| 22 | /skill-doctor ([17:17](https://www.youtube.com/watch?v=Xq9YfQV8C-o&t=1037s)) | сделано | В Neo3 — `/skill-doctor` (админ): дубли, пустые описания, битые ссылки, конфликты; ничего не удаляет (`server/modules/diagnostics/skill-doctor.ts`). В терминале — навык `/skill-audit` (встроенный `/skill-doctor` Claude Code занят) |
| 23 | /doctor (18:00) | сделано | В Neo3 — `/doctor` (админ): движки (версия, вход), MCP и neo3-threads, туннель Ollama, диск, база, служба Neo3; ключи не показываются; починки нет (`doctor.ts`). В терминале — `/setup-doctor` |
| 24 | /advisor (18:22) | сделано | В Neo3 — `/advisor <вопрос>`: один вызов Claude Opus только на чтение с последними сообщениями чата, ответ во вкладке холста; при лимите — отказ с причиной; модель сессии не меняется (`advisor.service.ts`). В терминале — `/second-opinion` |
| 25 | Autopilot (22:35) | уже было | Навык `/autopilot` 2.2.0 установлен; не переустанавливался |

## 3. Ролик Jev: 17 приёмов

Сам Jev (CLI `scripts/visual-qa/qa.py` в штабе, пять пресетов, отчёт JSON/CSV/HTML) построен прошлой
сборкой штаба (`16d0f0d`, `78cd885`). В этой сборке — подключение к движкам и Neo3:
отчёт `report.html` из `scripts/visual-qa/` открывается артефактом в холсте (`isJevReportPath`,
`shared/artifacts.ts`), навык `jev` есть у Claude (`~/.claude/skills/jev`), у Codex — ссылкой в
`~/.codex/skills`, у Grok — через совместимость `[compat.claude] skills` (живой запуск Grok не
проверялся). По умолчанию dry-run; платный `--execute` — только по прямой просьбе Димы.

| Таймкод | Приём | Статус | Где / почему |
|---|---|---|---|
| 02:35 | Признаки обложек (лица, текст, логотипы, мимика) | уже было (ручной API-вход) | пресет `thumbnail`; живой платный прогон — отложено (вне рамок: стоит денег) |
| 03:30–04:25 | Таблица конкурентов с просмотрами | отложено | просмотры требуют отдельного источника данных, в картинке их нет |
| 04:10–04:25 | Периодический сбор обложек, недельный обзор | отложено | расписание не включали; платный вызов без просьбы не запускается |
| 04:37 | Товарные правила: промоплашка ≠ watermark ≠ маркировка | уже было (ручной API-вход) | пресет `product` |
| 06:02–07:46 | Presence gate — без выдуманной рамки | уже было | во всех пяти пресетах, локально |
| 06:02–07:46 | Серая зона → очередь «Проверить» | уже было | вкладка «Проверить» отчёта; в Neo3 видна в холсте |
| 06:02–07:46 | Фактические время и стоимость | ограничение | сбор времени и `usage.cost` готов; замеров на живом API нет (платно) |
| 08:04 | Извлечение кадров с таймкодами | уже было | локальный ffmpeg без сети |
| 08:20–09:10 | Глаза открыты, взгляд в камеру, рамка лица | уже было (ручной API-вход) | пресет `frame` |
| 08:20–09:32 | Проверка кадров склеек | ограничение | ручной вход выбранных кадров; автопоиск склеек — отложено |
| 09:00–09:32 | Кандидаты обложки, выбор человеком | уже было | галерея и очередь отчёта; качество требует пилота |
| 09:00–09:32 | Вертикальный кроп 9:16 по лицу | отложено | исходник не меняем; отдельный шаг |
| 09:55 | Mobile defects: CTA, перекрытия, битые картинки | уже было (ручной API-вход) | пресет `mobile` |
| 10:20–10:54 | Цикл исправление → новый скриншот → повтор | ограничение | ручной повтор CLI; связка «комментарий к артефакту → правка агентом → новая версия» сделана в этой сборке и проверена вживую (журнал, сценарий 7) |
| 10:54–12:48 | Проверка кадров эфира, чёрный экран, заставка | уже было (ручной API-вход) | пресет `screen` с отдельным согласием |
| 10:54–12:48 | Живой захват экрана и защита эфира | отложено | отдельная работа; облачная проверка сама передаёт изображение |
| 12:48–13:49 | Калибровка preview-модели, ошибки API | ограничение | обработка отказов готова; пилот 30–50 своих примеров — платно, по просьбе |

## 4. Матрица «функция × движок»

«Живой» — прогон настоящего движка на изолированном сервере T10 (порт 3197, временные HOME и
база, сборка worktree); подробности и цифры — `t10-e2e.md`. Тесты входят в `npm test`.

| Функция | Claude | Codex | Grok | Доказательство |
|---|---|---|---|---|
| Рабочий стол, вкладки, раскладка | ✓ | ✓ | ✓ | от движка не зависит: `src/components/workbench/workbenchStore.test.ts`, `server/modules/database/tests/ui-preferences-workbench.test.ts`; живой: `workbenchLayout` сохраняется в настройках аккаунта |
| Инспектор сессии | ✓ | ✓ | ✓ (часть полей «неизвестно») | `src/components/workbench/inspector/inspectorModel.test.ts`, `server/modules/providers/tests/mcp-server-names.test.ts`; живой: `?fields=names` отдаёт только имена, значения `env`/`headers` не уходят |
| Контекст и лимиты | ✓ 5ч + неделя | ✓ окна Codex | ограничение — «не сообщает» | `src/utils/providerLimits.test.ts`; живой: `/api/usage/limits` (Claude 5ч/7д, Codex недельное окно) |
| Светлая тема «Светлая Claude» | ✓ | ✓ | ✓ | `src/contexts/theme-registry.test.ts`, `src/components/shell/constants/terminalTheme.test.ts`, `electron/windowTheme.test.js`; скриншоты T02 (1440/390) и T10 (`t10-light-1440-home.png`, `t10-claude-answer-1440.png`) |
| «Думал N с · ответ за N с» | ✓ живой 3,0 с | ограничение: `codex exec` не прислал reasoning → только «ответ за» | ✓ живой 4,4 с | `server/modules/websocket/tests/chat-run-thinking-time.test.ts` (3 фикстуры), `server/modules/database/tests/run-durations-thinking.test.ts`, `src/components/chat/utils/completionDuration.test.ts`; живой — кадр `complete` и `run_durations.thinking_ms`, после перезагрузки в истории |
| «Фон: N» | ✓ живой | ✓ живой | ✓ живой | `server/claude-sdk-background-tasks.test.js`, `server/modules/providers/tests/codex-background-tasks.test.ts`, `server/codex-background-run.test.js`, `server/modules/providers/tests/grok-background-tasks.test.ts`, `server/grok-background-run.test.js` |
| «Стоп» фоновой задачи | ✓ живой `{ok:true}` | ✓ живой `{ok:true}`, когда процесс найден | ✓ живой `{ok:true}`, когда процесс найден | `server/shared/tests/process-tree.test.ts`, `server/modules/websocket/tests/chat-background-codex.test.ts`, `src/components/chat/view/subcomponents/BackgroundTasksStore.test.ts` |
| /btw и «Спросить в стороне» | ✓ живой (и при работающем родителе) | ✓ живой | ✓ живой | `server/modules/session-links/tests/btw.test.ts`, `server/routes/tests/commands.test.js`, `src/components/workbench/sidechat/sideChatModel.test.ts` |
| Второй чат рядом | ✓ | ✓ | ✓ | `sideChatModel.test.ts` (`chatSendFrame` с явным `sessionId`); живой: отправка в существующие сессии трёх движков по `sessionId` доходит только в свою сессию. Сама панель в браузере не проверена (см. ограничения) |
| Дерево вложенных сессий | ✓ | ✓ | ✓ | `src/components/sidebar/utils/sessionTree.test.ts`; живой: `links.children/parent` у сессий трёх движков в `/api/projects` |
| Артефакты: просмотр, версии, восстановление | ✓ | ✓ | ✓ | `server/modules/artifacts/tests/artifacts.service.test.ts`, `artifacts.routes.test.ts`, `src/components/workbench/artifacts/artifactModel.test.ts`; живой: публикация, путь с `..` — отказ, версии publish/change/restore |
| Комментарий к участку → правка агентом | ✓ живой (HTML, область) | ✓ живой (HTML, область) | ✓ живой (Markdown, цитата) | живой: агент правит файл, `refresh` даёт новую версию; комментарий `sent` → `resolved` |
| Агент публикует артефакт, ведёт группы (`workspace_action`) | ✓ | ✓ | ✓ | `server/modules/threads/tests/threads-mcp.test.ts`, `server/modules/agent-workspace/tests/tools.test.ts`; живьём не проверялось — в изоляции `NEO3_THREADS_MCP` не ставится (запрет задания) |
| Панель диалогов | ✓ | ✓ | ✓ | `src/components/session-hub/sessionHubModel.test.ts`; живой: `/api/attention` показывает сессии трёх движков по состояниям |
| Мастер-сессия | ✓ живой | ✓ живой | ✓ живой | `server/modules/master-session/tests/master-session.service.test.ts`, `master-session.routes.test.ts`, `run-control-wiring.test.ts`, `src/components/session-hub/masterSessionModel.test.ts`; живой: вопросы трёх движков, черновики, `sent`/`stale`, повтор пачки не доставил второй раз |
| Группы и закрепы | ✓ | ✓ | ✓ | `server/modules/sidebar-groups/tests/sidebar-groups.test.ts`, `src/components/sidebar/groups/groupsModel.test.ts`, `groupsStore.test.ts`; живой REST |
| Профиль настроек | ✓ | ✓ | ✓ | `server/modules/settings-profile/tests/settings-profile.test.ts`, `src/components/settings/view/tabs/profile/profileModel.test.ts`; живой: предпросмотр (лишний ключ отброшен), применение, возврат |
| /doctor, /skill-doctor | ✓ | ✓ | ✓ | `server/modules/diagnostics/tests/doctor.test.ts`, `skill-doctor.test.ts`, `diagnostics-routes.test.ts`, `server/routes/tests/commands-diagnostics.test.js`; живой: отчёт видит три движка «вход есть», ключей нет |
| /advisor | ✓ | ✓ | ✓ (отвечает Claude) | `server/modules/diagnostics/tests/advisor.test.ts`, `src/components/workbench/advisor/advisorStore.test.ts`; живой: совет по чату Grok |
| Не засыпать | ✓ | ✓ | ✓ (только macOS) | `server/modules/keep-awake/tests/keep-awake.test.ts`; живой: во время прогона `caffeinate -i -w <pid сервера>` |
| Выключатели модов | ✓ | ✓ | ✓ | `server/shared/tests/mods.test.ts`, `server/shared/tests/mods-engines.test.ts`; живой: выключенные моды дают 409 `MOD_OFF` (/btw, /doctor, артефакты, мастер-сессия, группы) |

Граница Claude как главного движка: каждый живой сценарий шёл сначала на Claude, затем тем же
сценарием на Codex и Grok.

## 5. Пятнадцать прежних модов на Codex и Grok

Полная таблица с тестами — `t04-mods-audit.md` в папке прогона (таск 04). Итог:

| Мод | Codex | Grok | Доказательство (тест / живой) |
|---|---|---|---|
| modAttention «Ждут тебя» | ✓ | ✓ (после рестарта вопрос без кнопок) | `session-attention.test.ts`, `attention-push.test.ts`; живой T10: состояния working/done/waiting у трёх движков |
| modAnswerButtons | ограничение — только «Открыть» и ответ в чате (`codex exec` не принимает ответ; нужен App Server — вне рамок) | ✓ | `attention-push.test.ts`, `chat-permission-response.test.ts` |
| modReplyChips | ✓ | ✓ | `reply-suggestions.test.ts` |
| modSecretGuard | ✓ (CLI-хук — только Claude Code) | ✓ (то же) | клиентский `secretGuard` |
| modMemoryNotes | ✓ | ✓ | `memory-suggestions/tests/quiet-session.test.ts` |
| modCodeStatus | ✓ | ✓ | `code-status` тесты; живой T10: «Всё в master» |
| modRelay | ✓ | ✓ | `auto-relay.service.test.ts`, `server/grok-relay-note.test.js` |
| modBackgroundConsole | исправлено в T04: «Фон» и «Стоп» | исправлено в T04: «Стоп», живой формат потока | см. матрицу выше; живой T10 на трёх движках |
| modThreads | ✓ | ✓ (у тиммейтов нет) | `threads-mcp-registration.test.ts`, `threads.service.test.ts` |
| subagentCrabs | ✓ | ✓ | `codex-subagents.test.ts`, `grok-subagents.test.ts`, `SubagentContainer.test.ts` |
| modScreenshots | ✓ | ✓ | `provider-image-history.test.ts` |
| modCacheTimer | ограничение — TTL кэша не публикуется | ограничение | `src/utils/promptCache.ts` (только `claude`) |
| modKrabikAgent | частично — подготовлен | нет — агент Крабика Claude/Codex | `krabik/tests/krabik-codex.test.ts` |
| modDuet | ✓ (анализ без инструментов) | нет | `agent-run/tests/codex-read-only.test.ts` |
| modImprovementIdeas | ✓ | ✓ | `improvement-ideas/tests/gateway.test.ts`, `service.test.ts` |

Страж циклов `neo3-guards` и таймер кэша у Codex/Grok — вне рамок (механизм плагинов есть только
в Claude SDK). Описание мода «Пульт фона» поправлено в T10: «Фон: N» теперь есть и у Codex.

## 6. Что проверено не вживую

- Браузерные сценарии после смены правила (04.11: браузер только Safari, Playwright запрещён):
  управлять Safari из этого исполнителя нечем, поэтому визуально проверены только экраны,
  снятые до смены правила (T02 и три снимка T10). Остальное — API изолированного сервера и тесты.
- `workspace_action` агентом — только тестами (в изоляции MCP neo3-threads не регистрируется).
- Платный Jev, Motion, облако, Remote Control — вне рамок.
