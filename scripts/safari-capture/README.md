# neo3-safari-capture — «Safari вживую»

Помощник на Swift (ScreenCaptureKit + `CGVirtualDisplay`) для вкладки «Safari» на рабочем столе Neo3:
живая картинка окна Safari, в котором работает агент чата, ~3 кадра в секунду. Только смотреть.

## Правило для агента

1. Страницу открывай **в своём новом окне** через `workspace_action` `safari.show {data:{url:"<адрес>"}}`:
   сервер сам открывает новое окно Safari (`make new document`, окно находится по разнице id, а не по
   `front window`), переносит его на невидимый экран «Neo3 Safari» и показывает Диме справа в Neo3.
   Ответ содержит `windowId`.
2. Следующие страницы — в том же окне: `safari.show {data:{windowId:<id>, url:"<адрес>"}}`.
   Уже открытое своё окно — `safari.show {data:{windowId}}` или `{data:{titleContains}}`.
3. **Не используй `open -a Safari`**: он кладёт страницу вкладкой во фронтальное окно Димы, и на
   невидимый экран уехало бы окно Димы.
4. Safari **не выводи вперёд** (`activate`, `set frontmost`, `NSRunningApplication.activate` — никогда, даже на секунду)
   и **не прячь** окно агента: проба 05.11 показала, что закрытое/спрятанное окно Safari не рисует страницу
   (картинка пустая). Окно живёт на невидимом виртуальном экране, Дима его не видит.
5. Проблема с Safari или разрешением — одна строка Диме, без повторов.

## Сборка

```sh
scripts/safari-capture/build.sh          # пересобирает, только если исходник новее бинаря
scripts/safari-capture/build.sh --force
```

Бинарь — `~/.cloudcli/bin/neo3-safari-capture` (или `NEO3_SAFARI_CAPTURE_BIN`). Путь постоянный:
к нему привязано разрешение macOS. «Запись экрана» выдана `/usr/local/bin/node`; помощник наследует её,
**только будучи дочерним процессом node** (сервер Neo3). Запуск из шелла даст ложное «нет разрешения».

## Протокол

| Команда | stdout | Ошибки (stderr — одна строка JSON, код выхода) |
|---|---|---|
| `list` | `{"permission":true,"windows":[{"windowId","title","onScreen","width","height"}]}` — окна `com.apple.Safari`, слой 0, ≥100×100 | нет разрешения → `{"permission":false,"windows":[]}`, код 3 |
| `stream <id> [--fps 3] [--max-width 1280] [--quality 0.6]` | `[UInt32 BE длина][JPEG]…`; одинаковые кадры не шлёт, но не реже раза в 2 с повторяет последний | `no_permission` 3 · `window_gone` 4 (и во время потока) · `bad_args` 2 · `capture_failed` 1 |
| `display [--width 1920 --height 1200]` | одна строка `{"ready":true,"displayId":N,"bounds":{x,y,width,height}}` | `display_failed` 5 (раскладка не вернулась — экран сразу убран) |
| `place <id> --x X --y Y --width W --height H` | `{"ok":true}` | `window_gone` 4 (Safari не запущен или окна нет) |
| `open <url> [--window N]` | `{"ok":true,"windowId":N}` — без `--window` новое окно агента, с ним — переход в окне N | `bad_args` 2 (не http/https) · `window_gone` 4 · `capture_failed` 1 (Safari не ответил / новое окно не появилось) |

- `stream` и `display` живут до закрытия stdin или SIGTERM → чистый выход 0. Сервер держит stdin открытым,
  поэтому смерть Neo3 сама гасит помощника.
- `display` создаёт экран «Neo3 Safari» 1920×1200, одной сессионной транзакцией (`kCGConfigureForSession`,
  постоянные настройки не трогаются) возвращает прежнюю раскладку и зеркало и ставит экран в правый нижний
  угол главного — касание одной точкой. Создание дёргает раскладку на 3–4 с, поэтому сервер держит один
  экран на всё время работы. Перед снятием экрана помощник прячет Safari (`hide()`, не активация)
  и возвращает окна Safari с невидимого экрана на главный, затем убирает экран.
- `place` — `tell application "Safari" to set bounds of window id …` (только если Safari запущен,
  иначе AppleScript его запустит), затем `unhide()` без активации: Safari остаётся позади текущего окна.
- `open` — AppleScript `make new document` / `set URL of current tab of window id N` с адресом через `argv`
  (не вклеивается в текст скрипта). Safari не выходит вперёд (проверено 05.11: frontmost остался прежним,
  окна Димы не тронуты); спрятанный Safari при этом становится видимым позади текущего окна — как после `place`.
  Safari не запущен → запуск `open -g -j` (в фоне и спрятанным), не `tell` (тот запустил бы его впереди).
- `list` и `stream` берут только окна, где у Safari есть вкладки (AppleScript): окно, закрытое в спрятанном
  Safari, остаётся в ScreenCaptureKit/CGWindowList невидимым и без вкладок (05.11) — его нет в списке,
  а поток такого окна заканчивается `window_gone` (проверка раз в 2 с). AppleScript недоступен → без фильтра.
- Помощник не трогает окна Safari, кроме переданного `windowId` (и при снятии экрана — окон на нём).

## Подводные камни (пробы 05.11)

- Без `NSApplication.shared` + `.prohibited` ScreenCaptureKit падает с `CGS_REQUIRE_INIT`.
- `windowId` ScreenCaptureKit = `id of window` AppleScript = номер окна CGWindowList.
- `CGWindowListCopyWindowInfo(.optionIncludingWindow, id)` для спрятанного Safari возвращает пусто —
  искать окно через `.optionAll`.
- Тест на своём окне: `make new document` в Safari может открыть вкладку во **фронтальном чужом** окне,
  а `front window` спрятанного Safari — вернуть чужое окно. Своё окно определять по разнице списков id
  и по URL своей вкладки, не по `front window`.
