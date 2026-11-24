window.STATE =
{
  "version": 2,
  "slug": "neo3-glass-themes",
  "dir": "2026-11-23-neo3-glass-themes--wip",
  "title": "Neo3 на телефоне: стекло, 6 тем, нижняя панель",
  "mode": "semi",
  "depth": "normal",
  "tier": "T2",
  "briefFile": "2026-11-23-brief.md",
  "memoryFile": "../CLAUDE.md",
  "memoryOwner": "user",
  "skillDir": "/Users/dimasik/.claude/skills/autopilot",
  "baseCommit": "08e23a90",
  "startedAt": "2026-11-23T17:33:24+03:00",
  "updatedAt": "2026-11-24T00:47:55+03:00",
  "finishedAt": null,
  "stages": [
    {
      "id": "preflight",
      "status": "done",
      "startedAt": "2026-11-23T17:33:24+03:00",
      "finishedAt": "2026-11-23T17:34:18+03:00"
    },
    {
      "id": "manifest",
      "status": "done",
      "startedAt": "2026-11-23T17:34:18+03:00",
      "finishedAt": "2026-11-23T17:34:18+03:00"
    },
    {
      "id": "briefing",
      "status": "done",
      "startedAt": "2026-11-23T17:34:18+03:00",
      "finishedAt": "2026-11-23T17:34:19+03:00"
    },
    {
      "id": "spec",
      "status": "done",
      "startedAt": "2026-11-23T17:34:19+03:00",
      "finishedAt": "2026-11-23T17:47:22+03:00"
    },
    {
      "id": "plan",
      "status": "done",
      "startedAt": "2026-11-23T17:47:22+03:00",
      "finishedAt": "2026-11-23T17:47:47+03:00"
    },
    {
      "id": "build",
      "status": "done",
      "startedAt": "2026-11-23T17:47:47+03:00",
      "finishedAt": "2026-11-24T00:33:56+03:00"
    },
    {
      "id": "review",
      "status": "active",
      "startedAt": "2026-11-24T00:33:56+03:00"
    },
    {
      "id": "final",
      "status": "pending"
    }
  ],
  "requirements": {
    "total": 25,
    "done": 25,
    "inTicket": 0,
    "inSpec": 0,
    "placeholder": 0,
    "deferred": 0,
    "dropped": 0
  },
  "tickets": [
    {
      "id": "01",
      "title": "Стенд и разбор экранов телефона",
      "requirements": [
        "R08",
        "R12"
      ],
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "scripts/preview-stand/",
        ".autopilot/2026-11-23-neo3-glass-themes--wip/audit.md"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "done",
      "startedAt": "2026-11-23T18:18:05+03:00",
      "finishedAt": "2026-11-23T18:55:07+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 2361,
        "failed": 7
      },
      "commit": "f71e6916"
    },
    {
      "id": "02",
      "title": "Стекло и шесть тем",
      "requirements": [
        "R15",
        "R16",
        "R17",
        "R18",
        "R09",
        "R11",
        "R19i"
      ],
      "blockedBy": [
        "01"
      ],
      "wave": 2,
      "zone": [
        "src/index.css",
        "src/contexts/",
        "index.html",
        "tailwind.config.js",
        "src/components/branding/",
        "src/utils/themeTweaks.ts",
        "src/utils/themeTweaks.test.ts",
        "src/components/app/AppContent.tsx"
      ],
      "review": "да — фундамент",
      "model": "сильная",
      "status": "done",
      "startedAt": "2026-11-23T18:55:16+03:00",
      "finishedAt": "2026-11-23T20:01:23+03:00",
      "retries": 0,
      "repairs": 1,
      "repairFindings": [
        ".glass-scrim должен и затемнять, и размывать фон за листом"
      ],
      "tests": {
        "passed": 2432,
        "failed": 0
      },
      "commit": "306edb6c"
    },
    {
      "id": "03",
      "title": "Своя тема на устройстве и выбор карточками",
      "requirements": [
        "G01",
        "R21i",
        "G02"
      ],
      "blockedBy": [
        "02"
      ],
      "wave": 3,
      "zone": [
        "src/contexts/ThemeContext.jsx",
        "src/contexts/deviceTheme.js",
        "src/components/settings/view/",
        "src/components/quick-settings-panel/",
        "src/i18n/locales/"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "done",
      "startedAt": "2026-11-23T19:33:32+03:00",
      "finishedAt": "2026-11-23T19:58:07+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 2432,
        "failed": 0
      },
      "commit": "b7aa46cc"
    },
    {
      "id": "04",
      "title": "Нижняя панель, «Домой», шторка и «Инструменты»",
      "requirements": [
        "R01",
        "R02",
        "R03",
        "R04",
        "R05",
        "R06",
        "R07",
        "R20i",
        "G03"
      ],
      "blockedBy": [
        "02",
        "03"
      ],
      "wave": 4,
      "zone": [
        "src/components/bottom-bar/",
        "src/components/tools/",
        "src/components/app/",
        "src/components/home/",
        "src/components/sidebar/",
        "src/components/hub/",
        "src/components/menu-icons/",
        "src/components/settings/view/",
        "src/components/settings/hooks/",
        "src/components/settings/constants/",
        "src/components/settings/types/",
        "src/hooks/useProjectsState.ts",
        "src/i18n/locales/"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "done",
      "startedAt": "2026-11-23T19:58:08+03:00",
      "finishedAt": "2026-11-23T23:16:59+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 2473,
        "failed": 0
      },
      "commit": "da9a3593"
    },
    {
      "id": "05",
      "title": "Чат и панели в стекле, общий проход, DESIGN.md",
      "requirements": [
        "R13",
        "R14",
        "R10",
        "R18",
        "G04"
      ],
      "blockedBy": [
        "02",
        "04"
      ],
      "wave": 5,
      "zone": [
        "src/components/chat/",
        "src/shared/view/ui/",
        "src/components/main-content/",
        "src/components/panels/",
        "src/components/session-hub/",
        "src/components/relay/",
        "src/components/crabs/",
        "src/components/improvement-ideas/",
        "src/components/threads/",
        "src/components/settings/view/SettingsHeader.tsx",
        "src/components/app-icon/",
        "src/index.css",
        "DESIGN.md"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "done",
      "startedAt": "2026-11-23T23:16:59+03:00",
      "finishedAt": "2026-11-24T00:33:55+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 2495,
        "failed": 0
      },
      "commit": "4a9bef67"
    },
    {
      "id": "F1",
      "title": "Ремонт по ревью ветки",
      "requirements": [
        "G01",
        "R13",
        "R08",
        "R03",
        "R16",
        "R18"
      ],
      "blockedBy": [],
      "wave": 6,
      "zone": [
        "src/contexts/",
        "src/components/main-content/view/subcomponents/",
        "src/components/code-status/",
        "scripts/preview-stand/",
        "src/components/panels/",
        "src/index.css",
        "src/components/quick-settings-panel/view/",
        "src/components/settings/view/",
        "src/components/sidebar/view/subcomponents/phoneShellSources.test.ts",
        "DESIGN.md"
      ],
      "review": "да — ремонт ветки",
      "model": "сильная",
      "status": "in-progress",
      "retries": 0,
      "repairs": 0,
      "startedAt": "2026-11-24T00:47:55+03:00"
    }
  ],
  "tests": {
    "passed": 2495,
    "failed": 0
  },
  "debt": {
    "placeholders": [],
    "assumptions": [],
    "emptyEnv": []
  },
  "additions": [],
  "coverage": {
    "found": 5,
    "fixed": 5,
    "deferred": 0,
    "items": []
  },
  "concerns": [
    "база 609f75f8: HomeLauncher.render.test.ts красный до сборки (xterm.css под node) — чинит T02",
    "встроенный браузер не рисует backdrop-filter в снимок — размытие на стенде не проверить глазами",
    "P3: внутренности панели «Расписания» — вне рамок (внутренности экранов-панелей)",
    "Неон: акценты «Мятный», «Синий», «Зелёный» разведены по тону и не совпадают с цветами прежних тем",
    "Оранжевая: под лентой чата и полем ввода добавлена тёмная вуаль 60 % (читаемость над видео)",
    "src/index.css:1441 — .glass-scrim только затемняет, размытия нет (BLOCKING ревью T02, ремонт после T03)",
    "src/index.css:188–194 — производные --glass-ring/-accent-*/-active-*/-radius считаются на :root, во вложенном data-theme остаются от активной темы",
    "index.html:95–103 — запись в localStorage раньше setAttribute: при отказе setItem подменённая тема без data-theme; нет теста с бросающим хранилищем",
    "src/contexts/theme-registry.test.ts:141–147 — regex по форме кода эффекта ThemeContext.jsx",
    "src/contexts/theme-registry.test.ts:639 — запрет подстроки mobile-nav слишком широкий",
    "src/index.css:1948,2168,2414,2579,2873 — хвосты тем на [data-slot='prompt-input'] сильнее .glass-surface (снять в T05)",
    "src/index.css:2813 — Светлая Claude: белый значок на терракоте у .glass-button-primary 3,1:1",
    "src/contexts/ThemeContext.jsx:109 — backgroundFile больше не импортируется",
    "src/contexts/themeMigration.js:71 — Object.hasOwn против ES5-формы в index.html",
    "src/contexts/ThemeContext.jsx:292 — неизвестный id темы из аккаунта ставит ember поверх темы устройства (закрывает T03)",
    "ThemePicker.render.test.ts и SettingsRow.render.test.ts — красное доказательство было по отсутствию модуля / React, а не по поведению",
    "язычок быстрых настроек: зона нажатия 44 px через ::before на экране не проверялась",
    "src/contexts/theme-registry.test.ts:584–632 — тесты стекла не проверяют порядок правил CSS",
    "src/index.css:1344 — сводка классов в шапке раздела называет .glass-scrim только затемнением",
    "шторка: плотность 0,9–0,92 из правил [data-theme] .app-sidebar сильнее .glass-sheet — силуэты значков видны (чинит T05)",
    "нижняя панель остаётся в разметке под настройками и панелями — закрыта слоями z-9999/10000",
    "T04 сверх таска: «Сервер» по ссылке не открывается не-владельцу; в шапке шторки на телефоне убраны поиск и «Домой»",
    "нижняя панель: клавиатура, режим с домашнего экрана и кнопка смены обоев проверены только тестом модели и чтением CSS",
    "второй чат (embedded) на стенде не открывался — вид поля ввода проверен тестом и @container, не глазами",
    "микрофон, настоящие цифры лимитов, полосы над полем ввода, полоса активности на стенде не появляются — вид по коду",
    "кнопки шапки чата и «Назад»: видимый размер 36 px при зоне 44 px (тест PanelModal закрепляет h-9 w-9)",
    "две новые строки интерфейса идут русским defaultValue без ключей i18n (локали были вне зоны T05)",
    "жёсткая палитра: 105 строк в зоне чата вне названных файлов, 525 строк в 97 файлах вне зоны"
  ],
  "blind": null,
  "beats": [
    "2026-11-23T17:33:24+03:00",
    "2026-11-23T17:33:54+03:00",
    "2026-11-23T17:34:18+03:00",
    "2026-11-23T17:34:19+03:00",
    "2026-11-23T17:38:05+03:00",
    "2026-11-23T17:47:22+03:00",
    "2026-11-23T17:47:23+03:00",
    "2026-11-23T17:47:39+03:00",
    "2026-11-23T17:47:47+03:00",
    "2026-11-23T18:17:41+03:00",
    "2026-11-23T18:18:03+03:00",
    "2026-11-23T18:18:05+03:00",
    "2026-11-23T18:55:07+03:00",
    "2026-11-23T18:55:09+03:00",
    "2026-11-23T18:55:11+03:00",
    "2026-11-23T18:55:14+03:00",
    "2026-11-23T18:55:16+03:00",
    "2026-11-23T19:33:32+03:00",
    "2026-11-23T19:33:41+03:00",
    "2026-11-23T19:42:00+03:00",
    "2026-11-23T19:58:07+03:00",
    "2026-11-23T19:58:08+03:00",
    "2026-11-23T20:00:15+03:00",
    "2026-11-23T20:01:23+03:00",
    "2026-11-23T23:16:59+03:00",
    "2026-11-24T00:33:55+03:00",
    "2026-11-24T00:33:56+03:00",
    "2026-11-24T00:47:54+03:00",
    "2026-11-24T00:47:55+03:00"
  ],
  "rev": 49,
  "waiting": null,
  "waits": [],
  "log": [
    {
      "t": "2026-11-23T17:33:24+03:00",
      "k": "init"
    },
    {
      "t": "2026-11-23T17:34:18+03:00",
      "k": "stage",
      "id": "manifest",
      "act": "start"
    },
    {
      "t": "2026-11-23T17:34:18+03:00",
      "k": "stage",
      "id": "briefing",
      "act": "start"
    },
    {
      "t": "2026-11-23T17:34:19+03:00",
      "k": "gate",
      "g": "G1",
      "ok": false,
      "open": 22,
      "total": 22
    },
    {
      "t": "2026-11-23T17:34:19+03:00",
      "k": "stage",
      "id": "spec",
      "act": "start"
    },
    {
      "t": "2026-11-23T17:38:05+03:00",
      "k": "gate",
      "g": "G2",
      "ok": true,
      "found": 5,
      "fixed": 5,
      "deferred": 0
    },
    {
      "t": "2026-11-23T17:47:22+03:00",
      "k": "stage",
      "id": "plan",
      "act": "start"
    },
    {
      "t": "2026-11-23T17:47:23+03:00",
      "k": "tier",
      "v": "T2"
    },
    {
      "t": "2026-11-23T17:47:23+03:00",
      "k": "tickets",
      "n": 5
    },
    {
      "t": "2026-11-23T17:47:23+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-11-23T17:47:47+03:00",
      "k": "stage",
      "id": "build",
      "act": "start"
    },
    {
      "t": "2026-11-23T17:47:47+03:00",
      "k": "ticket",
      "ids": [
        "01"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-23T18:17:41+03:00",
      "k": "tickets",
      "n": 5
    },
    {
      "t": "2026-11-23T18:17:41+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-11-23T18:18:03+03:00",
      "k": "ticket",
      "ids": [
        "01"
      ],
      "act": "reset"
    },
    {
      "t": "2026-11-23T18:18:05+03:00",
      "k": "ticket",
      "ids": [
        "01"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-23T18:55:07+03:00",
      "k": "ticket",
      "ids": [
        "01"
      ],
      "act": "done",
      "tests": {
        "passed": 2361,
        "failed": 7
      }
    },
    {
      "t": "2026-11-23T18:55:09+03:00",
      "k": "tickets",
      "n": 5
    },
    {
      "t": "2026-11-23T18:55:11+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-11-23T18:55:14+03:00",
      "k": "add",
      "key": "concerns",
      "n": 3
    },
    {
      "t": "2026-11-23T18:55:16+03:00",
      "k": "ticket",
      "ids": [
        "02"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-23T19:33:32+03:00",
      "k": "ticket",
      "ids": [
        "02"
      ],
      "act": "review"
    },
    {
      "t": "2026-11-23T19:33:32+03:00",
      "k": "add",
      "key": "concerns",
      "n": 2
    },
    {
      "t": "2026-11-23T19:33:32+03:00",
      "k": "ticket",
      "ids": [
        "03"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-23T19:33:41+03:00",
      "k": "ticket",
      "ids": [
        "02"
      ],
      "act": "done",
      "tests": {
        "passed": 2415,
        "failed": 0
      }
    },
    {
      "t": "2026-11-23T19:33:41+03:00",
      "k": "ticket",
      "ids": [
        "02"
      ],
      "act": "review"
    },
    {
      "t": "2026-11-23T19:42:00+03:00",
      "k": "add",
      "key": "concerns",
      "n": 10
    },
    {
      "t": "2026-11-23T19:58:07+03:00",
      "k": "ticket",
      "ids": [
        "03"
      ],
      "act": "done",
      "tests": {
        "passed": 2432,
        "failed": 0
      }
    },
    {
      "t": "2026-11-23T19:58:07+03:00",
      "k": "add",
      "key": "concerns",
      "n": 2
    },
    {
      "t": "2026-11-23T19:58:07+03:00",
      "k": "ticket",
      "ids": [
        "02"
      ],
      "act": "repair",
      "note": ".glass-scrim должен и затемнять, и размывать фон за листом"
    },
    {
      "t": "2026-11-23T19:58:08+03:00",
      "k": "tickets",
      "n": 5
    },
    {
      "t": "2026-11-23T19:58:08+03:00",
      "k": "ticket",
      "ids": [
        "04"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-23T20:00:15+03:00",
      "k": "ticket",
      "ids": [
        "02"
      ],
      "act": "review"
    },
    {
      "t": "2026-11-23T20:01:23+03:00",
      "k": "ticket",
      "ids": [
        "02"
      ],
      "act": "done",
      "tests": {
        "passed": 2432,
        "failed": 0
      }
    },
    {
      "t": "2026-11-23T20:01:23+03:00",
      "k": "add",
      "key": "concerns",
      "n": 2
    },
    {
      "t": "2026-11-23T23:16:59+03:00",
      "k": "ticket",
      "ids": [
        "04"
      ],
      "act": "done",
      "tests": {
        "passed": 2473,
        "failed": 0
      }
    },
    {
      "t": "2026-11-23T23:16:59+03:00",
      "k": "add",
      "key": "concerns",
      "n": 4
    },
    {
      "t": "2026-11-23T23:16:59+03:00",
      "k": "tickets",
      "n": 5
    },
    {
      "t": "2026-11-23T23:16:59+03:00",
      "k": "ticket",
      "ids": [
        "05"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-24T00:33:55+03:00",
      "k": "ticket",
      "ids": [
        "05"
      ],
      "act": "done",
      "tests": {
        "passed": 2495,
        "failed": 0
      }
    },
    {
      "t": "2026-11-24T00:33:56+03:00",
      "k": "add",
      "key": "concerns",
      "n": 5
    },
    {
      "t": "2026-11-24T00:33:56+03:00",
      "k": "stage",
      "id": "review",
      "act": "start"
    },
    {
      "t": "2026-11-24T00:47:54+03:00",
      "k": "tickets",
      "n": 6
    },
    {
      "t": "2026-11-24T00:47:54+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-11-24T00:47:55+03:00",
      "k": "add",
      "key": "report",
      "n": 9
    },
    {
      "t": "2026-11-24T00:47:55+03:00",
      "k": "ticket",
      "ids": [
        "F1"
      ],
      "act": "start"
    }
  ],
  "reqList": [
    {
      "id": "R01",
      "text": "«использовалась у него строка меню внизу… в принципе, возможно, это имеет смысл сделать»",
      "status": "done"
    },
    {
      "id": "R02",
      "text": "«это будет неудобно, если мы это сделаем под чатом, в который вводится текст»",
      "status": "done"
    },
    {
      "id": "R03",
      "text": "«дизайн достаточно такой приятный был по кнопочкам»",
      "status": "done"
    },
    {
      "id": "R04",
      "text": "«что у меня есть главное и проекты. То есть они либо ярлычками, либо вот в боковом меню»",
      "status": "done"
    },
    {
      "id": "R05",
      "text": "«Максимум, что я нажимаю еще настройки»",
      "status": "done"
    },
    {
      "id": "R06",
      "text": "«Я кроме настроек ничего туда не нажимал. То есть оно по сути бесполезное»",
      "status": "done"
    },
    {
      "id": "R07",
      "text": "«Надо рассмотреть нужды ли эти реально нам вообще пункты. Как их вообще реализовывать. Для чего»",
      "status": "done"
    },
    {
      "id": "R08",
      "text": "«лучше сделай пока без моего айфона, там, на своем тестовом, который ты можешь»",
      "status": "done"
    },
    {
      "id": "R09",
      "text": "«дизайн… у тем практически идентичный, ничем особо не меняется»",
      "status": "done"
    },
    {
      "id": "R10",
      "text": "«полностью пересмотрел всю дизайн-систему… Я имею ввиду сами внешние виды»",
      "status": "done"
    },
    {
      "id": "R11",
      "text": "«сделать из них меньше, но более как бы качественнее»",
      "status": "done"
    },
    {
      "id": "R12",
      "text": "«Оцените дизайн, посмотрите, что-то улучшите»",
      "status": "done"
    },
    {
      "id": "R13",
      "text": "«он меня по основному тревожит только мобильная версия… это очень важно»",
      "status": "done"
    },
    {
      "id": "R14",
      "text": "«установил свой сайт через Safari, отправил домой экран»",
      "status": "done"
    },
    {
      "id": "R15",
      "text": "«стеклянный эффект от Apple… скрин отправлю для примера, как это выглядит, чтобы я хотел видеть»",
      "status": "done"
    },
    {
      "id": "R16",
      "text": "«может быть у нас это не получится встроить»",
      "status": "done"
    },
    {
      "id": "R17",
      "text": "«И это касается бы… всех тем»",
      "status": "done"
    },
    {
      "id": "R18",
      "text": "«исправила как бы недочеты, которые сделал когда-то фокус»",
      "status": "done"
    },
    {
      "id": "G01",
      "text": "«лучше каждому устройству своя тема, остальные настройки одинаковые»",
      "status": "done"
    },
    {
      "id": "R19i",
      "text": "(подразумевается) у кого стояла убранная тема, приложение не ломается",
      "status": "done"
    },
    {
      "id": "R20i",
      "text": "(подразумевается) экраны из «Меню» по-прежнему открываются из уведомлений и ссылок",
      "status": "done"
    },
    {
      "id": "R21i",
      "text": "(подразумевается) тему надо уметь выбрать, видя, чем они отличаются",
      "status": "done"
    },
    {
      "id": "G02",
      "text": "«заходишь в настройки… кнопочка оранжевая, она слишком большая. Она сжимает текст и получается… слишком большой блок вместе с ней»",
      "status": "done"
    },
    {
      "id": "G03",
      "text": "«На втором скриншоте. Что это за прозрачность? Она некрасиво выглядит… на темной теме это выглядит нормально… фон… затемнен»",
      "status": "done"
    },
    {
      "id": "G04",
      "text": "«с этой панельки обычный, можно же тоже сократить до ярлычка одного… чистый значок энергии и проценты отображались. Ну, поджать… как минимум с режимом обычный точно можно это сделать. Уровень размышления тоже давай сделаем как [значок]. А…",
      "status": "done"
    }
  ],
  "gates": {
    "G1": {
      "ok": false,
      "at": "2026-11-23T17:34:19+03:00",
      "open": 22,
      "total": 22
    },
    "G2": {
      "ok": true,
      "at": "2026-11-23T17:38:05+03:00",
      "found": 5,
      "fixed": 5,
      "deferred": 0
    },
    "G3": {
      "ok": true,
      "at": "2026-11-24T00:47:54+03:00",
      "problems": 0
    }
  },
  "result": null,
  "report": [
    "Под открытыми настройками нижняя панель остаётся на странице: клавишей Tab и чтением с экрана можно попасть на её пять кнопок (под экранами-панелями — нельзя)",
    "Кнопка здоровья ботов в шапке видна всем, но у не-владельца теперь молча ничего не делает: экран «Сервер» закрыт ему всеми входами",
    "Если браузер запретит запись в хранилище, подменённая убранная тема до загрузки приложения показывается без оформления",
    "Три строки интерфейса без перевода на английский: «перетащите файлы», «нажмите, чтобы сменить» и название «Системные задачи»",
    "В быстрых настройках на компьютере карточки тем встают в три узкие колонки, названия обрезаются до 3–4 букв",
    "Карточка темы под фокусом с клавиатуры не отличается от обычной",
    "Стенд: если остановить боевой Neo3 и запустить стенд из его папки, команда down удалит его собранный клиент — стенд запускать только из рабочей копии",
    "Осталось мёртвого кода: 8 неиспользуемых функций и веток (список у ревьюера), два теста тем сторожат слишком широко",
    "У развёрнутого поля ввода пропала тень"
  ]
}
