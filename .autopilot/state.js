window.STATE =
{
  "version": 2,
  "slug": "neo3-workbench-figma",
  "dir": "2026-11-04-neo3-workbench-figma--wip",
  "title": "Neo3: доделки рабочего стола и правка артефактов как в Figma",
  "mode": "full",
  "depth": "normal",
  "tier": "T2",
  "briefFile": "2026-11-04-brief.md",
  "memoryFile": "../CLAUDE.md",
  "memoryOwner": "user",
  "skillDir": "/Users/dimasik/.claude/skills/autopilot",
  "baseCommit": null,
  "startedAt": "2026-11-04T17:02:29+03:00",
  "updatedAt": "2026-11-04T17:14:06+03:00",
  "finishedAt": null,
  "stages": [
    {
      "id": "preflight",
      "status": "done",
      "startedAt": "2026-11-04T17:02:29+03:00",
      "finishedAt": "2026-11-04T17:02:56+03:00"
    },
    {
      "id": "manifest",
      "status": "done",
      "startedAt": "2026-11-04T17:02:56+03:00",
      "finishedAt": "2026-11-04T17:03:20+03:00"
    },
    {
      "id": "briefing",
      "status": "skipped",
      "startedAt": "2026-11-04T17:03:20+03:00",
      "finishedAt": "2026-11-04T17:03:32+03:00",
      "note": "полный автомат — самобрифинг"
    },
    {
      "id": "spec",
      "status": "done",
      "startedAt": "2026-11-04T17:03:36+03:00",
      "finishedAt": "2026-11-04T17:14:06+03:00"
    },
    {
      "id": "plan",
      "status": "active",
      "startedAt": "2026-11-04T17:14:06+03:00"
    },
    {
      "id": "build",
      "status": "pending"
    },
    {
      "id": "review",
      "status": "pending"
    },
    {
      "id": "final",
      "status": "pending"
    }
  ],
  "requirements": {
    "total": 36,
    "done": 0,
    "inTicket": 36,
    "inSpec": 0,
    "placeholder": 0,
    "deferred": 0,
    "dropped": 0
  },
  "tickets": [
    {
      "id": "01",
      "title": "Доделки: «Прочитать всё», шаги помощника, баги прошлой сборки",
      "requirements": [
        "R01",
        "R02",
        "R04",
        "R05",
        "R06",
        "R07",
        "R08",
        "R09",
        "R10",
        "R35i"
      ],
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "src/components/session-hub/",
        "src/components/chat/utils/toolGrouping*",
        "src/components/chat/view/subcomponents/ToolGroupContainer.tsx",
        "src/components/workbench/artifacts/ArtifactView.tsx",
        "artifacts/artifactDrafts.ts",
        "src/components/workbench/workbenchStore*",
        "src/components/relay/",
        "src/components/workbench/inspector/",
        "src/components/workbench/useSessionFacts.ts",
        "server/modules/master-session/",
        "server/modules/providers/provider.routes.ts",
        "server/modules/providers/services/mcp.service.ts",
        "docs/video-mods-coverage.md",
        "ChatInterface.tsx",
        "src/i18n/locales/{ru,en}/chat.json"
      ],
      "review": "да — секреты (значения env MCP для тиммейтов)",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "02",
      "title": "Вкладки проекта в рабочий стол, шапка без переключателя",
      "requirements": [
        "R03",
        "R11",
        "R12",
        "R13",
        "R14",
        "R15",
        "R16"
      ],
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "src/components/main-content/",
        "src/components/workbench/workbenchTabs.ts",
        "WorkbenchCanvas.tsx",
        "builtinTabs.tsx",
        "projectTabs.tsx",
        "workbench/index.ts",
        "workbench/artifacts/artifactTabs.tsx",
        "inMenu",
        "src/components/app/AppContent.tsx",
        "activeTab"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "03",
      "title": "Правка артефактов: сервер, мод, модель операций и мост",
      "requirements": [
        "R22",
        "R23",
        "R29",
        "R30",
        "R31",
        "R33"
      ],
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "server/modules/artifacts/",
        "server/modules/file-preview/",
        "shared/mods.ts",
        "shared/artifacts.ts",
        "src/components/workbench/artifacts/artifactsApi.ts",
        "src/components/workbench/artifact-editor/",
        "editorModel.ts",
        "editorProtocol.ts",
        "bridge.ts",
        "snap.ts",
        "frames.ts",
        "selftest.ts"
      ],
      "review": "да — фундамент",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "04",
      "title": "Режим «Правка» в холсте: выделение, операции, сохранение",
      "requirements": [
        "R17",
        "R18",
        "R19",
        "R20",
        "R21",
        "R22",
        "R23",
        "R28",
        "R29",
        "R31"
      ],
      "blockedBy": [
        "01",
        "03"
      ],
      "wave": 2,
      "zone": [
        "src/components/workbench/artifact-editor/",
        "ArtifactEditor.tsx",
        "SelectionOverlay.tsx",
        "PropertiesPanel.tsx",
        "editorStore.ts",
        "useEditorBridge.ts",
        "src/components/workbench/artifacts/ArtifactView.tsx"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "05",
      "title": "«Попросить агента», новая версия от агента, слайды, масштаб",
      "requirements": [
        "R24",
        "R25",
        "R26",
        "R27",
        "R28"
      ],
      "blockedBy": [
        "04"
      ],
      "wave": 3,
      "zone": [
        "src/components/workbench/artifact-editor/",
        "askAgent/",
        "SlidesRail.tsx",
        "ZoomControls.tsx",
        "ArtifactEditor.tsx",
        "src/components/workbench/artifacts/ArtifactView.tsx",
        "src/utils/composerDraft.ts",
        "src/components/chat/hooks/useChatComposerState.ts"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "06",
      "title": "Живая проверка: Safari и три движка",
      "requirements": [
        "R32",
        "R34",
        "R36i"
      ],
      "blockedBy": [
        "02",
        "05"
      ],
      "wave": 4,
      "zone": [
        ".autopilot/2026-11-04-neo3-workbench-figma--wip/e2e.md",
        "/tmp"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    }
  ],
  "tests": null,
  "debt": {
    "placeholders": [],
    "assumptions": [
      "R02 свёртку шагов параллельно делает другая сессия в cloudcli-fork (toolGrouping) — строю в тех же функциях (groupConsecutiveTools/ToolGroupContainer), чтобы при слиянии осталась одна свёртка; если их коммит появится раньше — беру его",
      "Правка артефакта в первом заходе — HTML и SVG; растровые — только комментарии и «попросить агента» (как в плане)",
      "Сохранение правки — новая версия артефакта source:'edit' через artifacts.service, при чужой новой версии — отказ с предложением обновить, без слияния",
      "Перемещение: в flex/grid — порядок соседей, иначе transform translate; размер — width/height inline-style",
      "Прод не выкатываю без согласия — сборка заканчивается веткой и изолированными сборками"
    ],
    "emptyEnv": []
  },
  "additions": [],
  "coverage": {
    "found": 13,
    "fixed": 13,
    "deferred": 0,
    "items": []
  },
  "concerns": [],
  "blind": null,
  "beats": [
    "2026-11-04T17:02:29+03:00",
    "2026-11-04T17:02:56+03:00",
    "2026-11-04T17:03:03+03:00",
    "2026-11-04T17:03:20+03:00",
    "2026-11-04T17:03:32+03:00",
    "2026-11-04T17:03:36+03:00",
    "2026-11-04T17:12:33+03:00",
    "2026-11-04T17:14:06+03:00"
  ],
  "rev": 13,
  "waiting": null,
  "waits": [],
  "log": [
    {
      "t": "2026-11-04T17:02:29+03:00",
      "k": "init"
    },
    {
      "t": "2026-11-04T17:02:56+03:00",
      "k": "stage",
      "id": "manifest",
      "act": "start"
    },
    {
      "t": "2026-11-04T17:03:20+03:00",
      "k": "stage",
      "id": "briefing",
      "act": "start"
    },
    {
      "t": "2026-11-04T17:03:32+03:00",
      "k": "stage",
      "id": "briefing",
      "act": "skip",
      "note": "полный автомат — самобрифинг"
    },
    {
      "t": "2026-11-04T17:03:32+03:00",
      "k": "add",
      "key": "debt.assumptions",
      "n": 5
    },
    {
      "t": "2026-11-04T17:03:36+03:00",
      "k": "gate",
      "g": "G1",
      "ok": false,
      "open": 36,
      "total": 36
    },
    {
      "t": "2026-11-04T17:03:36+03:00",
      "k": "stage",
      "id": "spec",
      "act": "start"
    },
    {
      "t": "2026-11-04T17:12:33+03:00",
      "k": "gate",
      "g": "G2",
      "ok": true,
      "found": 13,
      "fixed": 13,
      "deferred": 0
    },
    {
      "t": "2026-11-04T17:14:06+03:00",
      "k": "stage",
      "id": "plan",
      "act": "start"
    },
    {
      "t": "2026-11-04T17:14:06+03:00",
      "k": "tier",
      "v": "T2"
    },
    {
      "t": "2026-11-04T17:14:06+03:00",
      "k": "tickets",
      "n": 6
    },
    {
      "t": "2026-11-04T17:14:06+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    }
  ],
  "reqList": [
    {
      "id": "R01",
      "text": "«В панели диалогов кнопка «Прочитать всё»»",
      "status": "in-ticket"
    },
    {
      "id": "R02",
      "text": "«Скрыть длинные списки шагов помощников в чате: по умолчанию одна свёрнутая строка «Шаги помощника: N ▸», раскрывается по клику»",
      "status": "in-ticket"
    },
    {
      "id": "R03",
      "text": "«на 390 px вкладки шапки обрезаются и длинный заголовок наезжает на кнопки (шапку на flex)»",
      "status": "in-ticket"
    },
    {
      "id": "R04",
      "text": "«недописанный комментарий к артефакту теряется при смене вкладки»",
      "status": "in-ticket"
    },
    {
      "id": "R05",
      "text": "«вкладки нового чата не переходят в созданную сессию»",
      "status": "in-ticket"
    },
    {
      "id": "R06",
      "text": "«„Перенести“ из карточки лимитов зависит от порядка подписчиков»",
      "status": "in-ticket"
    },
    {
      "id": "R07",
      "text": "«инспектор „Изменения файлов“ показывает все незакоммиченные, а не изменения хода»",
      "status": "in-ticket"
    },
    {
      "id": "R08",
      "text": "«GET /api/providers/:provider/mcp/servers без ?fields=names отдаёт тиммейтам значения env — закрыть для не-админа»",
      "status": "in-ticket"
    },
    {
      "id": "R09",
      "text": "«мастер-сессия: защита от двойной отправки пережить рестарт»",
      "status": "in-ticket"
    },
    {
      "id": "R10",
      "text": "«Motion → «уже есть» в покрытии»",
      "status": "in-ticket"
    },
    {
      "id": "R11",
      "text": "«переключатель вкладок справа вверху … убрать из шапки; чат остаётся основным видом»",
      "status": "in-ticket"
    },
    {
      "id": "R12",
      "text": "«Терминал, Файлы, Статистика, Автопилот (и вкладки плагинов) становятся видами вкладок холста рабочего стола»",
      "status": "in-ticket"
    },
    {
      "id": "R13",
      "text": "«всё открывается из одного меню «+» холста» (вместе с Инспектором, Контекстом и лимитами, Результатами)",
      "status": "in-ticket"
    },
    {
      "id": "R14",
      "text": "«В шапке остаются только колокольчик, боты, «Несохранённые правки» и подобные индикаторы»",
      "status": "in-ticket"
    },
    {
      "id": "R15",
      "text": "«Мод modWorkbench выключен — прежний переключатель вкладок возвращается»",
      "status": "in-ticket"
    },
    {
      "id": "R16",
      "text": "«На телефоне — то же меню из кнопки «Холст»»",
      "status": "in-ticket"
    },
    {
      "id": "R17",
      "text": "«открыл артефакт в холсте → выделяешь элементы мышкой» (наведение подсвечивает, клик выделяет, Shift — множественное)",
      "status": "in-ticket"
    },
    {
      "id": "R18",
      "text": "«двигаешь/меняешь размер/текст/цвет прямо на макете»",
      "status": "in-ticket"
    },
    {
      "id": "R19",
      "text": "«шрифт/кегль, отступы, скрыть/удалить, дублировать, слой выше/ниже»",
      "status": "in-ticket"
    },
    {
      "id": "R20",
      "text": "«отмена/повтор (стек операций)»",
      "status": "in-ticket"
    },
    {
      "id": "R21",
      "text": "«привязка к сетке и направляющим по краям соседей»",
      "status": "in-ticket"
    },
    {
      "id": "R22",
      "text": "«изменения сохраняются в файл новой версией» (source:'edit', проверка revision)",
      "status": "in-ticket"
    },
    {
      "id": "R23",
      "text": "«Внешние CSS: правки как inline-style или в <style data-neo3-edits> блоке; не ломать скрипты страницы»",
      "status": "in-ticket"
    },
    {
      "id": "R24",
      "text": "«сложное — «попросить агента» по выделению» (путь, селектор, скриншот участка, текст просьбы в исходный чат)",
      "status": "in-ticket"
    },
    {
      "id": "R25",
      "text": "«агент правит файл → холст ловит новую версию (refresh) и показывает diff версий»",
      "status": "in-ticket"
    },
    {
      "id": "R26",
      "text": "«режим кадров (страницы-слайды как артборды, миниатюры слева, порядок перетаскиванием)»",
      "status": "in-ticket"
    },
    {
      "id": "R27",
      "text": "«масштаб и прокрутка холста (zoom 25–400%, fit)»",
      "status": "in-ticket"
    },
    {
      "id": "R28",
      "text": "«для SVG — те же операции по элементам; для растровых — только комментарии и «попросить агента»»",
      "status": "in-ticket"
    },
    {
      "id": "R29",
      "text": "«мост принимает сообщения только от своего iframe; никакого доступа к cookies/API из макета (sandbox без same-origin, CSP connect-src 'none')»",
      "status": "in-ticket"
    },
    {
      "id": "R30",
      "text": "«тиммейты — только в своих проектах (projectAccessFor)»; приватные пути — отказ",
      "status": "in-ticket"
    },
    {
      "id": "R31",
      "text": "«мод modArtifactEditor, карточка с поддержкой движков»",
      "status": "in-ticket"
    },
    {
      "id": "R32",
      "text": "«Работать на Claude, Codex и Grok»",
      "status": "in-ticket"
    },
    {
      "id": "R33",
      "text": "«юнит-тесты модели операций и сериализации; сервис сохранения (revision-конфликт, приватные пути, версии)»",
      "status": "in-ticket"
    },
    {
      "id": "R34",
      "text": "«визуальная проверка — Safari (если управлять нельзя — назвать ограничение); живой сценарий на трёх движках»",
      "status": "in-ticket"
    },
    {
      "id": "R35i",
      "text": "(подразумевается) пункт 2 параллельно делает другая сессия в cloudcli-fork/ (toolGrouping.ts) — итог не должен дать две свёртки или конфликт при слиянии",
      "status": "in-ticket"
    },
    {
      "id": "R36i",
      "text": "(подразумевается) то, что уже выкачено (артефакты, комментарии, версии, инспектор), не ломается",
      "status": "in-ticket"
    }
  ],
  "gates": {
    "G1": {
      "ok": false,
      "at": "2026-11-04T17:03:36+03:00",
      "open": 36,
      "total": 36
    },
    "G2": {
      "ok": true,
      "at": "2026-11-04T17:12:33+03:00",
      "found": 13,
      "fixed": 13,
      "deferred": 0
    },
    "G3": {
      "ok": true,
      "at": "2026-11-04T17:14:06+03:00",
      "problems": 0
    }
  },
  "result": null
}
