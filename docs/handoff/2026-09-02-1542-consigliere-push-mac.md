Довести канцелярию в Neo3: на маке — свои уведомления и планировщик внутри приложения (не iframe чужого домена); на телефоне проверить, что тап по пушу «чат закончился» открывает этот чат.

СТЕК/КОНТЕКСТ:
- Neo3 Agent: `/home/agents/Antigravity Project/claude agent/cloudcli-fork` (прод VPS, systemd `neo3`, https://claude.neo3.ru). Дима сказал «cloud.neo3.ru» — это claude.neo3.ru.
- Канцелярия (Consigliere): `/home/agents/Antigravity Project/consigliere` — дашборд https://ai.neo3.ru (Vercel `consigliere-dashboard`).
- Мазда: `/home/agents/Antigravity Project/mazda` — https://mazda.neo3.ru (Vercel `mazda-323-restomod`, rootDirectory `dashboard`). Не путать с проектом `mazda` / mazda-virid.vercel.app.
- Телефон: TWA-APK `ru.tarariev.claudecli` (bubblewrap, host claude.neo3.ru). Голый WebView пуши не умеет.
- Мак: Electron .dmg грузит тот же claude.neo3.ru. Чужие origin (ai/mazda) в iframe ломают Basic Auth («Требуется авторизация») и уходят в системный браузер через shell.openExternal.

ЧТО УЖЕ СДЕЛАНО — НЕ ПЕРЕДЕЛЫВАТЬ:
- Схема: не новый хаб-APK на 3 домена. Канал = Neo3. Мазда в пуш не входит. Липкие задачи канцелярии + один пуш «бот умер и не встал». Вольт: `wiki/concepts/neo3-sticky-push.md`.
- Service worker `public/sw.js` v6: close-by-tag, кнопка «Сделал», клик по пушу чата делает WindowClient.navigate на `/session/:id` (раньше только focus+postMessage → оставался текущий экран).
- Оркестратор: коды `consigliere.task` / `bot.dead` / `notification.close`.
- Модуль `server/modules/sticky-push/` (policy, service, routes `/api/sticky-push/sync` и `/done`). Политика `~/.cloudcli/push-policy.json`.
- `vps-alerts.service.ts` дергает syncDeadBots + maybeSyncConsigliere даже если TG-алерты выключены.
- `consigliere/backend/list_sticky_events.py` — stdout только JSON (варнинги в stderr). Было: `events: кривое время` ломало JSON.parse, канцелярия не синкалась.
- Меню Neo3: Канцелярия + Мазда (`SidebarFooter` + `src/components/hub/HubFrame.tsx`).
- Пароли ai.neo3.ru и mazda.neo3.ru заданы в Vercel env (логин `dima`). Значение в переписке; в вольт/хэндофф не писать. Старые пароли из wiki больше не работают.
- На телефоне веб-пуш ассистента (чат закончился) уже работает. Подписок изначально было 0 — Дима включил на телефоне.
- sendEvent в source шлёт и web-push, и desktop. **На проде сервер это ещё не подхватил** (рестарт neo3 из агентского чата убивает чат; Дима не просил рестарт в этой сессии).
- Клик по пушу чата: правка `public/sw.js` + `src/components/app/AppContent.tsx` собрана в `dist/` (бандл index-6m_camBP.js). Телефон надо один раз открыть, чтобы SW обновился до v6.

РАЗВЕДКА КОДА (факты — не искать заново):
- Пуши телефона: VAPID + `push_subscriptions` + `public/sw.js`. Подписка: Настройки → уведомления или кнопка в HubFrame (`useWebPush`). В Electron `window.cloudcliDesktopNotifications` → web-push считается unsupported.
- Мак-пуши приложения: Electron `desktopNotifications.js` → WebSocket `/desktop-notifications` → `sendDesktopNotification`. Включается `desktop.update({enabled:true})` + prefs `channels.desktop`.
- `notifyRunStopped` кладёт `data.sessionId` (app session id после normalizeNotificationSession). Старый SW при живом окне только `focus()` + postMessage; AppContent при пустом sessionId **намеренно не навигирует**, если уже на `/session/*` (защита «idle redirect»).
- Канцелярия события: Google-таблица «zametki» / лист «События». Хелперы: `list_sticky_events.py`, `mark_event_done.py`, логика `sticky_open` в `reminders.py`. Просрочено сейчас было: «Соцзащита», «Сберпрайм отменить».
- maybeSyncConsigliere раз в 10 мин; lastConsigliereSync в памяти процесса — после фейла JSON всё равно ждал 10 мин.
- Состояние пушей: `~/.cloudcli/sticky-push-state.json`. Ботов могли пометить pushed, даже если webPush не ушёл (баг ранней версии sendEvent).
- Деплой Neo3: `./deploy.sh` (typecheck+test+build+restart). `npm test` сейчас красный на 3 stale тестах `server/modules/providers/tests/grok-models.test.ts` (лейблы Grok Fast vs «Быстрый») — к канцелярии не относится, но ломает gate деплоя.
- Рестарт: `sudo /usr/bin/systemctl restart neo3`. Из чата агента — убивает этот чат. Дима рестартит сам с панели «Сервер» или говорит «рестартани».
- Vercel Mazda: деплоить из `/mazda` с `VERCEL_PROJECT_ID=prj_BzLA0iLLZqU7VBumqOtGtAQJuGUb`. cwd=`mazda/dashboard` падает: Root Directory "dashboard" does not exist.

ОСТАВШИЕСЯ ЗАДАЧИ (по приоритету):
1. **Мак: канцелярия внутри Neo3, не в браузере.** Не iframe ai.neo3.ru. Сделать панель «Дела» на claude.neo3.ru: сервер читает события/карты/подписки (уже есть python-хелперы) и отдаёт JSON авторизованным `/api/sticky-push/planner` (или рядом). UI: три списка, галочка «сделал». Критерий: в Electron видно просроченное без окна Basic Auth и без Firefox.
2. **Мак: системные уведомления канцелярии.** После панели — `systemctl restart neo3` (Дима сам), чтобы sendDesktopNotification из sticky-push попал в процесс. В приложении: Канцелярия → «Включить пуши» (уже дергает desktop bridge). Критерий: просроченное событие → баннер мака, клик открывает панель Дела.
3. **Телефон: проверить клик по пушу чата.** Открыть TWA один раз (SW v6). Запустить любой короткий чат, дождаться пуша, тапнуть не из этого чата. Должен открыться закончившийся чат. Если нет — смотреть, что в payload.data.sessionId.
4. **Не открывать mazda/ai через shell.openExternal как основной путь.** Если Дима всё же хочет полный сайт в окне — Electron BrowserView + session `login` на Basic Auth. Пуши с тех доменов всё равно не делать: источник пуша = Neo3.
5. Починить 3 grok-models теста или обойти gate, когда понадобится полный `./deploy.sh`.

ГРАБЛИ / ПОДВОДНЫЕ КАМНИ:
- Рестарт neo3 из агентского чата роняет текущий диалог. Не планировать restart «через 15 секунд» без явного «рестартани».
- Не iframe-ить ai.neo3.ru / mazda.neo3.ru в Electron — Basic Auth не всплывает, текст «Требуется авторизация».
- list_sticky_events: любой print в stdout ломает sync. Только JSON в stdout.
- sendEvent раньше требовал channels.webPush; при 0 подписок ботов всё равно писали в sticky-push-state как отправленных.
- Пароль канцелярии светился в чате — в вольт не дублировать. Логин `dima`.
- `updatePreferences` ЗАМЕНЯЕТ весь JSON; мержить channels, не слать `{desktop:true}` одним полем.

ЖЁСТКИЕ ОГРАНИЧЕНИЯ:
- Не собирать новый Android APK / не трогать keystore / assetlinks.
- Не рестартить neo3 без фразы Димы «рестартани» (или пока он не нажмёт на панели Сервер).
- Не пушить/коммитить без «да».
- Мазда в пуш не входит.
- Не вешать клиентские сайты на neo3.ru сверх уже стоящих личных (ai/mazda — личные, ок).

ОТКРЫТЫЕ ВОПРОСЫ / ОТ ДИМЫ НУЖНО:
- После хэндоффа: открыть телефонный Neo3 один раз и проверить тап по пушу закончившегося чата.
- Когда можно ронять чаты — рестарт neo3, чтобы мак начал получать канцелярские пуши с сервера.
- Нужен ли полный сайт Мазды внутри Electron или хватит ссылки + панель Дела только для канцелярии.

КРИТЕРИЙ ГОТОВНОСТИ:
- Телефон: тап по пушу «чат закончился» открывает этот чат, не текущий.
- Мак приложение: просроченные события канцелярии видны в панели Neo3 без Firefox; системное уведомление мака приходит при закрытом/фоновом приложении; клик открывает эту панель.
- Мазда открывается без 401, пушей не шлёт.
