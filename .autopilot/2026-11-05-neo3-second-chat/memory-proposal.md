## Второй чат справа на холсте (05.11, ветка `feat/neo3-second-chat`, выкачен только клиент)

- Вкладка «Второй чат»/«Побочный чат» рендерит второй настоящий `ChatInterface` с пропом `embedded` (`{hostSessionId, onRetarget, isVisible}`, тип `ChatEmbedding` в `src/components/chat/types/types.ts`). Без `embedded` поведение прежнее.
- Код: `src/components/workbench/sidechat/` (`WorkbenchChatPane.tsx`, `sideChatModel.ts` — `paneSession`, `registerSideChatTabs.tsx`); чистая логика экземпляров — `src/components/chat/utils/{streamBuffers,chatInstance,menuPosition}.ts`; всё нужное чату вкладка берёт из `chatRuntime` в `WorkbenchRenderContext` (`workbenchTabs.ts`).
- Правило: экземпляр с `embedded` не делает ничего глобального (звуки, `[Done]` в заголовке, `selected-provider`, `useConnectionWatchdog`, `QuickSettingsPanel`, слушание `COMPOSER_DRAFT_EVENT`/`WORKSPACE_CHAT_EVENT`). Это делает только основной чат; новое глобальное в `ChatInterface` сначала проверять по `isEmbedded`.
- Переходы на другой чат из embedded — `embedded.onRetarget(id)` (вкладка заменяется, маршрут не меняется); `/btw` и `/advisor` открывают вкладки на `embedded.hostSessionId`.
- Подводные камни: буфер стрима — `Map` по `sessionId` (`createStreamBuffers`), одна общая строка смешивала ответы двух чатов; `chat_subscribed` берётся, только если экземпляр сам подписывался (`shouldHandleSubscribedAck`).
- Esc решает по последнему `pointerdown` (`createPointerOwner`, `isEscapeForInstance`, корни `data-chat-root="main|embedded"`); черновик — `draftStorageKey(projectId, sessionId)`, ключ основного прежний.
- Материалы «Отправить агенту» (`workspaceHandoffsFor(embedded)`) и общие события композера — только у основного чата; выпадашки композера держит в окне `clampMenuLeft`.
- Вкладки `chat`/`btw` с `keepMounted: true`: `context.closeTab` закрывает СВОЮ вкладку, а `replaceTab(..., {keepActive:true})` в `workbenchStore.ts` не выводит скрытую вкладку вперёд.
- Ветка не влита в `cloudcli-fork`; выкачен был только клиент (rsync собранного в `cloudcli-fork/dist/`), откат — `~/.cloudcli/maintenance/second-chat-release-20261105-0149/ROLLBACK.txt`. Параллельная сборка Safari обязана сначала влить эту ветку, иначе её выкатка сотрёт второй чат.
- Тесты (в `npm test`): `src/components/chat/utils/{streamBuffers,chatInstance,menuPosition}.test.ts`, `src/components/workbench/sidechat/sideChatModel.test.ts`, `src/components/workbench/workbenchStore.test.ts`.

### Правка без автопилота

Мелкий баг или доводка после сборки — обычная сессия, без прогона.

Сначала прочитай:
1. `.autopilot/PROGRESS.md` — что не доделано, известные баги, о чём договорились с пользователем.
2. Что правили после последней сборки — первая строка таблицы в «История git».
3. Только если правка их касается: почему сделано так — `docs/adr/`; что значат слова — `CONTEXT.md`; что именно просили — `manifest.md` в папке сборки (указана в начале `PROGRESS.md`).

После правки: коммит — по правилам из «История git»; строка в «Правки без автопилота» в `PROGRESS.md` (дата — что — почему); починенный пункт из «Не доделано»/«Известные баги» удали; о чём договорились с пользователем — строка в «Договорились», его словами.

### История git

Целиком не читай — бери срез под вопрос:
- после последней сборки: `git log --oneline "$(git log -1 --format=%h --grep='^Autopilot: сборка сдана')"..HEAD -- . ':(exclude).autopilot'`
- ради требования: `git log --oneline --grep="R02"`; история файла: `git log --oneline -10 -- <файл>`
- когда появился код: `git log --oneline -S "<фрагмент>"`; почему строка такая: `git blame -L <с>,<по> <файл>`, затем `git show <sha>`; внутри коммита: `git show --stat <sha>`

Срез длиннее ~30 коммитов — отдай субагенту, возьми выжимку в десять строк. Коммит: заголовок — что, тело — почему, трейлер `--trailer "Requirements: R02"` для правки по требованию. Заголовок `Autopilot: сборка сдана` пишет только автопилот.
