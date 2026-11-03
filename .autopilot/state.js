window.STATE =
{
  "version": 2,
  "slug": "improvement-ideas",
  "dir": "2026-11-02-improvement-ideas--wip",
  "title": "Идеи улучшений и проверка выхода из плана",
  "mode": "semi",
  "depth": "normal",
  "tier": "T1",
  "briefFile": "2026-11-02-brief.md",
  "memoryFile": "../CLAUDE.md",
  "memoryOwner": "user",
  "skillDir": "/Users/dimasik/.codex/skills/autopilot",
  "baseCommit": "e1e4d38b",
  "startedAt": "2026-11-02T03:19:42+03:00",
  "updatedAt": "2026-11-03T14:21:13+03:00",
  "finishedAt": null,
  "stages": [
    {
      "id": "preflight",
      "status": "done",
      "startedAt": "2026-11-02T03:19:42+03:00",
      "finishedAt": "2026-11-02T03:19:42+03:00"
    },
    {
      "id": "manifest",
      "status": "done",
      "startedAt": "2026-11-02T05:20:42+03:00",
      "finishedAt": "2026-11-02T05:20:42+03:00"
    },
    {
      "id": "briefing",
      "status": "skipped",
      "startedAt": "2026-11-02T05:20:42+03:00",
      "finishedAt": "2026-11-02T05:20:42+03:00",
      "note": "full: HTML preview first; source/media/download preserve"
    },
    {
      "id": "spec",
      "status": "done",
      "startedAt": "2026-11-02T05:20:42+03:00",
      "finishedAt": "2026-11-02T05:20:42+03:00"
    },
    {
      "id": "plan",
      "status": "done",
      "startedAt": "2026-11-02T05:20:42+03:00",
      "finishedAt": "2026-11-02T05:20:42+03:00"
    },
    {
      "id": "build",
      "status": "done",
      "startedAt": "2026-11-02T05:20:42+03:00",
      "finishedAt": "2026-11-02T05:24:35+03:00"
    },
    {
      "id": "review",
      "status": "done",
      "startedAt": "2026-11-02T05:24:35+03:00",
      "finishedAt": "2026-11-02T05:28:05+03:00"
    },
    {
      "id": "final",
      "status": "active",
      "startedAt": "2026-11-02T05:28:05+03:00"
    }
  ],
  "requirements": {
    "total": 16,
    "done": 12,
    "inTicket": 4,
    "inSpec": 0,
    "placeholder": 0,
    "deferred": 0,
    "dropped": 0
  },
  "tickets": [
    {
      "id": "01",
      "title": "Идеи с памятью и одобрением",
      "requirements": [
        "R01",
        "R02",
        "R03",
        "R04",
        "R05",
        "R06"
      ],
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "server/modules/improvement-ideas/",
        "server/modules/database/",
        "server/modules/websocket/services/chat-run-registry.service.ts",
        "server/modules/websocket/services/chat-websocket.service.ts",
        "server/index.js",
        "shared/mods.ts",
        "shared/improvement-ideas.ts",
        "src/components/improvement-ideas/",
        "src/components/chat/view/ChatInterface.tsx",
        "docs/improvement-ideas.md"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "done",
      "startedAt": "2026-11-02T03:22:34+03:00",
      "finishedAt": "2026-11-02T03:45:04+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 1593,
        "failed": 0
      },
      "commit": "75ea7f9a"
    },
    {
      "id": "02",
      "title": "HTML открывается страницей",
      "requirements": [
        "G07",
        "G08",
        "G09",
        "G10"
      ],
      "blockedBy": [],
      "wave": 3,
      "zone": [
        "src/components/code-editor/",
        "src/utils/api.ts",
        "src/utils/api/",
        "server/modules/file-preview/",
        "server/index.js"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "done",
      "startedAt": "2026-11-02T05:16:13+03:00",
      "finishedAt": "2026-11-02T05:24:35+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 1598,
        "failed": 0
      },
      "commit": "e142b871"
    },
    {
      "id": "03",
      "title": "Ссылки с пробелами открывают файл",
      "requirements": [
        "G08",
        "G11"
      ],
      "blockedBy": [
        "02"
      ],
      "wave": 5,
      "zone": [
        "src/components/chat/utils/filePathDetection.ts",
        "src/components/chat/utils/filePathDetection.test.ts",
        "src/components/chat/view/subcomponents/Markdown.tsx",
        "src/components/chat/view/subcomponents/Markdown.test.tsx"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "done",
      "startedAt": "2026-11-02T05:33:32+03:00",
      "finishedAt": "2026-11-02T05:38:59+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 17,
        "failed": 0
      },
      "commit": "e8341086"
    },
    {
      "id": "04",
      "title": "Результат помощника доходит до карточки",
      "requirements": [
        "G12"
      ],
      "blockedBy": [],
      "wave": 6,
      "zone": [
        "server/modules/providers/list/codex/codex-subagents.ts",
        "server/modules/providers/tests/codex-subagents.test.ts",
        "src/components/crabs/",
        "src/components/chat/hooks/useChatMessages.ts",
        "server/modules/providers/list/codex/codex-sessions.provider.ts",
        "server/openai-codex.js"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "done",
      "startedAt": "2026-11-02T05:57:57+03:00",
      "finishedAt": "2026-11-02T06:13:12+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 1603,
        "failed": 0
      },
      "commit": "c9dbec18"
    },
    {
      "id": "05",
      "title": "Общий проверенный выпуск",
      "requirements": [
        "G13",
        "G14",
        "G15",
        "G16"
      ],
      "blockedBy": [
        "01",
        "02",
        "03",
        "04"
      ],
      "wave": 8,
      "zone": [
        "src/",
        "server/",
        "shared/",
        "scripts/",
        "docs/combined-release-2026-11-03.md"
      ],
      "review": "да — выпуск и миграции",
      "model": "сильная",
      "status": "review",
      "retries": 0,
      "repairs": 0,
      "startedAt": "2026-11-03T14:07:36+03:00"
    },
    {
      "id": "F1",
      "title": "Полные идеи и корректные ошибки карточек",
      "requirements": [
        "R03",
        "R04",
        "R05",
        "R06"
      ],
      "blockedBy": [],
      "wave": 2,
      "zone": [
        "server/modules/improvement-ideas/idea-parser.ts",
        "server/modules/improvement-ideas/tests/ideas.test.ts",
        "src/components/improvement-ideas/IdeaCards.tsx",
        "src/components/improvement-ideas/IdeaCards.test.ts"
      ],
      "review": "да — ремонт ветки",
      "model": "сильная",
      "status": "done",
      "startedAt": "2026-11-02T03:38:18+03:00",
      "finishedAt": "2026-11-02T03:45:04+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 17,
        "failed": 0
      },
      "commit": "75ea7f9a"
    },
    {
      "id": "F2",
      "title": "Проверка внешнего корня превью",
      "requirements": [
        "G07",
        "G10"
      ],
      "blockedBy": [
        "02"
      ],
      "wave": 4,
      "zone": [
        "server/modules/file-preview/file-preview.service.ts",
        "server/modules/file-preview/tests/file-preview.test.ts"
      ],
      "review": "да — ремонт ветки",
      "model": "сильная",
      "status": "done",
      "startedAt": "2026-11-02T05:26:15+03:00",
      "finishedAt": "2026-11-02T05:28:05+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 8,
        "failed": 0
      },
      "commit": "dffd551f"
    },
    {
      "id": "F3",
      "title": "Поздний итог относится к своему запуску",
      "requirements": [
        "G12"
      ],
      "blockedBy": [
        "04"
      ],
      "wave": 7,
      "zone": [
        "server/modules/providers/list/codex/codex-subagents.ts",
        "server/modules/providers/tests/codex-subagents.test.ts"
      ],
      "review": "да — ремонт ветки",
      "model": "сильная",
      "status": "done",
      "startedAt": "2026-11-02T06:09:55+03:00",
      "finishedAt": "2026-11-02T06:13:12+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 6,
        "failed": 0
      },
      "commit": "3b79ed00"
    }
  ],
  "tests": {
    "passed": 1692,
    "failed": 0
  },
  "debt": {
    "placeholders": [],
    "assumptions": [],
    "emptyEnv": []
  },
  "additions": [],
  "coverage": {
    "found": 2,
    "fixed": 2,
    "deferred": 0,
    "items": []
  },
  "concerns": [
    "G12: live SDK->WS->browser unverified; missing/reordered final messages without cycle id remain ambiguous"
  ],
  "blind": {
    "checked": 1,
    "matched": 0,
    "mismatches": [
      "G12 history recovery confirmed in real replay; live/browser E2E pending and final-without-cycle-id ambiguity documented"
    ]
  },
  "beats": [
    "2026-11-02T03:19:42+03:00",
    "2026-11-02T03:19:54+03:00",
    "2026-11-02T03:19:55+03:00",
    "2026-11-02T03:22:10+03:00",
    "2026-11-02T03:22:20+03:00",
    "2026-11-02T03:22:34+03:00",
    "2026-11-02T03:38:18+03:00",
    "2026-11-02T03:45:04+03:00",
    "2026-11-02T03:45:05+03:00",
    "2026-11-02T05:14:37+03:00",
    "2026-11-02T05:15:22+03:00",
    "2026-11-02T05:16:04+03:00",
    "2026-11-02T05:16:13+03:00",
    "2026-11-02T05:20:42+03:00",
    "2026-11-02T05:24:35+03:00",
    "2026-11-02T05:26:15+03:00",
    "2026-11-02T05:28:05+03:00",
    "2026-11-02T05:28:28+03:00",
    "2026-11-02T05:29:06+03:00",
    "2026-11-02T05:33:31+03:00",
    "2026-11-02T05:33:32+03:00",
    "2026-11-02T05:38:59+03:00",
    "2026-11-02T05:57:57+03:00",
    "2026-11-02T05:58:28+03:00",
    "2026-11-02T06:08:52+03:00",
    "2026-11-02T06:09:55+03:00",
    "2026-11-02T06:11:58+03:00",
    "2026-11-02T06:13:12+03:00",
    "2026-11-02T06:13:13+03:00",
    "2026-11-02T06:13:28+03:00",
    "2026-11-03T14:06:44+03:00",
    "2026-11-03T14:06:47+03:00",
    "2026-11-03T14:07:34+03:00",
    "2026-11-03T14:07:35+03:00",
    "2026-11-03T14:07:36+03:00",
    "2026-11-03T14:08:34+03:00",
    "2026-11-03T14:21:13+03:00"
  ],
  "rev": 82,
  "waiting": null,
  "waits": [
    {
      "kind": "action",
      "from": "2026-11-02T03:45:05+03:00",
      "to": "2026-11-02T05:14:37+03:00"
    },
    {
      "kind": "action",
      "from": "2026-11-02T05:29:06+03:00",
      "to": "2026-11-02T05:33:31+03:00"
    }
  ],
  "log": [
    {
      "t": "2026-11-02T03:19:42+03:00",
      "k": "init"
    },
    {
      "t": "2026-11-02T03:19:42+03:00",
      "k": "stage",
      "id": "manifest",
      "act": "start"
    },
    {
      "t": "2026-11-02T03:19:54+03:00",
      "k": "stage",
      "id": "briefing",
      "act": "start"
    },
    {
      "t": "2026-11-02T03:19:55+03:00",
      "k": "gate",
      "g": "G1",
      "ok": true,
      "open": 0,
      "total": 6
    },
    {
      "t": "2026-11-02T03:19:55+03:00",
      "k": "stage",
      "id": "spec",
      "act": "start"
    },
    {
      "t": "2026-11-02T03:22:10+03:00",
      "k": "gate",
      "g": "G2",
      "ok": true,
      "found": 1,
      "fixed": 1,
      "deferred": 0
    },
    {
      "t": "2026-11-02T03:22:10+03:00",
      "k": "stage",
      "id": "plan",
      "act": "start"
    },
    {
      "t": "2026-11-02T03:22:10+03:00",
      "k": "tier",
      "v": "T1"
    },
    {
      "t": "2026-11-02T03:22:10+03:00",
      "k": "tickets",
      "n": 1
    },
    {
      "t": "2026-11-02T03:22:10+03:00",
      "k": "gate",
      "g": "G3",
      "ok": false,
      "problems": 1
    },
    {
      "t": "2026-11-02T03:22:20+03:00",
      "k": "tickets",
      "n": 1
    },
    {
      "t": "2026-11-02T03:22:20+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-11-02T03:22:34+03:00",
      "k": "stage",
      "id": "build",
      "act": "start"
    },
    {
      "t": "2026-11-02T03:22:34+03:00",
      "k": "ticket",
      "ids": [
        "01"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-02T03:38:18+03:00",
      "k": "stage",
      "id": "review",
      "act": "start"
    },
    {
      "t": "2026-11-02T03:38:18+03:00",
      "k": "tickets",
      "n": 2
    },
    {
      "t": "2026-11-02T03:38:18+03:00",
      "k": "ticket",
      "ids": [
        "F1"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-02T03:45:04+03:00",
      "k": "ticket",
      "ids": [
        "01"
      ],
      "act": "done",
      "tests": {
        "passed": 1593,
        "failed": 0
      }
    },
    {
      "t": "2026-11-02T03:45:04+03:00",
      "k": "ticket",
      "ids": [
        "F1"
      ],
      "act": "done",
      "tests": {
        "passed": 17,
        "failed": 0
      }
    },
    {
      "t": "2026-11-02T03:45:04+03:00",
      "k": "stage",
      "id": "final",
      "act": "start"
    },
    {
      "t": "2026-11-02T03:45:04+03:00",
      "k": "tests",
      "passed": 1593,
      "failed": 0
    },
    {
      "t": "2026-11-02T03:45:05+03:00",
      "k": "gate",
      "g": "G4",
      "ok": false,
      "checked": 6,
      "matched": 5
    },
    {
      "t": "2026-11-02T03:45:05+03:00",
      "k": "ask",
      "kind": "action",
      "note": "Применить готовый мод идей в Neo3 отдельным релизом и безопасно перезапустить; source 75ea7f9a, проверки пройдены"
    },
    {
      "t": "2026-11-02T05:14:37+03:00",
      "k": "answered",
      "kind": "action"
    },
    {
      "t": "2026-11-02T05:14:37+03:00",
      "k": "gate",
      "g": "G1",
      "ok": true,
      "open": 0,
      "total": 10
    },
    {
      "t": "2026-11-02T05:14:37+03:00",
      "k": "stage",
      "id": "spec",
      "act": "start"
    },
    {
      "t": "2026-11-02T05:15:22+03:00",
      "k": "gate",
      "g": "G2",
      "ok": true,
      "found": 2,
      "fixed": 1,
      "deferred": 1
    },
    {
      "t": "2026-11-02T05:16:04+03:00",
      "k": "stage",
      "id": "plan",
      "act": "start"
    },
    {
      "t": "2026-11-02T05:16:04+03:00",
      "k": "tickets",
      "n": 3
    },
    {
      "t": "2026-11-02T05:16:04+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-11-02T05:16:13+03:00",
      "k": "stage",
      "id": "build",
      "act": "start"
    },
    {
      "t": "2026-11-02T05:16:13+03:00",
      "k": "ticket",
      "ids": [
        "02"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-02T05:20:42+03:00",
      "k": "reopen"
    },
    {
      "t": "2026-11-02T05:20:42+03:00",
      "k": "stage",
      "id": "briefing",
      "act": "skip",
      "note": "full: HTML preview first; source/media/download preserve"
    },
    {
      "t": "2026-11-02T05:20:42+03:00",
      "k": "gate",
      "g": "G1",
      "ok": true,
      "open": 0,
      "total": 10
    },
    {
      "t": "2026-11-02T05:20:42+03:00",
      "k": "stage",
      "id": "spec",
      "act": "start"
    },
    {
      "t": "2026-11-02T05:20:42+03:00",
      "k": "gate",
      "g": "G2",
      "ok": true,
      "found": 2,
      "fixed": 1,
      "deferred": 1
    },
    {
      "t": "2026-11-02T05:20:42+03:00",
      "k": "stage",
      "id": "plan",
      "act": "start"
    },
    {
      "t": "2026-11-02T05:20:42+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-11-02T05:20:42+03:00",
      "k": "stage",
      "id": "build",
      "act": "start"
    },
    {
      "t": "2026-11-02T05:24:35+03:00",
      "k": "ticket",
      "ids": [
        "02"
      ],
      "act": "done",
      "tests": {
        "passed": 1598,
        "failed": 0
      }
    },
    {
      "t": "2026-11-02T05:24:35+03:00",
      "k": "stage",
      "id": "review",
      "act": "start"
    },
    {
      "t": "2026-11-02T05:26:15+03:00",
      "k": "tickets",
      "n": 4
    },
    {
      "t": "2026-11-02T05:26:15+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-11-02T05:26:15+03:00",
      "k": "ticket",
      "ids": [
        "F2"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-02T05:28:05+03:00",
      "k": "ticket",
      "ids": [
        "F2"
      ],
      "act": "done",
      "tests": {
        "passed": 8,
        "failed": 0
      }
    },
    {
      "t": "2026-11-02T05:28:05+03:00",
      "k": "stage",
      "id": "final",
      "act": "start"
    },
    {
      "t": "2026-11-02T05:28:28+03:00",
      "k": "tests",
      "passed": 1598,
      "failed": 0
    },
    {
      "t": "2026-11-02T05:28:28+03:00",
      "k": "gate",
      "g": "G4",
      "ok": false,
      "checked": 4,
      "matched": 2
    },
    {
      "t": "2026-11-02T05:29:06+03:00",
      "k": "ask",
      "kind": "action",
      "note": "HTML preview e142b871+dffd551f проверен; применение dist/dist-server и безопасный restart требует отдельного согласования; browser E2E pending Edge ENOENT"
    },
    {
      "t": "2026-11-02T05:33:31+03:00",
      "k": "answered",
      "kind": "action"
    },
    {
      "t": "2026-11-02T05:33:31+03:00",
      "k": "tickets",
      "n": 5
    },
    {
      "t": "2026-11-02T05:33:31+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-11-02T05:33:32+03:00",
      "k": "ticket",
      "ids": [
        "03"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-02T05:38:59+03:00",
      "k": "ticket",
      "ids": [
        "03"
      ],
      "act": "done",
      "tests": {
        "passed": 17,
        "failed": 0
      }
    },
    {
      "t": "2026-11-02T05:57:57+03:00",
      "k": "tickets",
      "n": 6
    },
    {
      "t": "2026-11-02T05:57:57+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-11-02T05:57:57+03:00",
      "k": "ticket",
      "ids": [
        "04"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-02T05:58:28+03:00",
      "k": "gate",
      "g": "G2",
      "ok": true,
      "found": 0,
      "fixed": 0,
      "deferred": 0
    },
    {
      "t": "2026-11-02T06:08:52+03:00",
      "k": "ticket",
      "ids": [
        "04"
      ],
      "act": "review"
    },
    {
      "t": "2026-11-02T06:09:55+03:00",
      "k": "tickets",
      "n": 7
    },
    {
      "t": "2026-11-02T06:09:55+03:00",
      "k": "ticket",
      "ids": [
        "F3"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-02T06:11:58+03:00",
      "k": "ticket",
      "ids": [
        "F3"
      ],
      "act": "review"
    },
    {
      "t": "2026-11-02T06:13:12+03:00",
      "k": "ticket",
      "ids": [
        "04"
      ],
      "act": "done",
      "tests": {
        "passed": 1603,
        "failed": 0
      }
    },
    {
      "t": "2026-11-02T06:13:12+03:00",
      "k": "ticket",
      "ids": [
        "F3"
      ],
      "act": "done",
      "tests": {
        "passed": 6,
        "failed": 0
      }
    },
    {
      "t": "2026-11-02T06:13:13+03:00",
      "k": "add",
      "key": "concerns",
      "n": 1
    },
    {
      "t": "2026-11-02T06:13:28+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-11-02T06:13:28+03:00",
      "k": "gate",
      "g": "G4",
      "ok": false,
      "checked": 1,
      "matched": 0
    },
    {
      "t": "2026-11-03T14:06:47+03:00",
      "k": "tickets",
      "n": 8
    },
    {
      "t": "2026-11-03T14:06:47+03:00",
      "k": "gate",
      "g": "G3",
      "ok": false,
      "problems": 7
    },
    {
      "t": "2026-11-03T14:07:34+03:00",
      "k": "tickets",
      "n": 8
    },
    {
      "t": "2026-11-03T14:07:35+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-11-03T14:07:36+03:00",
      "k": "ticket",
      "ids": [
        "05"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-03T14:08:34+03:00",
      "k": "gate",
      "g": "G2",
      "ok": true,
      "found": 2,
      "fixed": 2,
      "deferred": 0
    },
    {
      "t": "2026-11-03T14:21:13+03:00",
      "k": "tests",
      "passed": 1692,
      "failed": 0
    },
    {
      "t": "2026-11-03T14:21:13+03:00",
      "k": "add",
      "key": "report",
      "n": 1
    },
    {
      "t": "2026-11-03T14:21:13+03:00",
      "k": "ticket",
      "ids": [
        "05"
      ],
      "act": "review"
    }
  ],
  "reqList": [
    {
      "id": "R01",
      "text": "«планирование + обход починил чтобы работал? тест прогнал что из плана выходит?»",
      "status": "done"
    },
    {
      "id": "R02",
      "text": "«или проще автопилот просто включать?»",
      "status": "done"
    },
    {
      "id": "R03",
      "text": "«ОЧЕНЬ ВАЖНЫЙ МОД НУЖНО СДЕЛАТЬ»",
      "status": "done"
    },
    {
      "id": "R04",
      "text": "«МОЖНО ЗАПИСЫВАТЬ В ОБСИДИАН»",
      "status": "done"
    },
    {
      "id": "R05",
      "text": "«ЧТОБЫ ЕСЛИ Я ТЕБЯ СПРОСИЛ ТЫ УЖЕ НАКОПИЛ ОПЫТ ПО ХОДУ РАБОТЫ»",
      "status": "done"
    },
    {
      "id": "R06",
      "text": "«В ИНТЕРФЕЙСЕ cli чтобы я сразу одобрял если идею нужно реализовать сразау»",
      "status": "done"
    },
    {
      "id": "G07",
      "text": "«когда я жму на html я хочу увидеть сайт а не код»",
      "status": "done"
    },
    {
      "id": "G08",
      "text": "«кликом в веб интерфейсе нажжать на твой ответ на гиперссылку»",
      "status": "done"
    },
    {
      "id": "G09",
      "text": "«если он не .md то в идеале открыть его в браузере html страницой»",
      "status": "done"
    },
    {
      "id": "G10",
      "text": "«хочу видеть все своими глазами либо в превью по ссылке или уже на мейн»",
      "status": "done"
    },
    {
      "id": "G11",
      "text": "«путь же битый всю дорогу ты мне показываешь, антигравити без % папка называется»",
      "status": "done"
    },
    {
      "id": "G12",
      "text": "«постарайся сделать что сможешь» — помощник «не вернулся»",
      "status": "done"
    },
    {
      "id": "G13",
      "text": "«минимум 4 сессии сделали изменения в CLI»",
      "status": "in-ticket"
    },
    {
      "id": "G14",
      "text": "«собрать все воедино» / «правильно сведи ветки»",
      "status": "in-ticket"
    },
    {
      "id": "G15",
      "text": "«сделать полный деплой и перезагрузить»",
      "status": "in-ticket"
    },
    {
      "id": "G16",
      "text": "«Пожалуйста, не накосячь»",
      "status": "in-ticket"
    }
  ],
  "gates": {
    "G1": {
      "ok": true,
      "at": "2026-11-02T05:20:42+03:00",
      "open": 0,
      "total": 10
    },
    "G2": {
      "ok": true,
      "at": "2026-11-03T14:08:34+03:00",
      "found": 2,
      "fixed": 2,
      "deferred": 0
    },
    "G3": {
      "ok": true,
      "at": "2026-11-03T14:07:35+03:00",
      "problems": 0
    },
    "G4": {
      "ok": false,
      "at": "2026-11-02T06:13:28+03:00",
      "checked": 1,
      "matched": 0
    }
  },
  "result": null,
  "report": [
    "Сборки из чистого aea12a49; sourceHash оригинала и clone совпадает. Миграции дважды на отдельной SQLite-копии: исходные данные всех 30 таблиц неизменны, quick_check=ok."
  ]
}
