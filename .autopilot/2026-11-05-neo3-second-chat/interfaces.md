# Границы и правила проекта

Worktree: `/Users/dimasik/Antigravity Project/claude agent/neo3-second-chat` (ветка `feat/neo3-second-chat`,
база 5ba10b83 = текущий прод). `node_modules` — ссылка на `../cloudcli-fork/node_modules`, ничего не ставить.
Код — только в этом worktree. `cloudcli-fork/` и другие worktree не трогать.

## Правила проекта (из прошлых сборок и CLAUDE.md — не пересматривать)
- Рабочий стол переключаемый, обычный чат остаётся; мод выкл — прежний переключатель вкладок.
- Браузер агентов — только Safari; Chrome/Playwright не использовать.
- Прод и рестарт — только оркестратор с согласия Димы; исполнители НЕ запускают `npm run build`
  (он стирает `dist-server/`), не трогают `dist*`, не рестартят сервис. Клиент проверять
  `node_modules/.bin/vite build --outDir "$(mktemp -d /tmp/neo3-client-check.XXXXXX)"`.
- Права тиммейтов не расширять. Сервер в этой сборке не меняется.
- Тесты: `TMPDIR="$(node -p 'require("node:fs").realpathSync(require("node:os").tmpdir())')" npm test`;
  выборочно — `HOME=$(mktemp -d) DATABASE_PATH=<tmp>/auth.db node_modules/.bin/tsx --tsconfig server/tsconfig.json --test <path>`
  (без временных HOME/DATABASE_PATH тест пишет в боевые базы). `npm run typecheck` — клиент и сервер.
- Рендер-тесты компонентов под node: в файле компонента `import React`, env — `import.meta.env?.`.
- Тексты интерфейса — по-русски, просто.

## Границы, решённые в спецификации

### 1. `ChatInterface` — проп `embedded` (владелец: `src/components/chat/**`)
`ChatInterfaceProps` (`src/components/chat/types/types.ts`) получает `embedded?` (форма — в конце пункта):
`hostSessionId` — сессия холста, на котором живёт вкладка (`/btw`, `/advisor` открывают вкладки там);
`onRetarget(id)` — вместо навигации маршрута перенацелить вкладку на другой чат (эстафета, тред, дочерний).
Нет `embedded` → поведение как сейчас, байт в байт (кроме двух общих фиксов ниже).

С `embedded` экземпляр:
- **Esc**: двойной Esc обрабатывает, только если `event.target` внутри корня этого экземпляра
  (корень помечается `data-chat-root="embedded"`). Основной экземпляр игнорирует Esc, цель которого
  внутри `[data-workbench-canvas]` (атрибут уже есть в `WorkbenchCanvas.tsx`).
- **Черновик**: ключ `draft_input_${projectId}__${sessionId}`; основной — прежний `draft_input_${projectId}`.
  Все места чтения/записи/удаления черновика идут через одну функцию ключа.
- **Не слушает** window-события `COMPOSER_DRAFT_EVENT`, `WORKSPACE_CHAT_EVENT` и событие смены режима
  в `useChatProviderState` (~801-811).
- **Не делает глобального**: звуки уведомления/завершения, маркер `[Done]` в заголовке, запись
  `selected-provider` в localStorage, `useConnectionWatchdog` (полагается на `websocket_reconnected`),
  не рендерит `QuickSettingsPanel`, `SessionHubBar`, `ProviderSelectionEmptyState` (вместо него — строка
  «Загружаю переписку…»/«Здесь пока пусто»), не показывает кросс-движковые модели и «Новый чат».
- `onSessionProcessing/onSessionIdle` зовёт только для СВОЕЙ сессии (они идемпотентны; без них нет индикатора).
- Все переходы на другой чат (`onNavigateToSession` из `handleSessionEstablished`, эстафета, ThreadsBar)
  → `embedded.onRetarget(id)`. Открытие вкладок холста (`/btw`, `/advisor`) → на `embedded.hostSessionId`.
- Закончил ход и видим (`embedded.isVisible`) → помечает свою сессию просмотренной: `attentionStore.markSeen(...)`
  (`src/components/attention/useAttention.ts`) — тот же вызов, что `useAttentionSync` делает для сессии маршрута.

Итого финальная форма (третье поле — видимость вкладки, из `context.isActive`):
```ts
embedded?: { hostSessionId: string | null; onRetarget: (sessionId: string) => void; isVisible: boolean };
```

### 2. Общие фиксы (для всех экземпляров) — `useChatRealtimeHandlers.ts`, `ChatInterface.tsx`
- Буфер стрима и его таймер — `Map<sessionId, {text, timer}>` вместо одной строки: `stream_delta` копит
  в своей сессии, `stream_end`/`complete`/`text` сбрасывают только свою. `resetStreamingState(sessionId?)`.
- `chat_subscribed` обрабатывается, только если `statusCheckSentAtRef.current.has(sid)` (этот экземпляр
  подписывался); иначе игнор.
- Чистая логика вынести так, чтобы тестировалась без React: `createStreamBuffers()` (файл
  `src/components/chat/utils/streamBuffers.ts`) и `shouldHandleSubscribedAck(sentAt: Map, sid)` там же
  или в `useChatRealtimeHandlers` как экспорт. Тесты рядом.

### 3. Холст → вкладка (владелец: `src/components/workbench/**`, `MainContent.tsx`)
`WorkbenchRenderContext` (`workbenchTabs.ts`) получает необязательное поле:
```ts
/** What a chat tab needs to run a real ChatInterface (from MainContent). */
chatRuntime?: {
  processingSessions: Set<string>;   // тип — как у ChatInterfaceProps.processingSessions
  onSessionProcessing: ChatInterfaceProps['onSessionProcessing'];
  onSessionIdle: ChatInterfaceProps['onSessionIdle'];
  onSessionEstablished?: ChatInterfaceProps['onSessionEstablished'];
};
```
MainContent передаёт его в оба монтажа `WorkbenchCanvas` (десктоп и телефон), `WorkbenchCanvas` — в `contextFor`.
`onFileOpen`, `isActive` в контексте уже есть. Настройки UI (`showRawParameters`, `showThinking`,
`sendByCtrlEnter`, `sendByDoubleEnter`) вкладка читает сама через `useUiPreferences()`; `ws/sendMessage` — `useWebSocket()`.

Вкладки `chat` и `btw` регистрируются с `keepMounted: true` (механизм уже есть, `WorkbenchCanvas.tsx:83`).

### 4. Вкладка (владелец: `src/components/workbench/sidechat/**`)
`WorkbenchChatPane` = строка вкладки (название, статус, «Открыть чат целиком») + `ErrorBoundary` с
`<ChatInterface embedded={{hostSessionId: context.sessionId, onRetarget, isVisible: context.isActive}} …/>`.
- `selectedSession` — `useMemo`: сессия из `context.project.sessions` по id, иначе
  `{ id, __provider: engine.provider ?? 'claude', __projectId: project.projectId, summary: tab.title }`.
  `sideChatStore.setEngine` (в `askAside`) дополнительно хранит `provider`.
- `onRetarget(id)` → `context.openTab({kind: tab.kind === 'btw' ? 'btw' : 'chat', ref: id, title})` + `context.closeTab()`.
- `ErrorBoundary` — тот, что в MainContent; падение → «Чат не открылся» + «Открыть чат целиком».
- Удалить из `sideChatModel.ts`: `feedRows`, `chatSendFrame`, черновики/скролл `sideChatStore` (+ их тесты).
  Оставить: `chatPickerChoices`, `sideChatTabFor`, `sideChatStore.getEngine/setEngine`.

### 5. Выпадашки композера — `ChatComposer.tsx`
Позиция fixed-выпадашек: `left = min(rect.left, innerWidth - width - 8)`, не меньше 8. Одна функция
`clampMenuLeft(left, width, viewportWidth)` в `src/components/chat/utils/` + тест.

## Швы для тестов
- `createStreamBuffers`, `shouldHandleSubscribedAck` — чистые функции.
- `draftStorageKey(projectId, sessionId|null)` — чистая функция.
- `isEscapeForInstance(target, root, embedded)` — чистая функция над DOM-узлами (можно на фейковых `contains`/`closest`).
- `clampMenuLeft` — чистая функция.
- `paneSession(sessions, id, engine, project, title)` — чистая функция в `sideChatModel.ts`.

## Что построили таски
(дописывается после каждого таска)

### T01 (готово)
- `ChatInterfaceProps.embedded?: ChatEmbedding {hostSessionId, onRetarget, isVisible}`; `WorkbenchRenderContext.chatRuntime?: WorkbenchChatRuntime` + проп `WorkbenchCanvas.chatRuntime`.
- `src/components/chat/utils/streamBuffers.ts`: `createStreamBuffers({schedule?,cancel?,delayMs?}) → {append, take, reset}`, `shouldHandleSubscribedAck(sentAt, sid)`.
- `src/components/chat/utils/chatInstance.ts`: `draftStorageKey`, `isEscapeForInstance`; `menuPosition.ts`: `clampMenuLeft`.
- `sideChatModel.ts`: `paneSession`, `sameSessionView`; `SideChatEngine.provider`; `openSideChatTab(canvasSessionId|null, created)`.
- Флаги: `useChatProviderState({isEmbedded})`, `useChatComposerState({embedded})`, `useChatRealtimeHandlers({streamBuffers, isEmbedded})`, `useConnectionWatchdog({enabled})`, `ErrorBoundary.renderFallback`, `ChatMessagesPane.isEmbedded/canvasSessionId`.
- `context.closeTab` закрывает свою вкладку, а не активную (иначе скрытый keepMounted-чат закрыл бы чужую).

### F1 (готово)
- `workspaceHandoffsFor(embedded)`; `createPointerOwner()`/`chatPointerOwner`, `CHAT_ROOT_SELECTOR`, корень основного `data-chat-root="main"`; `isEscapeForInstance(target, root, embedded, pointer?)`; `whenPageVisible(doc, onVisible)`.
- `workbenchStore.replaceTab(sid, tabId, input, {keepActive?})`, `WorkbenchRenderContext.replaceTab(tab)`; `retargetTitle`, `settledTabTitle`, `PENDING_CHAT_TITLE`.
