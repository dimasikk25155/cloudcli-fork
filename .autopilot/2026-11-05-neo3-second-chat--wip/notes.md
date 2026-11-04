# Заметки по коду (worktree `neo3-second-chat`, база 5ba10b83 = прод)

Разбор сделан Explore-агентом при планировании (по `cloudcli-fork`, ветка workbench-video).
Файлы чата в этой базе почти не отличаются (ChatInterface +2 строки, useChatComposerState +11);
MainContent, WorkbenchCanvas, workbenchTabs заметно изменены «Новой вкладкой» — номера строк
там сверять по факту. Все пути — от корня worktree.

## Как устроено сейчас
- Единственный монтаж `ChatInterface` — `src/components/main-content/view/MainContent.tsx` (~стр. 329),
  внутри `WorkbenchLayout`; холст — соседний `WorkbenchCanvas` (десктоп) и оверлей `fixed inset-0` (телефон).
- Пропсы: тип `ChatInterfaceProps` — `src/components/chat/types/types.ts:159`.
  `selectedProject/selectedSession` — из `useProjectsState` (маршрут); `processingSessions`,
  `onSessionProcessing`, `onSessionIdle` — `useSessionProtection()` в AppContent; `onNavigateToSession` —
  `navigate('/session/:id')`; `onSessionEstablished` — `registerOptimisticSession`;
  `showRawParameters/showThinking/sendByCtrlEnter/sendByDoubleEnter` — `useUiPreferences()` в MainContent.
- Холст: `WorkbenchRenderContext` (`src/components/workbench/workbenchTabs.ts`) несёт только
  `sessionId, project, session, openTab, closeTab` (+ что добавила новая вкладка).
  `WorkbenchCanvas.tsx` рендерит только активную вкладку, ключ — id вкладки.
- Вкладки `chat`/`btw` — `src/components/workbench/sidechat/`: `registerSideChatTabs.tsx` → `SideChatTab.tsx`
  (выключатель `modSideChat`, выбор чата) → `WorkbenchChatPane.tsx` (упрощённая лента: `feedRows`, textarea,
  `chatSendFrame`). `sideChatModel.ts`: `chatSendFrame`, `feedRows`, `chatPickerChoices`, `sideChatTabFor`,
  `sideChatStore` (черновики/скролл/движок). `sideChatApi.ts`: `askAside` (POST `/api/sessions/:id/btw`,
  кладёт model/effort/permissionMode в `sideChatStore.setEngine`), `openSideChatTab`.

## Что не мешает второму экземпляру
- `useSessionStore()` (`src/stores/useSessionStore.ts:189`) — Map в useRef на экземпляр.
- Запросы разрешений — на экземпляр, обработчик фильтрует `sid === activeViewSessionId`; `PermissionContext` — на экземпляр.
- `backgroundTasksStore`, step timer — модульные Map по sessionId, дубли записи безвредны.
- Заголовок страницы — один владелец, идемпотентен. Очередь сообщений — «билет» против двойной отправки.
- Поповеры портируются в body, слушатели окна — только пока открыты.

## Что мешает (B1–B9)
- B1 — `ChatInterface.tsx:~83-99` + `useChatRealtimeHandlers.ts:~237-288`: один `accumulatedStreamRef`
  на экземпляр собирает стрим ВСЕХ сессий → тексты двух чатов смешиваются, `complete` одного обрезает другой. Живой баг.
- B2 — `useChatRealtimeHandlers.ts:~120-162`: каждый экземпляр обрабатывает каждый `chat_subscribed`;
  для чужой сессии нет метки времени → `onSessionIdle(sid)` без проверки, гаснет «Стоп» второго чата,
  лишний `refreshFromServer`. Живой баг. Фикс: только если `statusCheckSentAtRef.current.has(sid)`.
- B3 — `useChatRealtimeHandlers.ts:~174,332,360`: звук уведомления/завершения и `[Done]` в заголовке — на каждый экземпляр.
- B4 — `ChatInterface.tsx:~449-492`: двойной Esc — `document` keydown capture → останавливает оба чата.
- B5 — `useChatComposerState.ts:333,1112,1316,1451,1461,1474,1840`: черновик `draft_input_${projectId}` — один на проект.
- B6 — `useChatComposerState.ts:~1482-1505` (`COMPOSER_DRAFT_EVENT` с `autoSend`), `~1448-1455` (`WORKSPACE_CHAT_EVENT`),
  `useChatProviderState.ts:~801-811`: window-события «вставить в композер» ловят оба → двойная отправка.
- B7 — `ChatInterface.tsx:~233` (`onNavigateToSession` из `handleSessionEstablished`), `~593` (переезд/эстафета),
  `~656,862` (ThreadsBar, SessionHubBar), `~797` (`onStartNewChat`) — уводят основной маршрут.
  Кросс-движковые модели — `~568-584`.
- B8 — `useChatSessionState.ts:~513-530`, `useChatComposerState.ts:~1204-1244`: при `selectedSession=null`
  первая отправка создаёт новый чат и навигирует. Объект сессии должен быть мемоизирован (зависимость эффектов).
- B9 — `processingSessions`, `onSessionProcessing/Idle`, `onFileOpen` до холста не доходят.

## Мелочи
- `useChatProviderState.ts:~724` пишет глобальный `selected-provider`; его читают `useChatSessionState.ts:~275,314`, `useProjectsState.ts:~694`.
- `QuickSettingsPanel` — fixed-ручка у края (`ChatInterface.tsx:~887`); `SessionHubBar` — бар всех проектов.
- Каталог моделей перечитывается каждые 60 с на экземпляр (`useChatProviderState.ts:~478-492`); watchdog (`useConnectionWatchdog.ts:~80-98`) может форсить переподключение дважды.
- Отметка «просмотрено» — только для сессии маршрута (`AppContent.tsx:~101`) → у чата справа точка «готово» не гаснет.
- `/btw`, `/advisor` (`useChatComposerState.ts:~486-523`) открывают вкладку на холсте сессии композера — из правого чата не видно.
- `ProviderSelectionEmptyState.tsx:~176-210` пишет глобальные `*-model`, `selected-provider`.
- Выпадашки композера `fixed` от левого края кнопки (`ChatComposer.tsx:~258-268,341-365`) — справа уходят за экран.
- Брейкпоинты `sm:/md:` — по экрану, не по панели (у композера `md:pb-6`).
- Тесты компонентов под node: в файле компонента `import React`, env — `import.meta.env?.`.
