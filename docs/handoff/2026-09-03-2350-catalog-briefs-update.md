# Handoff: апдейт брифов каталога задач Neo3

Переписать скрытые брифы 10 кнопок пустого чата по образцу скилла лендинга, который Дима принесёт. UI и автоотправку не пересобирать. Готово = бриф «Сайт» уровня того скилла, остальные кнопки того же каркаса, клик по-прежнему сразу шлёт ярлык и задаёт вопросы кнопками.

СТЕК/КОНТЕКСТ: форк Neo3 Agent System, путь `/home/agents/Antigravity Project/claude agent/cloudcli-fork`, ветка `dima/fork-customizations`. Прод: https://claude.neo3.ru (статика `dist/` с диска, юнит `neo3.service`, порт 3001). Лендинг витрины: https://cli.neo3.ru (Vercel, папка `landing/`). Агент этой сессии — Grok 4.6 Build внутри Neo3. Код сессии НЕ закоммичен.

ЧТО УЖЕ СДЕЛАНО — НЕ ПЕРЕДЕЛЫВАТЬ:
- Первый вход: 3 карточки (не чат / проект-сеанс-задача / пишите как человеку) + Claude, Git снят с мастера, Skip всегда. Файлы `src/components/onboarding/` (удалён `GitConfigurationStep.tsx`, добавлен `WelcomeStep.tsx`).
- Replay: Настройки → О программе → «Пройти обучение заново» (`POST /api/user/reset-onboarding`, `restartOnboarding` в AuthContext).
- Каталог 10 кнопок на пустом чате: `FirstTaskHints.tsx`. Клик **сразу отправляет** короткий ярлык («Сайт или лендинг»), служебный бриф агенту в `<catalog_brief>…</catalog_brief>`, в пузыре только ярлык (`visibleUserText` в MessageComponent). Режим «Дотошный» (`interrogate`).
- Дима это видел вживую 2026-09-03 ~16:16: Grok нашёл файлы проекта и задал вопрос кнопками («Что должно случиться после визита?»). Механика работает.
- Деплой фронта живой: бандл `assets/index-BIbLlz6N.js` на https://claude.neo3.ru (200). Рестарт сервиса ради фронта не нужен (`./deploy.sh --no-restart`).
- Починен обрыв чата при деплое: Grok — это `~/.grok/bin/grok --output-format streaming-messages-json`, не Claude `--output-format stream-json`. `deploy.sh` + `scripts/restart-after-reply.sh` ждут конец хода, потом рестарт. Не возвращаться к `sleep 20`.
- Вольт: `wiki/concepts/neo3-first-run-onboarding.md`, `wiki/concepts/neo3-biznes-zadachi-katalog.md`, `wiki/concepts/neo3-deploy-zhdet-otvet.md`.

РАЗВЕДКА КОДА (факты — не искать заново):
- Кнопки: `src/components/chat/view/subcomponents/FirstTaskHints.tsx` — `TASK_IDS`, `pickTask` → `sendToComposer(label, { workMode:'interrogate', autoSend:true, hiddenBrief })`.
- Вставка в пустой чат: `ProviderSelectionEmptyState.tsx` (оба пустых состояния).
- Черновик/автоотправка: `src/utils/composerDraft.ts` (`hiddenBrief`, `autoSend`); слушатель в `useChatComposerState.ts` (50мс → `handleSubmitRef`); `catalogBriefRef` + `wrapCatalogBrief` перед `chat.send`; в `addMessage` уходит только ярлык.
- Обёртка: `src/components/chat/utils/catalogBrief.ts`. Стрип при показе: `MessageComponent.tsx` → `visibleUserText`.
- Режим: `useChatProviderState.ts` слушает `COMPOSER_DRAFT_EVENT` и зовёт `selectWorkMode`. Interrogate на Grok: `ask_user_question`, HARD STOP до ответов (`server/shared/work-mode.ts`). Claude: `AskUserQuestion`.
- Тексты брифов: `src/i18n/locales/ru/chat.json` → `firstTask.briefPreamble` + `firstTask.tasks.<id>.{label,prompt}`. Английский дубль: `en/chat.json`. Онбординг-карточки: `ru/common.json` → `onboarding`.
- 10 id: site, crm, bot, content, competitors, offer, replies, spreadsheet, ads, knowledge.
- Деплой: `./deploy.sh` (гейт typecheck+test+build). Фронт = перезапись `dist/` = сразу прод. Сервер менялся (`reset-onboarding`) — рестарт уже был 15:55. Для правок только брифов/UI: `./deploy.sh --no-restart`. После «restart scheduled» сразу отчёт со ссылкой, без curl.
- Прод-маркер: в бандле строка «сразу пойдут вопросы кнопками». URL https://claude.neo3.ru
- HomeLauncher.tsx в git как `??` — чужая незакоммиченная работа домашнего экрана, не трогать без нужды.

ОСТАВШИЕСЯ ЗАДАЧИ (по приоритету):
1. Дождаться скилла/файла брифа лендинга от Димы. Пока нет — спросить «кинь скилл», не выдумывать второй каркас.
2. Переписать `firstTask.tasks.site.prompt` (+ при необходимости preamble) по образцу того скилла: глубина вопросов, порядок, что считается готовым лендингом. Критерий: клик «Сайт или лендинг» → вопросы кнопками уровня скилла, не пять поверхностных радио.
3. Тем же каркасом (не копипастой лендинга) переписать остальные 9 `prompt` в ru+en chat.json. Каждая кнопка: сначала уточнения кнопками, потом работа, цены/факты не выдумывать.
4. Выкат фронта: `./deploy.sh --no-restart`, проверка https://claude.neo3.ru (200 + новые формулировки в бандле). Ссылку Диме первой строкой.
5. Побочное, не жечь токены: фраза на `landing/install/index.html` ещё не на https://cli.neo3.ru/install (нужен `vercel deploy --prod` из `landing/`). Заметка first-run в вольте врёт «в прод не выкатывалось» — поправить одной строкой.

ГРАБЛИ / ПОДВОДНЫЕ КАМНИ:
- Не класть служебный бриф в поле ввода. Дима это уже видел и назвал хуйнёй. Только `hiddenBrief` + короткий label + `autoSend`.
- Не деплоить с рестартом из этого чата без нужды: рестарт убивает агента. Фронт — `--no-restart`.
- Не считать живые прогоны только по `stream-json` — Grok так не зовут.
- `json.dumps` всего `chat.json` переписывает файл целиком — ок, но не терять соседние ключи.
- HomeLauncher и куча других dirty файлов в дереве — не свой sweep, не «причесать заодно».
- AskUserQuestion / ask_user_question: варианты кнопками, не нумерованный список в чате. В каждом вопросе «сам предложи / не знаю».

ЖЁСТКИЕ ОГРАНИЧЕНИЯ:
- Не коммитить и не пушить без «да».
- Не переписывать онбординг-мастер и не трогать Git в настройках.
- Не запускать полный `/doop` и не плодить 50 кнопок в этой сессии.
- Клиентские проекты не вешать на neo3.ru.
- Секреты не писать.

ОТКРЫТЫЕ ВОПРОСЫ / ОТ ДИМЫ НУЖНО:
- Скилл (или файл) брифа лендинга — он сказал «чуть позже скину», без него не начинать глубокий апдейт текстов.
- После выката — один живой прогон «Сайт или лендинг» и вердикт, не тупые ли вопросы.

КРИТЕРИЙ ГОТОВНОСТИ:
- Скилл Димы разобран, `site.prompt` (и остальные 9) переписаны по его каркасу в ru+en.
- Клик по кнопке: ярлык в пузыре, бриф не в поле, режим Дотошный, вопросы кнопками.
- `./deploy.sh --no-restart` зелёный, https://claude.neo3.ru 200, в бандле новые строки брифа.
- Дима прогнал «Сайт» и не вернул простыню в инпут.
