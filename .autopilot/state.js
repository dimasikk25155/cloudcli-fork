window.STATE =
{
  "version": 2,
  "slug": "grokbot-powers",
  "dir": "2026-11-05-grokbot-powers--wip",
  "title": "Возможности Grok Bot — в Neo3",
  "mode": "full",
  "depth": "normal",
  "tier": "T2",
  "briefFile": "2026-11-05-brief.md",
  "memoryFile": "../CLAUDE.md",
  "memoryOwner": "user",
  "skillDir": "/Users/dimasik/.claude/skills/autopilot",
  "baseCommit": null,
  "startedAt": "2026-11-05T13:24:06+03:00",
  "updatedAt": "2026-11-05T13:34:45+03:00",
  "finishedAt": null,
  "stages": [
    {
      "id": "preflight",
      "status": "done",
      "startedAt": "2026-11-05T13:24:06+03:00",
      "finishedAt": "2026-11-05T13:24:39+03:00"
    },
    {
      "id": "manifest",
      "status": "done",
      "startedAt": "2026-11-05T13:24:39+03:00",
      "finishedAt": "2026-11-05T13:24:43+03:00"
    },
    {
      "id": "briefing",
      "status": "skipped",
      "startedAt": "2026-11-05T13:24:43+03:00",
      "finishedAt": "2026-11-05T13:24:58+03:00",
      "note": "полный автомат — самобрифинг"
    },
    {
      "id": "spec",
      "status": "done",
      "startedAt": "2026-11-05T13:25:02+03:00",
      "finishedAt": "2026-11-05T13:33:21+03:00"
    },
    {
      "id": "plan",
      "status": "active",
      "startedAt": "2026-11-05T13:33:21+03:00"
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
    "total": 10,
    "done": 0,
    "inTicket": 10,
    "inSpec": 0,
    "placeholder": 0,
    "deferred": 0,
    "dropped": 0
  },
  "tickets": [
    {
      "id": "01",
      "title": "Агенты: фундамент и сервер",
      "requirements": [
        "R01",
        "R02",
        "R04",
        "R06i",
        "R07i",
        "R08i",
        "R09i",
        "R10i"
      ],
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "shared/",
        "server/modules/database/",
        "server/modules/agents/",
        "server/modules/agent-run/",
        "server/modules/websocket/services/chat-websocket.service.ts",
        "server/index.js",
        "eslint.config.js"
      ],
      "review": "да — фундамент",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "02",
      "title": "Панель «Агенты» и штаб-команда",
      "requirements": [
        "R01",
        "R04",
        "R06i",
        "R07i",
        "R08i"
      ],
      "blockedBy": [
        "01"
      ],
      "wave": 2,
      "zone": [
        "src/components/agents/",
        "src/components/sidebar/",
        "server/threads-mcp.ts",
        "server/modules/threads/",
        "server/modules/agent-workspace/"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "03",
      "title": "Конвейер (сервер) и рутины с итогом",
      "requirements": [
        "R01",
        "R04",
        "R06i",
        "R07i",
        "R08i",
        "R09i"
      ],
      "blockedBy": [
        "01"
      ],
      "wave": 2,
      "zone": [
        "server/modules/agent-queue/",
        "server/modules/schedules/",
        "src/components/schedules/",
        "server/modules/notifications/",
        "server/index.js"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "04",
      "title": "Панель «Конвейер» и запрос ключа",
      "requirements": [
        "R01",
        "R04",
        "R07i",
        "R08i",
        "R10i"
      ],
      "blockedBy": [
        "02",
        "03"
      ],
      "wave": 3,
      "zone": [
        "src/components/agent-queue/",
        "src/components/sidebar/",
        "src/components/attention/",
        "server/modules/secret-requests/",
        "server/modules/agent-workspace/",
        "server/threads-mcp.ts",
        "server/modules/websocket/services/user-events.service.ts",
        "server/index.js",
        "public/sw.js"
      ],
      "review": "да — ключи и секреты",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "05",
      "title": "Разбор: Grok Bot в проектах и в Neo3",
      "requirements": [
        "R03",
        "R05i",
        "R01"
      ],
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "docs/grokbot-in-neo3.md",
        "/Users/dimasik/Antigravity Project/Dimasik-Obsidian/Dimasik/wiki/synthesis/grok-bot-v-neo3-2026-11-05.md"
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
      "«grok bot» = Grok Bot от xAI (x.ai/bot), «наш cli» = Neo3",
      "сборка в отдельном worktree claude agent/neo3-grokbot — в основной папке открыта сборка Safari",
      "выкатка на боевой Neo3 — только после твоего «да»",
      "9 возможностей Grok Bot не переношу (облачная VM, Routines по событию, Skills показом, групповой чат, бот создаёт ботов, генерация, плагины Cursor, клиенты): уже есть в Neo3 по-своему или не пригодились в проектах — причины в разборе"
    ],
    "emptyEnv": []
  },
  "additions": [],
  "coverage": {
    "found": 5,
    "fixed": 4,
    "deferred": 1,
    "items": [
      "R01 «все возможности» — 9 возможностей Grok Bot не переносятся (облачная VM, событийные Routines, Skills показом, групповой чат, бот создаёт ботов, генерация, плагины Cursor, клиенты); причины в «Вне рамок» и в разборе"
    ]
  },
  "concerns": [],
  "blind": null,
  "beats": [
    "2026-11-05T13:24:06+03:00",
    "2026-11-05T13:24:39+03:00",
    "2026-11-05T13:24:43+03:00",
    "2026-11-05T13:24:58+03:00",
    "2026-11-05T13:25:02+03:00",
    "2026-11-05T13:33:17+03:00",
    "2026-11-05T13:33:21+03:00",
    "2026-11-05T13:34:38+03:00",
    "2026-11-05T13:34:39+03:00",
    "2026-11-05T13:34:45+03:00"
  ],
  "rev": 17,
  "waiting": null,
  "waits": [],
  "log": [
    {
      "t": "2026-11-05T13:24:06+03:00",
      "k": "init"
    },
    {
      "t": "2026-11-05T13:24:39+03:00",
      "k": "stage",
      "id": "manifest",
      "act": "start"
    },
    {
      "t": "2026-11-05T13:24:43+03:00",
      "k": "stage",
      "id": "briefing",
      "act": "start"
    },
    {
      "t": "2026-11-05T13:24:58+03:00",
      "k": "add",
      "key": "debt.assumptions",
      "n": 3
    },
    {
      "t": "2026-11-05T13:24:58+03:00",
      "k": "stage",
      "id": "briefing",
      "act": "skip",
      "note": "полный автомат — самобрифинг"
    },
    {
      "t": "2026-11-05T13:25:02+03:00",
      "k": "gate",
      "g": "G1",
      "ok": false,
      "open": 10,
      "total": 10
    },
    {
      "t": "2026-11-05T13:25:02+03:00",
      "k": "stage",
      "id": "spec",
      "act": "start"
    },
    {
      "t": "2026-11-05T13:33:17+03:00",
      "k": "gate",
      "g": "G2",
      "ok": true,
      "found": 5,
      "fixed": 4,
      "deferred": 1
    },
    {
      "t": "2026-11-05T13:33:17+03:00",
      "k": "add",
      "key": "debt.assumptions",
      "n": 1
    },
    {
      "t": "2026-11-05T13:33:21+03:00",
      "k": "stage",
      "id": "plan",
      "act": "start"
    },
    {
      "t": "2026-11-05T13:34:38+03:00",
      "k": "tier",
      "v": "T2"
    },
    {
      "t": "2026-11-05T13:34:38+03:00",
      "k": "tickets",
      "n": 5
    },
    {
      "t": "2026-11-05T13:34:39+03:00",
      "k": "gate",
      "g": "G3",
      "ok": false,
      "problems": 1
    },
    {
      "t": "2026-11-05T13:34:45+03:00",
      "k": "tickets",
      "n": 5
    },
    {
      "t": "2026-11-05T13:34:45+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    }
  ],
  "reqList": [
    {
      "id": "R01",
      "text": "«потяни все возможности grok bot»",
      "status": "in-ticket"
    },
    {
      "id": "R02",
      "text": "«в наш cli»",
      "status": "in-ticket"
    },
    {
      "id": "R03",
      "text": "«тут много проектов где он мы дал пользу, пронализиуй»",
      "status": "in-ticket"
    },
    {
      "id": "R04",
      "text": "«сделай апгрейд»",
      "status": "in-ticket"
    },
    {
      "id": "R05i",
      "text": "(подразумевается) разбор лежит документом: где Grok Bot помог, какой возможностью, что из этого уже есть в Neo3, чего нет",
      "status": "in-ticket"
    },
    {
      "id": "R06i",
      "text": "(подразумевается) новое работает на всех трёх движках новых чатов (Claude, Codex, Grok), не только на одном",
      "status": "in-ticket"
    },
    {
      "id": "R07i",
      "text": "(подразумевается) каждая новая возможность — мод со своим выключателем",
      "status": "in-ticket"
    },
    {
      "id": "R08i",
      "text": "(подразумевается) только админ; тиммейты в песочнице прав не получают",
      "status": "in-ticket"
    },
    {
      "id": "R09i",
      "text": "(подразумевается) без платных API и перерасхода: только подписки, без on-demand",
      "status": "in-ticket"
    },
    {
      "id": "R10i",
      "text": "(подразумевается) боевой Neo3 не ломается: выкатка с откатом и только с согласия, второй чат / Safari / new-tab сохраняются",
      "status": "in-ticket"
    }
  ],
  "gates": {
    "G1": {
      "ok": false,
      "at": "2026-11-05T13:25:02+03:00",
      "open": 10,
      "total": 10
    },
    "G2": {
      "ok": true,
      "at": "2026-11-05T13:33:17+03:00",
      "found": 5,
      "fixed": 4,
      "deferred": 1
    },
    "G3": {
      "ok": true,
      "at": "2026-11-05T13:34:45+03:00",
      "problems": 0
    }
  },
  "result": null
}
