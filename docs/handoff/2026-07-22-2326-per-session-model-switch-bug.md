# Хэндофф: per-сессионный выбор модели/уровня в CloudCLI — остался 1 баг

Доделать привязку модели и уровня размышления (thinking effort) к КАЖДОМУ диалогу
в CloudCLI (веб-морда Claude Code). Фича по сути готова и задеплоена, но остался
третий, последний баг переключения. Нужно его найти и починить.

## СТЕК/КОНТЕКСТ

- Проект: **CloudCLI** — форк Claude Code с веб-интерфейсом.
  Путь: `/Users/dimasik/Antigravity Project/claude agent/cloudcli-fork`
- Прод крутится на ЭТОМ ЖЕ Маке: launchd `com.dimasik.cloudcli`, порт 3001 на
  Tailscale-IP, домен `claude.neo3.ru`. Логи: `~/Library/Logs/cloudcli.{out,err}.log`.
  Боевая БД (sqlite): `~/.cloudcli/auth.db`, таблица `sessions`.
- Стек фронта: React + TS + Vite (`src/`). Бэк: Node + Express + better-sqlite3
  (`server/`). Провайдеры: claude (SDK), cursor, codex, opencode.
- Ветка гита: `dima/fork-customizations`. Последний коммит `589a70b`.
- **Деплой: ТОЛЬКО через `./deploy.sh` из ОТДЕЛЬНОГО терминала (НЕ из сессии
  внутри самого CloudCLI).** Если запустить из CloudCLI-сессии — `launchctl
  kickstart` внутри deploy.sh убьёт свою же сборку на середине (Exit 137). См.
  Obsidian `wiki/entities/agents-web-ui.md`, запись 2026-07-20.

## СУТЬ ФИЧИ (что вообще делаем)

Раньше выбор модели/уровня в композере был ГЛОБАЛЬНЫМ на весь браузер (плоские
localStorage-ключи `claude-model`/`claude-effort`, по одному на провайдера).
Дима хочет: у каждого диалога — своя запомненная модель/уровень. Открыл диалог —
видишь его настройку. Сменил — сохранилось именно ему. Перешёл на другой диалог —
видишь уже его настройку. Новый диалог наследует последний использованный выбор
как дефолт (это как permissionMode уже работает — двухуровневая логика:
«своё у сессии» → «последнее глобальное»).

## ЧТО УЖЕ СДЕЛАНО — НЕ ПЕРЕДЕЛЫВАТЬ (всё в рабочем дереве, НЕ закоммичено, но ЗАДЕПЛОЕНО)

**Бэкенд (хранение per-сессия в БД, не в файле):**
- Колонки `model`/`effort` (nullable) в таблице `sessions`:
  `server/modules/database/schema.ts` + миграция `addColumnToTableIfNotExists`
  в `migrations.ts` (+ ветка пересборки `sessions__new`).
- `server/modules/database/repositories/sessions.db.ts`: в `SessionRow` +
  `SESSION_ROW_COLUMNS` добавлены `model`/`effort`; методы `updateSessionModel`,
  `updateSessionEffort`, хелпер `resolveSessionRowForOverride` (принимает и app
  `session_id`, и provider-native id).
- `server/shared/types.ts`: `model`/`effort` в `ProviderChangeActiveModelInput`
  и `ProviderSessionActiveModelChange` теперь оба опциональны.
- `server/shared/utils.ts`: `readProviderSessionActiveModelChange`/
  `writeProviderSessionActiveModelChange` ПЕРЕПИСАНЫ на `sessionsDb` вместо
  старого JSON-файла `~/.cloudcli/provider-session-active-model-changes.json`.
  Весь файловый кэш-код удалён.
- `server/modules/providers/services/provider-models.service.ts`: добавлен
  `resolveResumeEffort` (зеркало `resolveResumeModel`).
- `server/modules/providers/provider.routes.ts`: роут `active-model` упрощён
  (убрана трансляция id), добавлен зеркальный `active-effort`.
- Резюм провайдеров: `server/claude-sdk.js`, `openai-codex.js`, `opencode-cli.js`
  — рядом с `resolveResumeModel` вызывается `resolveResumeEffort`. **cursor-cli.js
  НЕ трогали** — у cursor effort зашит в id модели.
- `server/modules/projects/services/projects-with-sessions-fetch.service.ts`:
  `mapSessionRowToSummary` + типы прокидывают `model`/`effort` в список сессий.

**Фронтенд:**
- `src/types/app.ts`: `ProjectSession.model`/`.effort`.
- `src/components/chat/hooks/useChatProviderState.ts`:
  - эффект гидратации при смене `selectedSession` (строки ~540-569) — читает
    `model`/`effort` сессии, иначе глобальный дефолт;
  - `sessionOverridesRef` (строка ~155) — локальный кэш только что сделанных
    правок, keyed по sessionId, проверяется ПЕРЕД `selectedSession.model`;
  - `selectProviderEffort` (зеркало `selectProviderModel`), оба пишут в
    `sessionOverridesRef` при успехе.
- `src/components/chat/view/ChatInterface.tsx`: `onSelectEffort` теперь пишет и
  глобально, и per-сессию (как `onSelectModel`).

**Тесты:** `npm test` — 167/167 зелёных (2 новых на resolveResumeModel/Effort,
перевёл с файлового мока на изолированную БД `withIsolatedDatabase`). typecheck 0.

## ДВА БАГА ПО ПУТИ (уже ПОЧИНЕНЫ, для понимания истории)

1. **Устаревшая копия сессии в браузере.** После POST active-model список сессий
   во фронте не рефетчился → возврат в диалог читал старый объект → падал на
   глобальный дефолт. Фикс: `sessionOverridesRef` (см. выше).
2. **`pickStoredOrCurrent` перечитывал localStorage поверх гидратации.** Эта
   функция (`useChatProviderState.ts`, строка ~359) существовала ДО фичи для
   другой задачи (лечить модель, убранную из каталога), и СНАЧАЛА читала
   глобальный localStorage, потом текущее состояние. Гонка в одном рендер-цикле
   затирала гидратацию сессии обратно на глобальное. Фикс: поменял порядок —
   сначала `current` (React state), localStorage только fallback.

## ⛳ ОСТАВШИЙСЯ БАГ (ГЛАВНАЯ ЗАДАЧА НОВОЙ СЕССИИ)

Со слов Димы (проверить в живом UI после понимания кода):
- **Работает:** сменил модель в сессии A → ушёл → ВЕРНУЛСЯ на A → показывает
  правильно A. ✅
- **Глючит:** сменил модель в сессии A → перешёл на ДРУГУЮ сессию B (переход
  «вперёд», не возврат) → композер показывает НЕ реальное состояние B.
- **Хотим:** на какую сессию ни перешёл — всегда видно её РЕАЛЬНОЕ текущее
  состояние; изменил — сохранилось ей; перешёл на другую — видно уже её.

**Гипотеза (проверить, НЕ факт):** при переходе на B эффект гидратации
(`useChatProviderState.ts` ~540-569) срабатывает, но `selectedSession` для B
приходит из УЖЕ ЗАГРУЖЕННОГО списка сессий сайдбара, который мог не содержать
свежих `model`/`effort` B (список грузится страницами и обновляется дельтами
`session_upserted` по WS — а тот upsert модель/эффорт НЕ несёт, см. ниже). Плюс
`sessionOverridesRef` содержит правки, сделанные в ЭТОЙ вкладке, но для B их нет,
если B меняли на другом устройстве/раньше. Итог: для B гидратация может взять
либо пусто→глобальный дефолт, либо застрять.

**Где копать (разведка кода уже сделана — не искать заново):**
- `src/hooks/useProjectsState.ts` — владелец `selectedSession` (useState, стр.
  ~361) и всего списка `projects`/сессий. Функция `upsertSessionIntoProject`
  (стр. ~239) мержит WS-события `session_upserted`. **ВАЖНО:** серверный upsert
  `broadcastCanonicalSessionUpsert` в
  `server/modules/websocket/services/chat-run-registry.service.ts` (стр. ~77-98)
  формирует `session: {id, summary, messageCount, lastActivity}` — БЕЗ
  `model`/`effort`! Значит после любого сообщения в чате WS-дельта может
  «затирать» model/effort в объекте сессии на клиенте (в
  `upsertSessionIntoProject` идёт `{...session, ...normalizedSession}` — новые
  поля перезапишут старые пустыми? проверить: `normalizedSession = {...event.session, id, __provider}` — model/effort там undefined, spread undefined НЕ затрёт, но объект B при ПЕРВОЙ загрузке мог вообще не иметь их). ← ПРОВЕРИТЬ ЭТО ПЕРВЫМ ДЕЛОМ.
- Первичный список сессий: `projects-with-sessions-fetch.service.ts`
  `mapSessionRowToSummary` — УЖЕ прокидывает model/effort (моя правка). Значит
  при полной загрузке страницы B её model/effort ДОЛЖНЫ быть. Проверить, что B
  реально попал в загруженную страницу (список пагинируется по 20).
- Эффект гидратации в `useChatProviderState.ts` зависит от
  `[selectedSession?.id, selectedSession?.model, selectedSession?.effort, provider]`
  — если `selectedSession` для B не содержит model/effort (пришёл из WS-дельты, а
  не из полной загрузки), гидратация возьмёт глобальный дефолт.

**Скорее всего фикс:** либо (а) `broadcastCanonicalSessionUpsert` должен нести
`model`/`effort` (добавить 2 поля в payload сервера + чтобы `upsertSessionIntoProject`
их не терял), либо (б) при переключении на сессию без загруженных model/effort —
подтягивать их точечным GET (есть ли endpoint? сейчас нет — есть только запись
POST active-model/active-effort). Вариант (а) чище и дешевле.

## РАЗВЕДКА КОДА (факты, не искать заново)

- Прямой запрос к боевой БД показал: запись per-сессия РАБОТАЕТ —
  `sqlite3 ~/.cloudcli/auth.db "SELECT session_id,model,effort FROM sessions WHERE model IS NOT NULL"`
  вернул реальные строки (`sonnet[1m]/medium`, `opus[1m]/high` и т.д.). Значит
  баг — чисто на стороне ЧТЕНИЯ/отображения во фронте, бэк пишет верно.
- Композер (кнопки Модель/Уровень): инлайн-дропдауны в
  `src/components/chat/view/subcomponents/ChatComposer.tsx` (модель ~634-694,
  effort ~696-757). Значение приходит пропами `model`/`effort` из ChatInterface.
- Глобальные дефолты (оставить как есть): localStorage `claude-model`/
  `claude-effort` + БД `user_provider_preferences` (per-user, кроссдевайс).
- Локальный e2e БЕЗ трогания прода: scratch-инстанс на своём порту/БД —
  `PORT=3098 SERVER_PORT=3098 HOST=127.0.0.1 DATABASE_PATH=/tmp/xxx/auth.db
  WORKSPACES_ROOT=/tmp/xxx/workspace DISABLE_TERMINAL=1 npx tsx --tsconfig
  server/tsconfig.json server/index.js`. Регистрация: POST /api/auth/register
  {username,password}. Создать сессию: POST /api/providers/sessions
  {provider,projectPath}. Выставить: POST /api/providers/claude/sessions/<id>/active-model
  {model} и /active-effort {effort}. Проверить: GET /api/projects (Bearer token).
  Обязательно `--tsconfig server/tsconfig.json` иначе алиасы `@/` не резолвятся.

## 🔴 ГРАБЛИ / ПОДВОДНЫЕ КАМНИ

- **Рабочее дерево ГРЯЗНОЕ и НЕ только про эту фичу.** `git status` показывает
  ~37 изменённых файлов, из них МНОГО чужого незакоммиченного (мультиюзер/админка:
  `server/routes/auth.js`, `server/middleware/auth.js`,
  `server/modules/database/repositories/users.ts`, `admin.js`,
  `user-project-access.ts`, `chat-websocket.service.ts`; темы/лендинг:
  `theme-bg/*`, `ShaderBackground.tsx`, `landing/`, `settings/*`). **НЕ считать
  весь дифф своей фичей. НЕ коммитить всё скопом. Свои файлы — список в секции
  «Что сделано».**
- Тесты и typecheck БЭКЕНДА зелёные, но саму фичу ловили только на бэке/headless
  — визуальные баги (как этот третий) видны ТОЛЬКО в реальном браузере.
- Sonnet-модель в БД записана как `sonnet[1m]` (с суффиксом контекста) — это
  норма, не баг.

## ЖЁСТКИЕ ОГРАНИЧЕНИЯ

- НЕ деплоить/коммитить/пушить без явного «да» Димы.
- Деплой — только `./deploy.sh` из ОТДЕЛЬНОГО терминала (не из CloudCLI-сессии).
- НЕ трогать боевую БД `~/.cloudcli/auth.db` напрямую (только читать для
  диагностики). Миграция колонок УЖЕ применилась к бою (проверено).
- Токен-бюджет Димы: под-агенты/Workflow — только по явной просьбе. Дефолт —
  Sonnet. Проверять результат headless (curl/scratch-инстанс), видимый браузер
  открывать только по прямой просьбе «покажи глазами».

## ОТ ДИМЫ НУЖНО / ОТКРЫТЫЕ ВОПРОСЫ

- Подтвердить точное проявление бага на B: показывает ГЛОБАЛЬНЫЙ дефолт, или
  ЗАЛИПШЕЕ значение сессии A, или пусто? (это сузит между гипотезами а/б).
- «Да» на деплой после фикса.

## КРИТЕРИЙ ГОТОВНОСТИ

- В живом UI: сменил модель/уровень в A → перешёл на B → B показывает СВОЁ
  реальное (из БД) состояние; сменил в B → перешёл на C → C своё; вернулся на A →
  A своё. Всё держится и БЕЗ F5, и ПОСЛЕ F5.
- typecheck 0, `npm test` зелёный.
- Только после «да» — `./deploy.sh` из отдельного терминала, smoke зелёный.

## ПАМЯТЬ

Полная история фичи и обоих починенных багов уже записана в Obsidian:
`Dimasik` vault → `wiki/entities/agents-web-ui.md` (секции 2026-07-22). Новую
находку по третьему багу — дописать туда же по завершении.
