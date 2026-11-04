# Границы и правила сборки

Читать первым. Карта кода — `notes.md` (в этой же папке). Пути от корня worktree
`/Users/dimasik/Antigravity Project/claude agent/neo3-workbench-figma`.

## Правила проекта (не нарушать)
Договорились прошлые сборки (дословно из `carried.md`):
- Рабочий стол переключаемый, обычный чат остаётся (ответ 04.11 12:27).
- Артефакты: просмотр + комментарии + версии; редактор как Figma — отдельный этап (это он и есть).
- Мастер-сессия по всем проектам Димы, отправка после показа адресатов; права тиммейтов не расширять.
- Браузер агентов — только Safari; Chrome/Playwright/Chromium не запускать.
- «Планирование + обход», модели/effort по умолчанию, проверка в изоляции, прод не трогать без согласия.
- Тему `claudeLight` Диме НЕ включать. Облачные проекты на VPS и кнопки ответа у Codex — не делать.

Технические:
- Не запускать `npm run build`, не трогать `dist/`, `dist-server/`, не рестартовать `com.dimasik.neo3-local`, не ставить зависимости; новых npm-пакетов не добавлять (`parse5`/`sharp` транзитивные — не импортировать).
- Тесты по одному — только с временными `HOME` и `DATABASE_PATH`.
- Доступ — только `server/shared/project-access.ts` и `requireSessionAccess`; админ — только `isAdminUser`.
- Новые служебные WS-кадры не добавлять в `CHAT_ROW_KINDS`. Новый файл в `server/shared/` — регистрировать в eslint `boundaries/elements`.
- Секреты не выводить ни в UI, ни в логи, ни в отчёты.
- Тексты интерфейса — по-русски, просто. Каждая новая функция — за своим модом.
- Рендер-тесты компонентов под node: в файле компонента `import React`, env — `import.meta.env?.`.
- Коммит только своих путей (`git commit -- <пути>`), никогда `git add -A`. Общие файлы — точечно, без переформатирования.

## Границы, решённые в спецификации

### Б1. Модель правки (чистая, клиент) — `src/components/workbench/artifact-editor/` (владелец: таск 08)
```ts
// editorModel.ts
export type EditorDocKind = 'html' | 'svg';
export type StyleProp = 'color'|'background-color'|'font-family'|'font-size'|'font-weight'
  |'margin-top'|'margin-right'|'margin-bottom'|'margin-left'
  |'padding-top'|'padding-right'|'padding-bottom'|'padding-left'|'fill'|'stroke'|'opacity';
export type EditorOp =
  | { type: 'translate'; id: string; dx: number; dy: number }          // накапливает transform: translate(...)
  | { type: 'reorder'; id: string; beforeId: string | null }           // среди соседей того же родителя; null = в конец
  | { type: 'resize'; id: string; width: number; height: number }       // px
  | { type: 'text'; id: string; text: string }                          // только элементы, где все дети — текст
  | { type: 'style'; id: string; prop: StyleProp; value: string | null } // null = убрать свойство
  | { type: 'hide'; id: string; hidden: boolean }
  | { type: 'remove'; id: string }
  | { type: 'duplicate'; id: string; newId: string }                    // копия сразу после оригинала, потомки получают id `${newId}.${n}`
  | { type: 'layer'; id: string; dir: 'up' | 'down' }                   // на одного соседа
  | { type: 'frameOrder'; ids: string[] };                               // новый порядок кадров-слайдов
export const NEO3_ID_ATTR = 'data-neo3-id';
export function instrumentSource(source: string, kind: EditorDocKind): { doc: Document; count: number };
export function previewHtml(doc: Document, kind: EditorDocKind, bridge: string): string; // копия + мост в начале <head>; svg — во враппере HTML
export function applyOpToDocument(doc: Document, op: EditorOp): boolean; // САМОДОСТАТОЧНАЯ: без импортов и замыканий — её .toString() вставляется в мост
export function inverseOp(doc: Document, op: EditorOp): EditorOp | null; // считать ДО применения
export function serializeDocument(doc: Document, kind: EditorDocKind): string; // без data-neo3-id; doctype сохраняется
export function cssPathFor(doc: Document, id: string): string | null;
export interface OpStack { push(entry: StackEntry): void; undo(): StackEntry | null /* применить entry.inverse */; redo(): StackEntry | null /* применить entry.op */; canUndo: boolean; canRedo: boolean; entries(): StackEntry[]; clear(): void }
export function createOpStack(limit = 200): OpStack;
export interface ElementFingerprint { path: string /* теги+индексы от <body> или корня svg */; textStart: string /* первые 40 символов textContent */ }
export function fingerprintFor(doc: Document, id: string): ElementFingerprint | null; // снимать при записи операции в стек
export interface StackEntry { op: EditorOp; inverse: EditorOp; fp: ElementFingerprint | null }
export function replayOps(doc: Document, entries: StackEntry[]): { applied: number; skipped: number }; // для нового исходника: id ищется по fp
// data-neo3-id живёт одну сессию правки: ставится заново при каждом instrumentSource

// snap.ts
export interface Rect { x: number; y: number; w: number; h: number }
export function snapRect(moving: Rect, others: Rect[], opts: { grid: number; threshold: number; enabled: boolean }): { rect: Rect; guides: { axis: 'x' | 'y'; pos: number }[] };

// frames.ts
export function findFrames(doc: Document): string[]; // ids кадров: первый набор ≥2 из `[data-slide]`, `.slide`, `section` (одного родителя)

// editorProtocol.ts — сообщения моста (валидировать ВСЁ, что пришло из iframe)
export type ParentToBridge = { nonce: string } & (
  | { type: 'apply'; op: EditorOp } | { type: 'select'; ids: string[] } | { type: 'scrollTo'; id: string }
  | { type: 'snapshot'; id: string } | { type: 'editText'; id: string } | { type: 'setZoomHint'; zoom: number });
export type BridgeToParent = { nonce: string } & (
  | { type: 'ready'; width: number; height: number; frames: string[] }
  | { type: 'hover'; id: string | null; rect: Rect | null }
  | { type: 'pick'; id: string | null; shift: boolean }              // id null = элемент без data-neo3-id (скриптовый)
  | { type: 'rects'; items: { id: string; rect: Rect; parentLayout: 'flex-row'|'flex-col'|'grid'|'block'; editableText: boolean }[] }
  | { type: 'siblings'; id: string; items: { id: string; rect: Rect }[] }
  | { type: 'textCommitted'; id: string; text: string } | { type: 'textCancelled'; id: string }
  | { type: 'snapshot'; id: string; dataUrl: string | null }
  | { type: 'scroll'; x: number; y: number });
export function validateBridgeMessage(raw: unknown, nonce: string): BridgeToParent | null;
// bridge.ts
export function buildBridgeScript(nonce: string): string; // инлайн <script data-neo3-bridge>; включает applyOpToDocument.toString()
```
Координаты `Rect` — в CSS-пикселях документа iframe (без масштаба); масштаб применяет родитель.

### Б2. Сервер правки (владелец: таск 07)
- `shared/mods.ts`: ключ `modArtifactEditor` в конец `MOD_KEYS`; карточка `{title:'Правка артефактов', description:…, requires:'modWorkbench', engines:'Claude ✓ · Codex ✓ · Grok ✓'}`; тесты модов обновить (23 ключа).
- `shared/artifacts.ts`/сервис: `ARTIFACT_VERSION_SOURCES` += `'edit'`.
- `artifactsService.saveEdit(userId, projectId, artifactId, {content: string, baseVersionN: number}) → ArtifactDetail` — `guard` + `isModOn(userId,'modArtifactEditor')` (иначе `modOffError`) + kind `html|slides|image(svg)` с расширением `.html/.htm/.svg` (иначе 400 `ARTIFACT_EDIT_UNSUPPORTED`) + размер ≤ `limits.text` (413 `ARTIFACT_EDIT_TOO_LARGE`) + sha256 файла на диске == sha версии `baseVersionN` и `baseVersionN === latestVersion` (иначе 409 `ARTIFACT_EDIT_CONFLICT`, в `details` — `latestVersion`) + запись по realpath, проверенному `isInside` и `isPrivateRealPath` непосредственно перед `writeFile` + `addVersion(..., 'edit')`.
- `artifactsService.editorPreview(userId, projectId, artifactId, {html: string}) → {url: string}` — те же guard/мод/kind/размер; создаёт грант file-preview «копия документа».
- REST (в `artifacts.routes.ts`): `PUT /:id/edit {content, baseVersionN}` → `{success, data: detail}`; `POST /:id/editor-preview {html}` → `{success, data:{url}}`. Тело до 3 МБ — проверить `express.json({limit})` для этих роутов (свой `express.json({limit:'3mb'})` на роуте, если глобальный меньше).
- file-preview: `filePreviewService.createDocumentGrant({root, relPath, html, ttlMs?}) → {token, url}` — `GET /api/file-preview/<token>/<relPath>` отдаёт `html` из памяти (тот же CSP, `text/html; charset=utf-8`), все прочие пути гранта — с диска как обычно. Не более 20 таких грантов на процесс (старые вытесняются).
- Клиент API (`artifactsApi.ts`): `saveEdit(projectId, id, {content, baseVersionN})`, `editorPreview(projectId, id, html) → url`; `versionSourceLabel('edit') = 'Правка вручную'`.

### Б3. Интерфейс правки (владелец: таск 09; 10 и 11 — дополняют)
- `src/components/workbench/artifact-editor/ArtifactEditor.tsx` `({projectId, artifact: detail, sessionId, onSaved(detail), onExit()})` — монтируется из `ArtifactView.tsx` кнопкой «Правка» (видна при `useModEnabled('modArtifactEditor')`, kind html/slides/svg, последняя версия, файл есть). Растровые картинки — режим «Правка» не показывается (10 добавляет «Попросить агента» для них в `ArtifactView`).
- `editorStore.ts`: `getEditorState(artifactId) → {baseVersionN, ops: EditorOp[], redo: EditorOp[], selection: string[], zoom: number, snap: boolean} | null`, `setEditorState(artifactId, state)`, `clearEditorState(artifactId)` — в памяти, переживает смену вкладки (Б6 холста размонтирует неактивную вкладку).
- Слоты для 10 и 11 (их 09 рендерит пустыми, если не переданы): `ArtifactEditor` принимает необязательные `toolbarExtras?: ReactNode`, `leftRail?: ReactNode`; кнопка «Попросить агента» живёт в `askAgent/` (10), рейка кадров и масштаб — `SlidesRail.tsx`, `ZoomControls.tsx` (11). 09 сам реализует масштаб = 1 и прокрутку; 11 добавляет масштабирование через `zoom` в editorStore (оверлей выделения обязан умножать `Rect` на `zoom` с первого дня).
- Отправка с картинкой: `sendToComposer(text, {autoSend?, hiddenBrief?, workMode?, images?: File[]})` (`src/utils/composerDraft.ts`); слушатель в `useChatComposerState.ts` добавляет `images` к вложениям (точечная правка, владелец 10).

### Б4. Вкладки проекта в холсте (владелец: таск 06)
- `workbenchTabs.ts`: union += `'terminal' | 'files' | 'stats' | 'autopilot' | 'plugin'`; `WorkbenchTabKindDef` += `keepMounted?: boolean`, `available?: (ctx) => boolean` (пункт меню скрыт, если false); `WorkbenchRenderContext` += `isActive: boolean`, `onFileOpen?: (filePath: string, diff?: unknown) => void`.
- `WorkbenchCanvas.tsx`: вкладки с `keepMounted`, открытые хотя бы раз, остаются смонтированными (`hidden`) при смене активной; меню «+» и пустой холст — все `inMenu` и `available`.
- Новые виды — `src/components/workbench/projectTabs.tsx` (импорт из `index.ts`): `terminal` (keepMounted; `StandaloneShell` + переключатель agent/plain), `files` (`FileTree` + `onFileOpen`), `stats` (`ProjectStatsPanel`), `autopilot` (`useAutopilotDashboard` внутри; available — есть дашборд), `plugin` (ref = имя; по одному пункту меню на плагин-вкладку — через `listPluginTabs` из того же источника, что `assembleMainTabs`). `inMenu: true` у inspector, limits, artifacts («Результаты»).
- `MainContent.tsx`/`MainContentHeader.tsx`: при `modWorkbench` — свитчера и «Т» нет, `activeTab` принудительно `'chat'`, кнопка холста видна всегда; при выкл — всё как до сборки. Шапка: заголовок `min-w-0 flex-1 truncate`, правая группа `flex-shrink-0`.

### Б5. Мелкие границы
- `workbenchStore.moveDraftTabs(toSessionId: string): void` (03) — переносит вкладки и активную из `draft` в `<sid>`, если у `<sid>` своих вкладок нет; иначе объединяет без дублей; `draft` очищается. Вызов — в `ChatInterface.handleSessionEstablished` (одна строка).
- `artifacts/artifactDrafts.ts` (03): `getCommentDraft(artifactId) → {anchor, text} | null`, `setCommentDraft(artifactId, draft | null)`.
- `useAutoRelay.ts` (03): `shouldFollowMove` считается по прошлому статусу, который хранит **каждый экземпляр** хука (ref), а не по общей Map.
- `inspectorModel.ts` (04): `turnFileChanges(messages: ChatMessage[]) → string[]` — уникальные пути из tool_use с последнего пользовательского сообщения: Claude `Edit|Write|MultiEdit|NotebookEdit` `toolInput.file_path`/`notebook_path`; Codex `FileChanges` (`toolInput.changes[].path` и `toolInput[]` массивом, `moveTo`); Grok — по фикстурам (`search_replace`/`write_file`/`edit_file` и т.п.).
- `master-session` (05): зависимость `ledger?: MasterSendLedger` `{get(key): MasterSendResult | null; put(key, result, at): void; prune(now): void}`; боевая — `createWorkspaceMasterSendLedger(store)` (kind `master-send`, owner = userId); память остаётся для «в полёте».
- MCP (01): `redactMcpServerSecrets<T>(value: T): T` в `providers/services/mcp.service.ts` — значения `env`/`headers` → `''`, ключи остаются; применяется в обеих ветках роута для `!isAdminUser(req.user)`.
- Свёртка шагов (02): `ToolGroupItem.isTaskNotifications?: boolean`, `TASK_NOTIFICATION_GROUP_THRESHOLD = 2` в `toolGrouping.ts`; `ToolGroupContainer` для такой группы — метка `t('toolGroup.steps', {count})` = «Шаги помощника: {{count}}»; en «Assistant steps: {{count}}». Это та же форма, что у параллельной сессии в `cloudcli-fork` — при слиянии конфликт решается в пользу одной реализации.

## Швы для тестов
`createArtifactsService({fs, snapshotRoot, now, isModOn, store})`; `createFilePreviewService(...)` (как в его тестах); чистые функции Б1 без DOM — в node (`npm test`): стек операций, `snapRect`, `validateBridgeMessage`, построитель сообщения агенту, порядок кадров на данных. DOM-функции (`instrumentSource`, `applyOpToDocument`, `inverseOp`, `serializeDocument`, `findFrames`, `cssPathFor`, `replayOps`) в node не тестируются — DOM-библиотек в package.json нет (`@xmldom`, `parse5` — транзитивные, не импортировать). Для них таск 08 делает самопроверку в браузере: `src/components/workbench/artifact-editor/selftest.ts` `runEditorSelfTest(): {name, ok, detail}[]` — вызывается из dev-URL клиента `?neo3EditorSelfTest=1` и рисует список PASS/FAIL; таск 12 открывает её в Safari и снимает экран (`screencapture`); `createMasterSessionService({ledger})`; `createWorkbenchStore({storage})`; `turnFileChanges` на фикстурах.

## Что построили сданные таски
(дописывается после каждого таска)
- **02 (вкладки в холст):** `WorkbenchTabKind` += terminal|files|stats|autopilot|plugin; `WorkbenchTabKindDef` += `keepMounted?`, `available?(WorkbenchMenuContext{autopilotAvailable, terminalDisabled})`; `WorkbenchRenderContext` += `isActive`, `onFileOpen?`; `workbenchCanvasModel.ts`: `buildWorkbenchMenu(kinds, ctx, pluginTabs)`, `markVisitedKeepMounted`, `planCanvasPanes`; `mainContentTabs.ts`: `listPluginTabs(plugins, localize)`, `resolveActiveTab(workbenchOn, tab)`; `WorkbenchCanvas` += `visible?`, `onFileOpen?`; `MainContentHeader` += `workbenchOn?`. Скрытые keepMounted-панели — `invisible absolute` (не display:none, чтобы xterm не получил 2×1).

- **01 (доделки, 812bace5 + ремонт 6ea6436e):** `canMarkAllRead(items)`; `ToolGroupItem.isTaskNotifications?`, `TASK_NOTIFICATION_GROUP_THRESHOLD=2`, i18n `toolGroup.steps`; `getCommentDraft(id)`/`setCommentDraft(id, draft|null)` (`artifacts/artifactDrafts.ts`, уже подключено в `ArtifactView`); `workbenchStore.moveDraftTabs(sid)` (фильтр видов стора знает terminal/files/stats/autopilot/plugin); `createAutoRelayStatusStore()`, `createMoveFollower(store)`; `turnFileChanges(messages)`, `useTurnFileChanges(sessionId, refreshKey)`; `MasterSendLedger`, `createWorkspaceMasterSendLedger(store)`; `redactMcpServerSecrets<T>(v)`; `requireMcpAdmin(req)` — запись MCP только админу (403 `ADMIN_REQUIRED`).

- **03 (основа правки, 06a6f73e):** Б1 как описано, плюс в `EditorOp` служебные обратные `attrs` (вернуть style/transform/width/height), `unremove`, `unmove`; `StackEntry.related?`; `createStackEntry(doc, op)` (снимает inverse и отпечаток), `freshElementId(doc)`, `STYLE_PROPS`; `replayOps` → `{applied, skipped, entries}`; `frames.ts`: `pickFrameSet`, `moveFrame`, `frameCandidates`; `editorProtocol.ts`: `createBridgeNonce()`, `ParentLayout`; `selftest.ts`: `mountEditorSelfTest()` (хук в `src/main.jsx`, `?neo3EditorSelfTest=1`). Сдвиг в HTML — CSS-свойство `translate` (не transform); в SVG — атрибут `transform`, dx/dy в единицах viewBox — UI пересчитывает. Сохранение: текст до `<body>` и после `</body>` байт в байт, пересобирается только содержимое body. Отмена remove/move опирается на скрытый стек в документе: после перезагрузки iframe превью пересобирать из разобранной копии. Текст SVG `<text>` на месте не правится — поле в панели свойств. Сервер: `saveEdit`/`editorPreview`, коды `ARTIFACT_EDIT_UNSUPPORTED|TOO_LARGE|CONFLICT(details.latestVersion)|INVALID`; на 409 сервер уже записал правку агента новой версией. Клиент: `artifactsApi.saveEdit`, `artifactsApi.editorPreview`, `ArtifactsApiError {status, code, details}` (ремонт fea10130: details из `body.error.details`; боевой обработчик ошибок — `apiErrorHandler` в `server/shared/utils.ts`). Самопроверка 12/12 PASS в WebKit.

- **04 (интерфейс правки, 295f1991):** `ArtifactEditor({projectId, artifact, sessionId, onSaved, onExit, toolbarExtras?, leftRail?})` (onSaved и после переигрывания); `editorStore`: `get/set/clearEditorState(artifactId)`, `subscribeEditorState(fn)`, `EditorState` + `session?: {kind, doc, history}` (живой документ в памяти); **для таска 05:** `useArtifactEditor() → ArtifactEditorApi {projectId, artifact, sessionId, kind, doc, revision, selection, frames, zoom, setZoom, apply(ops), select, scrollTo, snapshot(id)}` (`editorContext.ts`); `editorUiModel`: `pickSelection`, `pruneSelection`, `createEditorHistory(200)`, `docRectToScreen`, `screenPointToDoc`, `screenDeltaToDoc`, `unionRect`, `reorderTarget`, `resizeFromHandle`, `svgUnitsPerPx`, `fontFamiliesIn`, `toHexColor`, `readInlineStyle`, `canEditArtifact`, `editorDocKind`; `acceptBridgeMessage(event, frameWindow, nonce)` (`useEditorBridge.ts`); `findEditorElement`, `textOnlyElement` (`editorDom.ts`). Масштаб: iframe `scale(zoom)`, рамки = Rect × zoom. Живая проверка — WKWebView из Swift (сборка в /tmp/neo3-t04): HTML 44/45, SVG 8/8.

## Как работать в репозитории
- Стек: Node 24, React 18 + TS + Tailwind (Vite), Express + better-sqlite3 (TS через tsx/tsc). Зависимости стоят (`node_modules` — ссылка на `cloudcli-fork/node_modules`); новых не ставить.
- **Где строим:** только worktree `/Users/dimasik/Antigravity Project/claude agent/neo3-workbench-figma` (ветка `feat/neo3-workbench-figma`). Основную папку `cloudcli-fork/` не трогать — там работает другая сессия.
- `npm run lint` красный с базы (≈96 ошибок) — линтить только свои файлы: `node_modules/.bin/eslint <файлы>` без новых ошибок.
- **Одна проверка:** `npm run typecheck && TMPDIR="$(node -p 'require("node:fs").realpathSync(require("node:os").tmpdir())')" npm test`. Клиент в изоляции: `node_modules/.bin/vite build --outDir "$(mktemp -d /tmp/neo3-client-check.XXXXXX)"`.
- **Один тест:** `HOME=$(mktemp -d) DATABASE_PATH=$(mktemp -d)/auth.db node_modules/.bin/tsx --tsconfig server/tsconfig.json --test <path>`.
- Общие файлы (правятся точечно, только свои строки): `server/index.js`, `server/shared/types.ts`, `src/types/app.ts`, `eslint.config.js`, `src/i18n/locales/*`, `shared/mods.ts` (07), `ArtifactView.tsx` (03 → 09 → 10 → 11 по очереди), `useChatComposerState.ts` (10).
