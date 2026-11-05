# neo3-browser — невидимый браузер Neo3

Свой браузер на WebKit (движок Safari) для агентов Neo3. На маке его не видно: нет иконки в Доке,
нет окон на экранах, нет меню, активное приложение не меняется, экраны не трогаются. Картинку
страницы Дима видит только во вкладке «Браузер» на холсте Neo3. Safari не запускается вообще.

## Сборка

```sh
scripts/neo3-browser/build.sh          # пересоберёт, только если main.swift / Info.plist новее бинаря
scripts/neo3-browser/build.sh --force
```

Бинарь — `${NEO3_BROWSER_BIN:-~/.cloudcli/bin/neo3-browser}`. В него вшит `Info.plist`
(`__TEXT,__info_plist`) с bundle id `ru.neo3.browser`, `LSUIElement`, `LSBackgroundOnly`.
По bundle id WebKit хранит входы постоянно: `~/Library/WebKit/ru.neo3.browser/`,
`~/Library/HTTPStorages/ru.neo3.browser*` — cookies и localStorage переживают выгрузку и перезапуск.

## Как устроена невидимость (проба 3)

- `NSApplication.setActivationPolicy(.prohibited)` — фоновый процесс без Дока и меню.
- Каждая страница — окно без рамки 1280×800 на (-20000,-20000), `orderFrontRegardless` (не `activate`).
- SPI `_setWindowOcclusionDetectionEnabled:` = false прямым вызовом IMP (`setValue(forKey:)` бросает).
  Без него страница считается скрытой: не рисует, таймеры 1/с. SPI закрытый — после обновления macOS
  проверить; если пропал, в stderr будет «occlusion SPI is missing», картинка перестанет обновляться.
- Ввод — синтетические `NSEvent` прямо в `WKWebView` (страница видит `isTrusted:true`, фокус мака не уходит).
  Прокрутка — жест колеса began/changed/ended; если WebKit проглотил его (сразу после загрузки), помощник
  прокручивает скриптом ближайший прокручиваемый блок под точкой.
- Кадры — `takeSnapshot` по `DispatchSourceTimer` (App Nap отключён `beginActivity`).
- Окно страницы прибито к (-20000,-20000): любые `setFrame`/`constrainFrameRect` возвращают его туда
  (05.11 запрос геолокации WebKit выдвигал окно на экран).

## Что странице нельзя

- Адреса — только http(s) и about: одна проверка схемы в `decidePolicyFor navigationAction` (ссылки,
  редиректы, скрипты, фреймы, `open`) и в `createWebViewWith` (`window.open`/`target=_blank` открываются
  в той же странице, только http(s)). `file:` не грузится никак — диск странице недоступен.
- Камера и микрофон (`requestMediaCapturePermission` → deny), геолокация (приватный
  `_webView:requestGeolocationPermissionForOrigin:…` → `WKPermissionDecision.deny`; именно deny, а не
  BOOL: 0 — это `.prompt`, и WebKit показывает своё окно), `navigator.share` (убран скриптом до страницы).
  Уведомления, alert/confirm/prompt, печать, выбор файла без делегата WebKit сам гасит молча (проверено 05.11).
  Системных окон macOS нет.

## Протокол: `neo3-browser serve`

Один долгоживущий процесс. stdin — команда JSON на строку, stdout — ответ или событие JSON на строку,
stderr — только диагностика без содержимого (адреса, текст ввода и скрипты не пишутся). Закрытие stdin
или SIGTERM — закрыть страницы, ~0,8 с на запись cookies, выход 0. Сам по таймеру не выходит: выгружает
сервер Neo3 (2 мин без дела, `NEO3_BROWSER_IDLE_MS`).

Команда `{"id":N,"op":"…","page":"<pageId>",…}` → `{"id":N,"ok":true,…}` или
`{"id":N,"ok":false,"error":"<код>","message":"…"}`; коды: `no_page`, `bad_args`, `timeout`, `js_error`,
`navigation_failed`, `no_element`, `snapshot_failed`.

| op | аргументы | ответ |
|---|---|---|
| `open` | `page, url` (http/https/about) | `{url,title}` после загрузки; через 20 с — `{url,title,loading:true}` |
| `close` | `page` | `{pages}` — сколько осталось |
| `list` | — | `{pages:[{page,url,title,loading}]}` |
| `click` | `page` + `x,y` \| `selector` \| `text` | `{x,y,url,title}`; не нашёл — `no_element` |
| `type` | `page, text, selector?` | `{url,title}` (`\n` = Enter) |
| `press` | `page, key` (Enter, Tab, Backspace, Escape, Arrow*, PageUp/Down) | `{url,title}` |
| `scroll` | `page, dy, x?, y?` | `{url,title}` |
| `read` | `page, format: text\|html\|links, selector?, max?` (20000) | `{url,title,content,truncated}` |
| `eval` | `page, js` (промис дожидается) | `{result}` (+`truncated`, обрезка 20000) |
| `wait` | `page, selector?, ms?` (≤30 с) | `{url,title,found?}`; не дождался — `timeout` |
| `snapshot` | `page, maxWidth?, quality?` | `{jpeg:<base64>,width,height}` |
| `watch` / `unwatch` | `page, fps` | события `frame` |
| `input` | `page, kind: click\|move\|down\|up\|scroll\|key\|text, x?,y?,dy?,key?,text?` | `{}` |

События: `{"event":"frame","page","jpeg"}` (одинаковые подряд не шлются, но не реже раза в 2 с),
`{"event":"navigated","page","url","title"}`, `{"event":"closed","page"}`.
Координаты — пиксели страницы 1280×800, начало в левом верхнем углу.
