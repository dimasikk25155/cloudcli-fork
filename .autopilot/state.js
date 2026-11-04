window.STATE =
{
  "version": 2,
  "slug": "neo3-workbench-figma",
  "dir": "2026-11-04-neo3-workbench-figma",
  "title": "Neo3: доделки рабочего стола и правка артефактов как в Figma",
  "mode": "full",
  "depth": "normal",
  "tier": "T2",
  "briefFile": "2026-11-04-brief.md",
  "memoryFile": "../CLAUDE.md",
  "memoryOwner": "user",
  "skillDir": "/Users/dimasik/.claude/skills/autopilot",
  "baseCommit": "8762103a",
  "startedAt": "2026-11-04T17:02:29+03:00",
  "updatedAt": "2026-11-04T19:19:15+03:00",
  "finishedAt": "2026-11-04T19:19:15+03:00",
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
      "status": "done",
      "startedAt": "2026-11-04T17:14:06+03:00",
      "finishedAt": "2026-11-04T17:14:17+03:00"
    },
    {
      "id": "build",
      "status": "done",
      "startedAt": "2026-11-04T17:14:17+03:00",
      "finishedAt": "2026-11-04T18:38:04+03:00"
    },
    {
      "id": "review",
      "status": "done",
      "startedAt": "2026-11-04T18:38:04+03:00",
      "finishedAt": "2026-11-04T19:07:55+03:00"
    },
    {
      "id": "final",
      "status": "done",
      "startedAt": "2026-11-04T19:07:55+03:00",
      "finishedAt": "2026-11-04T19:19:15+03:00"
    }
  ],
  "requirements": {
    "total": 36,
    "done": 36,
    "inTicket": 0,
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
      "status": "done",
      "startedAt": "2026-11-04T17:14:17+03:00",
      "finishedAt": "2026-11-04T17:43:38+03:00",
      "retries": 0,
      "repairs": 1,
      "repairFindings": [
        "запись MCP (POST/DELETE servers, POST global) для не-админа → 403, тест на каждый роут"
      ],
      "tests": {
        "passed": 1897,
        "failed": 0
      },
      "commit": "6ea6436e"
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
      "status": "done",
      "startedAt": "2026-11-04T17:14:17+03:00",
      "finishedAt": "2026-11-04T17:25:48+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 1860,
        "failed": 0
      },
      "commit": "3ee28895"
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
      "status": "done",
      "startedAt": "2026-11-04T17:14:17+03:00",
      "finishedAt": "2026-11-04T17:56:30+03:00",
      "retries": 0,
      "repairs": 1,
      "repairFindings": [
        "artifactsApi читает details из body.error.details; тест роутов на обработчике ошибок как в server/index.js"
      ],
      "tests": {
        "passed": 1919,
        "failed": 0
      },
      "commit": "fea10130"
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
      "status": "done",
      "startedAt": "2026-11-04T17:48:30+03:00",
      "finishedAt": "2026-11-04T18:12:38+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 1922,
        "failed": 0
      },
      "commit": "295f1991"
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
      "status": "done",
      "startedAt": "2026-11-04T18:12:38+03:00",
      "finishedAt": "2026-11-04T18:30:51+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 1943,
        "failed": 0
      },
      "commit": "7c8ab552"
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
      "status": "done",
      "startedAt": "2026-11-04T18:30:51+03:00",
      "finishedAt": "2026-11-04T18:38:04+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 1943,
        "failed": 0
      },
      "commit": "533ecb7f"
    },
    {
      "id": "F1",
      "title": "Ремонт ветки по общему ревью",
      "requirements": [
        "R08",
        "R16",
        "R18",
        "R22",
        "R24",
        "R26",
        "R29",
        "R30"
      ],
      "blockedBy": [],
      "wave": 5,
      "zone": [
        "server/modules/artifacts/",
        "server/modules/file-preview/",
        "server/modules/providers/",
        "src/components/workbench/artifact-editor/",
        "src/components/workbench/WorkbenchCanvas.tsx"
      ],
      "review": "да — ремонт ветки",
      "model": "сильная",
      "status": "done",
      "retries": 0,
      "repairs": 0,
      "startedAt": "2026-11-04T18:44:12+03:00",
      "finishedAt": "2026-11-04T19:07:55+03:00",
      "tests": {
        "passed": 1951,
        "failed": 0
      },
      "commit": "154a0d59"
    }
  ],
  "tests": {
    "passed": 1951,
    "failed": 0
  },
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
  "concerns": [
    "T02: шапка 390 px проверена только по классам — живая проверка в Safari в таске 06",
    "T02: терминал переподключается, если холст целиком скрыт (выкл холста, развернутый редактор, смена чата)",
    "T02: при включённом столе в aside темы codex скрыта кнопка «Изменения» (git-вкладки в холсте нет)",
    "T02: второй опрос автопилота (15 с) в WorkbenchCanvas рядом с MainContent",
    "T01: свёртка шагов повторяет незакоммиченную работу параллельной сессии; при слиянии ключи i18n toolGroup.steps vs toolGroup.stepsLabel — оставить одну реализацию",
    "T01: «Изменения хода» обновляются по смене статуса чата, не вживую; окно 300 сообщений",
    "T01: записи master-send в workspace_records не удаляются (TTL при чтении)",
    "provider.routes.ts:504-527 — workspacePath MCP не сверяется с доступом к проекту (projectAccessFor)",
    "mcp.service.ts:21 — args и url MCP не вырезаются для не-админа",
    "SessionHubPanel.tsx — «Прочитать всё» и подсказка мимо i18n",
    "provider.routes.ts — POST /:provider/skills и DELETE /:provider/skills/:dir открыты не-админу (запись в навыки Димы)",
    "artifacts.service.ts saveEdit — окно между проверкой realpath и writeFile (подмена промежуточной папки); O_NOFLOW + fstat dev/ino",
    "artifacts.service.ts saveEdit — два одновременных сохранения с одной baseVersionN оба проходят, одинаковый n; нужна очередь на id → 409",
    "file-preview createDocumentGrant — артефакт в папке с точкой даёт 500 INTERNAL_ERROR (PreviewError не AppError)",
    "bridge.ts — скрипт страницы видит nonce и может подделать ответы моста; доверять только validateBridgeMessage",
    "T04: подсветка при наведении вживую не проверена (синтетическая мышь в WKWebView не доходит до iframe)",
    "T04: ручки размера только справа/снизу/угол; размер = видимая рамка, у content-box с padding прибавляется",
    "T04: протяжка цвета при мультивыделении — отдельный шаг истории на каждое изменение",
    "T04: единицы SVG по viewBox/width, масштаб <g transform> не учитывается",
    "T05: если исходный чат не открыт, просьба ждёт, пока в нём не покажется вкладка артефакта (на телефоне с закрытым холстом — до открытия)",
    "T05: снимок только первого выделенного элемента (селекторы — всех, до 10)",
    "T05: Cmd/Ctrl+колесо внутри iframe проверено только тестом протокола",
    "e2e: редактор на 390 px тесный — рейка слайдов и панель свойств оставляют документу ~60 px",
    "e2e: миниатюры в рейке слайдов показывают обрезанный крупный фрагмент, а не уменьшенный кадр",
    "e2e: перетаскивание, правка текста и «Сохранить» мышью в Safari не проверены (клики System Events ненадёжны)"
  ],
  "blind": {
    "checked": 36,
    "matched": 12,
    "mismatches": [
      "Интерфейс (R01–R07, R11–R21, R24–R28) вслепую не проверен: Safari нельзя управлять (JS из Apple Events выключен, фокус уходил в Firefox); частично видно в e2e T06 — самопроверка 12/12, шапка 390 px, меню «+», «Правка» открывается",
      "R32/R34 — «Попросить агента» через чат Neo3 на трёх движках не проверено (временный HOME без входа); прямые CLI-вызовы в T06 правили файл"
    ]
  },
  "beats": [
    "2026-11-04T17:02:29+03:00",
    "2026-11-04T17:02:56+03:00",
    "2026-11-04T17:03:03+03:00",
    "2026-11-04T17:03:20+03:00",
    "2026-11-04T17:03:32+03:00",
    "2026-11-04T17:03:36+03:00",
    "2026-11-04T17:12:33+03:00",
    "2026-11-04T17:14:06+03:00",
    "2026-11-04T17:14:11+03:00",
    "2026-11-04T17:14:17+03:00",
    "2026-11-04T17:25:48+03:00",
    "2026-11-04T17:25:49+03:00",
    "2026-11-04T17:37:02+03:00",
    "2026-11-04T17:37:03+03:00",
    "2026-11-04T17:37:06+03:00",
    "2026-11-04T17:39:09+03:00",
    "2026-11-04T17:43:38+03:00",
    "2026-11-04T17:48:30+03:00",
    "2026-11-04T17:50:44+03:00",
    "2026-11-04T17:56:30+03:00",
    "2026-11-04T18:12:38+03:00",
    "2026-11-04T18:30:51+03:00",
    "2026-11-04T18:36:35+03:00",
    "2026-11-04T18:38:04+03:00",
    "2026-11-04T18:41:08+03:00",
    "2026-11-04T18:44:12+03:00",
    "2026-11-04T19:06:48+03:00",
    "2026-11-04T19:07:55+03:00",
    "2026-11-04T19:17:08+03:00",
    "2026-11-04T19:19:15+03:00"
  ],
  "rev": 54,
  "waiting": null,
  "waits": [
    {
      "kind": "action",
      "from": "2026-11-04T18:36:35+03:00",
      "to": "2026-11-04T18:38:04+03:00"
    }
  ],
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
    },
    {
      "t": "2026-11-04T17:14:17+03:00",
      "k": "stage",
      "id": "build",
      "act": "start"
    },
    {
      "t": "2026-11-04T17:14:17+03:00",
      "k": "ticket",
      "ids": [
        "01",
        "02",
        "03"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-04T17:25:48+03:00",
      "k": "ticket",
      "ids": [
        "02"
      ],
      "act": "done",
      "tests": {
        "passed": 1860,
        "failed": 0
      }
    },
    {
      "t": "2026-11-04T17:25:49+03:00",
      "k": "add",
      "key": "concerns",
      "n": 4
    },
    {
      "t": "2026-11-04T17:37:02+03:00",
      "k": "ticket",
      "ids": [
        "01"
      ],
      "act": "done",
      "tests": {
        "passed": 1897,
        "failed": 0
      }
    },
    {
      "t": "2026-11-04T17:37:03+03:00",
      "k": "add",
      "key": "concerns",
      "n": 3
    },
    {
      "t": "2026-11-04T17:37:06+03:00",
      "k": "ticket",
      "ids": [
        "01"
      ],
      "act": "review"
    },
    {
      "t": "2026-11-04T17:39:09+03:00",
      "k": "ticket",
      "ids": [
        "01"
      ],
      "act": "repair",
      "note": "запись MCP (POST/DELETE servers, POST global) для не-админа → 403, тест на каждый роут"
    },
    {
      "t": "2026-11-04T17:39:09+03:00",
      "k": "add",
      "key": "concerns",
      "n": 3
    },
    {
      "t": "2026-11-04T17:43:38+03:00",
      "k": "ticket",
      "ids": [
        "01"
      ],
      "act": "done",
      "tests": {
        "passed": 1897,
        "failed": 0
      }
    },
    {
      "t": "2026-11-04T17:43:38+03:00",
      "k": "add",
      "key": "concerns",
      "n": 1
    },
    {
      "t": "2026-11-04T17:48:30+03:00",
      "k": "ticket",
      "ids": [
        "03"
      ],
      "act": "done",
      "tests": {
        "passed": 1897,
        "failed": 0
      }
    },
    {
      "t": "2026-11-04T17:48:30+03:00",
      "k": "ticket",
      "ids": [
        "03"
      ],
      "act": "review"
    },
    {
      "t": "2026-11-04T17:48:30+03:00",
      "k": "ticket",
      "ids": [
        "04"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-04T17:50:44+03:00",
      "k": "ticket",
      "ids": [
        "03"
      ],
      "act": "repair",
      "note": "artifactsApi читает details из body.error.details; тест роутов на обработчике ошибок как в server/index.js"
    },
    {
      "t": "2026-11-04T17:50:44+03:00",
      "k": "add",
      "key": "concerns",
      "n": 4
    },
    {
      "t": "2026-11-04T17:56:30+03:00",
      "k": "ticket",
      "ids": [
        "03"
      ],
      "act": "done",
      "tests": {
        "passed": 1919,
        "failed": 0
      }
    },
    {
      "t": "2026-11-04T18:12:38+03:00",
      "k": "ticket",
      "ids": [
        "04"
      ],
      "act": "done",
      "tests": {
        "passed": 1922,
        "failed": 0
      }
    },
    {
      "t": "2026-11-04T18:12:38+03:00",
      "k": "add",
      "key": "concerns",
      "n": 4
    },
    {
      "t": "2026-11-04T18:12:38+03:00",
      "k": "ticket",
      "ids": [
        "05"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-04T18:30:51+03:00",
      "k": "ticket",
      "ids": [
        "05"
      ],
      "act": "done",
      "tests": {
        "passed": 1943,
        "failed": 0
      }
    },
    {
      "t": "2026-11-04T18:30:51+03:00",
      "k": "add",
      "key": "concerns",
      "n": 3
    },
    {
      "t": "2026-11-04T18:30:51+03:00",
      "k": "ticket",
      "ids": [
        "06"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-04T18:36:35+03:00",
      "k": "ask",
      "kind": "action",
      "note": "выкатка feat/neo3-workbench-figma на боевой Neo3 + рестарт — ждём «да» Димы"
    },
    {
      "t": "2026-11-04T18:38:04+03:00",
      "k": "answered",
      "kind": "action"
    },
    {
      "t": "2026-11-04T18:38:04+03:00",
      "k": "ticket",
      "ids": [
        "06"
      ],
      "act": "done",
      "tests": {
        "passed": 1943,
        "failed": 0
      }
    },
    {
      "t": "2026-11-04T18:38:04+03:00",
      "k": "add",
      "key": "concerns",
      "n": 3
    },
    {
      "t": "2026-11-04T18:38:04+03:00",
      "k": "stage",
      "id": "review",
      "act": "start"
    },
    {
      "t": "2026-11-04T18:41:08+03:00",
      "k": "add",
      "key": "report",
      "n": 3
    },
    {
      "t": "2026-11-04T18:44:12+03:00",
      "k": "add",
      "key": "report",
      "n": 10
    },
    {
      "t": "2026-11-04T18:44:12+03:00",
      "k": "tickets",
      "n": 7
    },
    {
      "t": "2026-11-04T18:44:12+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-11-04T18:44:12+03:00",
      "k": "ticket",
      "ids": [
        "F1"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-04T19:06:48+03:00",
      "k": "ticket",
      "ids": [
        "F1"
      ],
      "act": "done",
      "tests": {
        "passed": 1951,
        "failed": 0
      }
    },
    {
      "t": "2026-11-04T19:06:48+03:00",
      "k": "ticket",
      "ids": [
        "F1"
      ],
      "act": "review"
    },
    {
      "t": "2026-11-04T19:07:55+03:00",
      "k": "ticket",
      "ids": [
        "F1"
      ],
      "act": "done",
      "tests": {
        "passed": 1951,
        "failed": 0
      }
    },
    {
      "t": "2026-11-04T19:07:55+03:00",
      "k": "add",
      "key": "report",
      "n": 2
    },
    {
      "t": "2026-11-04T19:07:55+03:00",
      "k": "stage",
      "id": "final",
      "act": "start"
    },
    {
      "t": "2026-11-04T19:17:08+03:00",
      "k": "gate",
      "g": "G4",
      "ok": false,
      "checked": 36,
      "matched": 12
    },
    {
      "t": "2026-11-04T19:17:08+03:00",
      "k": "tests",
      "passed": 1951,
      "failed": 0
    },
    {
      "t": "2026-11-04T19:19:15+03:00",
      "k": "finish",
      "result": "Вкладки проекта в холсте, «Прочитать всё», свёртка шагов, баги прошлой сборки и правка артефактов как в Figma — в ветке feat/neo3-workbench-figma, не выкачено"
    }
  ],
  "reqList": [
    {
      "id": "R01",
      "text": "«В панели диалогов кнопка «Прочитать всё»»",
      "status": "done"
    },
    {
      "id": "R02",
      "text": "«Скрыть длинные списки шагов помощников в чате: по умолчанию одна свёрнутая строка «Шаги помощника: N ▸», раскрывается по клику»",
      "status": "done"
    },
    {
      "id": "R03",
      "text": "«на 390 px вкладки шапки обрезаются и длинный заголовок наезжает на кнопки (шапку на flex)»",
      "status": "done"
    },
    {
      "id": "R04",
      "text": "«недописанный комментарий к артефакту теряется при смене вкладки»",
      "status": "done"
    },
    {
      "id": "R05",
      "text": "«вкладки нового чата не переходят в созданную сессию»",
      "status": "done"
    },
    {
      "id": "R06",
      "text": "«„Перенести“ из карточки лимитов зависит от порядка подписчиков»",
      "status": "done"
    },
    {
      "id": "R07",
      "text": "«инспектор „Изменения файлов“ показывает все незакоммиченные, а не изменения хода»",
      "status": "done"
    },
    {
      "id": "R08",
      "text": "«GET /api/providers/:provider/mcp/servers без ?fields=names отдаёт тиммейтам значения env — закрыть для не-админа»",
      "status": "done"
    },
    {
      "id": "R09",
      "text": "«мастер-сессия: защита от двойной отправки пережить рестарт»",
      "status": "done"
    },
    {
      "id": "R10",
      "text": "«Motion → «уже есть» в покрытии»",
      "status": "done"
    },
    {
      "id": "R11",
      "text": "«переключатель вкладок справа вверху … убрать из шапки; чат остаётся основным видом»",
      "status": "done"
    },
    {
      "id": "R12",
      "text": "«Терминал, Файлы, Статистика, Автопилот (и вкладки плагинов) становятся видами вкладок холста рабочего стола»",
      "status": "done"
    },
    {
      "id": "R13",
      "text": "«всё открывается из одного меню «+» холста» (вместе с Инспектором, Контекстом и лимитами, Результатами)",
      "status": "done"
    },
    {
      "id": "R14",
      "text": "«В шапке остаются только колокольчик, боты, «Несохранённые правки» и подобные индикаторы»",
      "status": "done"
    },
    {
      "id": "R15",
      "text": "«Мод modWorkbench выключен — прежний переключатель вкладок возвращается»",
      "status": "done"
    },
    {
      "id": "R16",
      "text": "«На телефоне — то же меню из кнопки «Холст»»",
      "status": "done"
    },
    {
      "id": "R17",
      "text": "«открыл артефакт в холсте → выделяешь элементы мышкой» (наведение подсвечивает, клик выделяет, Shift — множественное)",
      "status": "done"
    },
    {
      "id": "R18",
      "text": "«двигаешь/меняешь размер/текст/цвет прямо на макете»",
      "status": "done"
    },
    {
      "id": "R19",
      "text": "«шрифт/кегль, отступы, скрыть/удалить, дублировать, слой выше/ниже»",
      "status": "done"
    },
    {
      "id": "R20",
      "text": "«отмена/повтор (стек операций)»",
      "status": "done"
    },
    {
      "id": "R21",
      "text": "«привязка к сетке и направляющим по краям соседей»",
      "status": "done"
    },
    {
      "id": "R22",
      "text": "«изменения сохраняются в файл новой версией» (source:'edit', проверка revision)",
      "status": "done"
    },
    {
      "id": "R23",
      "text": "«Внешние CSS: правки как inline-style или в <style data-neo3-edits> блоке; не ломать скрипты страницы»",
      "status": "done"
    },
    {
      "id": "R24",
      "text": "«сложное — «попросить агента» по выделению» (путь, селектор, скриншот участка, текст просьбы в исходный чат)",
      "status": "done"
    },
    {
      "id": "R25",
      "text": "«агент правит файл → холст ловит новую версию (refresh) и показывает diff версий»",
      "status": "done"
    },
    {
      "id": "R26",
      "text": "«режим кадров (страницы-слайды как артборды, миниатюры слева, порядок перетаскиванием)»",
      "status": "done"
    },
    {
      "id": "R27",
      "text": "«масштаб и прокрутка холста (zoom 25–400%, fit)»",
      "status": "done"
    },
    {
      "id": "R28",
      "text": "«для SVG — те же операции по элементам; для растровых — только комментарии и «попросить агента»»",
      "status": "done"
    },
    {
      "id": "R29",
      "text": "«мост принимает сообщения только от своего iframe; никакого доступа к cookies/API из макета (sandbox без same-origin, CSP connect-src 'none')»",
      "status": "done"
    },
    {
      "id": "R30",
      "text": "«тиммейты — только в своих проектах (projectAccessFor)»; приватные пути — отказ",
      "status": "done"
    },
    {
      "id": "R31",
      "text": "«мод modArtifactEditor, карточка с поддержкой движков»",
      "status": "done"
    },
    {
      "id": "R32",
      "text": "«Работать на Claude, Codex и Grok»",
      "status": "done"
    },
    {
      "id": "R33",
      "text": "«юнит-тесты модели операций и сериализации; сервис сохранения (revision-конфликт, приватные пути, версии)»",
      "status": "done"
    },
    {
      "id": "R34",
      "text": "«визуальная проверка — Safari (если управлять нельзя — назвать ограничение); живой сценарий на трёх движках»",
      "status": "done"
    },
    {
      "id": "R35i",
      "text": "(подразумевается) пункт 2 параллельно делает другая сессия в cloudcli-fork/ (toolGrouping.ts) — итог не должен дать две свёртки или конфликт при слиянии",
      "status": "done"
    },
    {
      "id": "R36i",
      "text": "(подразумевается) то, что уже выкачено (артефакты, комментарии, версии, инспектор), не ломается",
      "status": "done"
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
      "at": "2026-11-04T18:44:12+03:00",
      "problems": 0
    },
    "G4": {
      "ok": false,
      "at": "2026-11-04T19:17:08+03:00",
      "checked": 36,
      "matched": 12
    }
  },
  "result": "Вкладки проекта в холсте, «Прочитать всё», свёртка шагов, баги прошлой сборки и правка артефактов как в Figma — в ветке feat/neo3-workbench-figma, не выкачено",
  "report": [
    "Записи о доставке мастер-сессии не удаляются из базы (срок 24 ч проверяется при чтении) — объём мизерный",
    "Копия SVG в редакторе отдаётся как HTML — для показа достаточно, на сохранение не влияет",
    "Список навыков любой папки виден тиммейту (только чтение, было до сборки)",
    "Автопилот опрашивается 2–3 раза каждые 15 с (шапка, холст, вкладка) — работает, но лишняя нагрузка",
    "Терминал переподключается, если холст скрыть целиком (между вкладками холста держится)",
    "При включённом рабочем столе в теме codex пропала кнопка «Изменения» (Git), вкладки Git в холсте нет",
    "Ручки размера только справа, снизу и в углу",
    "Протяжка цвета при нескольких выделенных — каждое движение отдельный шаг отмены",
    "Отложенная просьба агенту ждёт открытия вкладки артефакта в исходном чате; уходит через паузу 800 мс — есть риск попасть не в тот чат",
    "Рейка слайдов после каждой правки заново снимает все кадры — на длинной колоде тормоза",
    "Самопроверка редактора ?neo3EditorSelfTest=1 есть в боевой сборке (локальная, без сети)",
    "Свёртка шагов дублирует незакоммиченную работу параллельной сессии в cloudcli-fork — при слиянии оставить одну",
    "Вживую не проверены мышью: перетаскивание, текст, «Сохранить», подсветка при наведении, Cmd+колесо, «Попросить агента» через чат Neo3",
    "Запись правки на диск не повторяет запись, если ушло меньше байт (для обычных файлов практически не случается)",
    "Чтение списка навыков (GET /skills) тиммейту не ограничено"
  ]
}
