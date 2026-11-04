# Предложение в `claude agent/CLAUDE.md` — сборка «Рабочий стол + правка артефактов» (04.11.2026)

Файл памяти пользовательский: сборка его не трогала. Ниже — готовые к вставке куски.
Пути от корня сборки (`neo3-workbench-figma/`, ветка `feat/neo3-workbench-figma`); после слияния — от корня форка.

## 1. Что в его тексте стало неверным

- Любая строка вида «редактор артефактов «как Figma» — отдельный этап» устарела: этап сделан (мод `modArtifactEditor`, режим «Правка»). Заменить на указатель на раздел ниже.
- «Артефакты: просмотр + комментарии + версии» — добавилось: правка вручную и «Попросить агента»; источник версии `'edit'` (подпись «Правка вручную»).
- «Переключатель вкладок чата/файлов/терминала/статистики в шапке» (если где-то описан) устарел: при `modWorkbench` их нет, они вкладки холста; `activeTab` принудительно `'chat'`.
- «MCP читает/пишет любой пользователь» неверно: запись MCP и секреты `env`/`headers` — только админу.
- Раздел «Подводные камни» про `npm test`: сейчас 1951 тест, 0 падений (было меньше).

## 2. Вставить: раздел «Рабочий стол и правка артефактов (04.11)»

```markdown
## Рабочий стол, вкладки проекта и правка артефактов (04.11, ветка `feat/neo3-workbench-figma`)

Пути от корня форка. Архитектура и поток данных — `docs/architecture.md`, раздел «Рабочий стол и правка артефактов (04.11.2026)».

- Холст (`modWorkbench`): `src/components/workbench/` — `WorkbenchCanvas.tsx`, `workbenchTabs.ts` (реестр видов), `workbenchStore.ts`, чистая модель `workbenchCanvasModel.ts`. Обычный чат остаётся; рабочий стол переключаемый.
- Вкладки проекта в холсте: `projectTabs.tsx` — `terminal`, `files`, `stats`, `autopilot`, `plugin` (по пункту меню на плагин-вкладку, `listPluginTabs` в `mainContentTabs.ts`), плюс inspector, limits, «Результаты».
- При `modWorkbench` в шапке (`MainContentHeader.tsx`) нет свитчера вкладок и «Т», `resolveActiveTab` держит `activeTab='chat'`; при выкл всё как было.
- `WorkbenchTabKindDef.keepMounted` — вкладка, открытая хоть раз, остаётся смонтированной; `available(ctx)` прячет пункт меню. `workbenchStore.moveDraftTabs(sid)` переносит вкладки черновика в созданную сессию (вызов в `ChatInterface.handleSessionEstablished`).
- Режим «Правка» (мод `modArtifactEditor`, requires `modWorkbench`, 23-й ключ `MOD_KEYS`): `src/components/workbench/artifact-editor/`. Кнопка в `artifacts/ArtifactView.tsx`; только html/slides/svg, только последняя версия.
- Чистая модель правки — `editorModel.ts` (`EditorOp`, `instrumentSource`, `applyOpToDocument`, `inverseOp`, `serializeDocument`, `createOpStack`, `replayOps`), `snap.ts`, `frames.ts`, `editorProtocol.ts`; интерфейс — `ArtifactEditor.tsx`, `PropertiesPanel.tsx`, `SelectionOverlay.tsx`, `SlidesRail.tsx`, `ZoomControls.tsx`, состояние в памяти — `editorStore.ts`.
- Поток: исходник → `DOMParser`-копия с `data-neo3-id` (живёт одну сессию правки) → превью с мостом → операции → `serializeDocument` (без `data-neo3-id`, текст до `<body>` и после `</body>` байт в байт) → `PUT /api/projects/:projectId/artifacts/:id/edit` → новая версия `'edit'`.
- Сервер: `artifactsService.saveEdit` (guard + `isModOn` + kind/расширение `.html/.htm/.svg` + размер ≤ `limits.text` + sha файла == sha версии `baseVersionN` и она последняя + запись по realpath после `isInside`/`isPrivateRealPath`), `editorPreview`; коды `ARTIFACT_EDIT_UNSUPPORTED|TOO_LARGE|CONFLICT|INVALID`; маршруты `PUT /:id/edit`, `POST /:id/editor-preview` в `server/modules/artifacts/artifacts.routes.ts` (тело до 3 МБ).
- 409 `ARTIFACT_EDIT_CONFLICT` (`details.latestVersion`): файл на диске изменил агент — сервер уже записал его правку новой версией; клиент переигрывает свои операции по отпечаткам (`replayOps`, `fingerprintFor`), а не затирает.
- Превью правки: `filePreviewService.createDocumentGrant({root, relPath, html, userId, projectId})` в `server/modules/file-preview/file-preview.service.ts` — грант «копия документа»: `GET /api/file-preview/<token>/<relPath>` отдаёт `html` из памяти, прочие пути с диска; не более 20 таких грантов на процесс (старые вытесняются).
- Мост (`bridge.ts` → `buildBridgeScript(nonce)`, инлайн `<script data-neo3-bridge>` в начале `<head>`; в него вставлен `applyOpToDocument.toString()` — функция без импортов и замыканий). iframe — `sandbox="allow-scripts"` БЕЗ same-origin: origin непрозрачный, поэтому `postMessage(…, '*')`, защита — одноразовый `nonce` + проверка `event.source === iframe.contentWindow`.
- Всё, что пришло из iframe, проходит `validateBridgeMessage(raw, nonce)` (`editorProtocol.ts`) и `acceptBridgeMessage` (`useEditorBridge.ts`); новых типов сообщений без валидатора не добавлять. Скрипты артефакта в превью выполняются, но с родителем говорит только мост.
- Масштаб: iframe получает `scale(zoom)`, рамки выделения = `Rect × zoom` (`zoomModel.ts`, `docRectToScreen`); `Rect` в сообщениях моста всегда в CSS-пикселях документа без масштаба.
- Сдвиг элемента: в HTML — CSS-свойство `translate` (не `transform`, чтобы не затирать авторский transform); в SVG — атрибут `transform`, dx/dy в единицах viewBox (UI пересчитывает `svgUnitsPerPx`). Текст SVG `<text>` на месте не правится — поле в панели свойств.
- «Попросить агента» (`artifact-editor/askAgent/`: `AskAgentButton.tsx`, `AskAgentForm.tsx`, `askAgentModel.ts`, `cropRegion.ts`): сообщение агенту собирает чистый `askAgentModel.ts`; отправка — `sendToComposer(text, {autoSend, hiddenBrief, workMode, images})` (`src/utils/composerDraft.ts`), слушатель `images` — в `useChatComposerState.ts`. Для растровых картинок «Правка» не показывается, только «Попросить агента».
- Свёртка шагов: `toolGrouping.ts` — `ToolGroupItem.isTaskNotifications`, порог `TASK_NOTIFICATION_GROUP_THRESHOLD=2`; метка `toolGroup.steps` = «Шаги помощника: {{count}}» (`ToolGroupContainer.tsx`). Та же форма есть у параллельной сессии в `cloudcli-fork` — при слиянии оставить одну реализацию.
- Мастер-сессия (`server/modules/master-session/`): отправка по проектам только после показа адресатов; повтор отправки не дублирует — ledger `master-send` (`master-session.ledger.ts`, `createWorkspaceMasterSendLedger(store)`, `workspace_records.kind='master-send'`, владелец = пользователь); память остаётся для «в полёте». Права тиммейтов не расширять.
- MCP и навыки — только админу: `requireMcpAdmin(req)` в `server/modules/providers/provider.routes.ts` (запись → 403 `ADMIN_REQUIRED`); не-админу `redactMcpServerSecrets` (`providers/services/mcp.service.ts`) обнуляет значения `env`/`headers`, ключи остаются.
- Сохранение, восстановление, публикация и refresh одного артефакта идут по очереди `serialized(id, …)` в `artifacts.service.ts`; агент пишет файл напрямую, мимо очереди — его правку ловит сверка sha256 файла с версией (`ARTIFACT_EDIT_CONFLICT`), поэтому новые записи в файлы артефактов из Neo3 — только через сервис.

Env/мод: `modArtifactEditor` (карточка «Правка артефактов», requires `modWorkbench`); выкл — кнопки «Правка» нет, `saveEdit`/`editorPreview` → 409 `MOD_OFF`.

Тесты (все в `npm test`): `server/modules/artifacts/tests/`, `server/modules/file-preview/tests/`, `server/modules/master-session/tests/`; клиент — `editorModel.test.ts`, `editorProtocol.test.ts`, `editorStore.test.ts`, `editorUiModel.test.ts`, `frames.test.ts`, `snap.test.ts`, `bridge.test.ts`, `useEditorBridge.test.ts`, `zoomModel.test.ts`, `askAgentModel.test.ts`, `workbenchCanvasModel.test.ts`, `workbenchStore.test.ts`, `artifactDrafts.test.ts`.
- DOM-функции редактора (`instrumentSource`, `applyOpToDocument`, `inverseOp`, `serializeDocument`, `findFrames`, `cssPathFor`, `replayOps`) под node НЕ тестируются: DOM-библиотек в `package.json` нет (`parse5`, `@xmldom` транзитивные — не импортировать). Проверка — самопроверка в браузере: открыть клиент с `?neo3EditorSelfTest=1` (`selftest.ts`, хук в `src/main.jsx`), список PASS/FAIL; на 04.11 в WebKit 12/12.
- Живая проверка без Chrome: WKWebView из маленького Swift-приложения (сборка в `/tmp`, не в репозитории) грузит dist-копию клиента и отдельный сервер; Safari/WebKit — единственный разрешённый браузер. Playwright/Chromium/Edge не запускать.
- Отдельный сервер для проверки: `env -i PATH="$PATH" HOME=<tmp>/home DATABASE_PATH=<tmp>/auth.db SERVER_PORT=3911 HOST=127.0.0.1 NODE_ENV=production TMPDIR=/tmp node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.js` (нужен собранный клиент в `dist/`, собирать в изоляции: `vite build --outDir "$(mktemp -d)"`). Боевой `com.dimasik.neo3-local`, `dist/`, `dist-server/` не трогать.

Подводные камни:
- Форма ошибки API — `{success:false, error:{code, message, details}}` (`apiErrorHandler`, `server/shared/utils.ts`). Клиент читает `body.error.details`, а не `body.details`: так `ARTIFACT_EDIT_CONFLICT` терял `latestVersion` (ремонт `fea10130`). Разбор — `ArtifactsApiError {status, code, details}` в `artifactsApi.ts`.
- Сдвиг — `translate`, не `transform`: иначе правка затирает авторский `transform` и ломает отмену.
- Скрытые `keepMounted`-вкладки — классы `invisible absolute`, НЕ `display:none`/`hidden`: у скрытого xterm размер 2×1 и после показа терминал разъезжается.
- Отмена `remove`/`move` опирается на скрытый стек в документе; после перезагрузки iframe превью пересобирать из разобранной копии, а не из исходной строки.
- `data-neo3-id` нельзя сохранять в файл и нельзя переносить между сессиями правки — при замене исходника ищется по отпечатку (`fingerprintFor`: путь тегов + первые 40 символов текста).
- Мост в sandbox без same-origin: `event.origin` будет `"null"` — проверять `event.source` и `nonce`, а не origin.
- Новые служебные WS-кадры не добавлять в `CHAT_ROW_KINDS`; новый файл в `server/shared/` регистрировать в eslint `boundaries/elements`.
- `npm run lint` красный с базы (~96 ошибок) — линтить только свои файлы: `node_modules/.bin/eslint <файлы>`.
- Коммитить только свои пути (`git commit -- <пути>`), не `git add -A`: рядом работает другая сессия в `cloudcli-fork`.
```

## 3. Вставить, если их ещё нет: подразделы автопилота

В его файле сейчас раздел «Как здесь работает Autopilot» без этих двух подразделов; вставить их в конец этого раздела (тексты из `~/.claude/skills/autopilot/phases/0-memory.md`).

```markdown
### Правка без автопилота

Мелкий баг или доводка после сборки — обычная сессия, без прогона.

Сначала прочитай:
1. `.autopilot/PROGRESS.md` — что не доделано, известные баги, о чём договорились с пользователем.
2. Что правили после последней сборки — первая строка таблицы в «История git».
3. Только если правка их касается: почему сделано так — `docs/adr/`; что значат слова — `CONTEXT.md`;
   что именно просили — `manifest.md` в папке сборки (указана в начале `PROGRESS.md`).

После правки:
- коммит — по правилам из «История git»;
- строка в «Правки без автопилота» в `PROGRESS.md`: дата — что — почему;
- починенный пункт из «Не доделано» или «Известные баги» — удали;
- договорились с пользователем о том, что следующая сборка не должна пересматривать, —
  строка в «Договорились», его словами.

### История git

Целиком не читай — бери срез под вопрос:

| Вопрос | Команда |
|---|---|
| что правили после последней сборки | `git log --oneline "$(git log -1 --format=%h --grep='^Autopilot: сборка сдана')"..HEAD -- . ':(exclude).autopilot'` |
| всё, что делали ради требования | `git log --oneline --grep="R02"` |
| история файла | `git log --oneline -10 -- <файл>` |
| когда появился или исчез код | `git log --oneline -S "<фрагмент>"` |
| почему строка такая | `git blame -L <с>,<по> <файл>`, затем `git show <sha>` |
| что внутри коммита | `git show --stat <sha>` |

Срез длиннее ~30 коммитов — отдай его субагенту и возьми выжимку в десять строк.

Коммит: заголовок — что (`fix: даты в одном формате`), тело — почему, трейлер
`--trailer "Requirements: R02"`, если правка касается требования из `manifest.md`.
Заголовок `Autopilot: сборка сдана` пишет только автопилот — по нему находят последнюю сборку.
```
