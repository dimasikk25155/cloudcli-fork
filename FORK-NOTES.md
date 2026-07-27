# Fork notes (dima/fork-customizations)

This checkout is a customized fork of [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui).
All work lives on the branch **`dima/fork-customizations`**; local `main` mirrors upstream.

- `origin` → upstream siteboon (fetch/merge only — never push)
- `backup` → https://github.com/dimasikk25155/cloudcli-fork (private; push after every change batch)

## Why the in-app update is disabled

The stock updater (`POST /api/system/update`) runs `git checkout main && git pull && npm install`,
which abandons this branch and pulls upstream over the customizations. The endpoint now returns
501 in git mode and the sidebar update banner / upgrade modal were removed. Version info is still
visible in Settings → About.

## Manual upstream merge runbook

```bash
cd cloudcli-fork
git fetch origin
git switch -c dima/merge-upstream   # work on a throwaway branch; keep the
                                     # deployed branch as a fallback until green
git merge origin/main
# resolve conflicts, then:
npm install --ignore-scripts        # see "npm install / ripgrep gotcha" below
npm rebuild better-sqlite3          # native addon, skipped by --ignore-scripts
npm run typecheck && npm run build
# smoke on 3002 with a temp HOME so prod's ~/.cloudcli stays untouched:
#   HOME=$(mktemp -d) HOST=127.0.0.1 PORT=3002 SERVER_PORT=3002 \
#   WORKSPACES_ROOT=$HOME/projects node dist-server/server/index.js
# then fast-forward the deployed branch and restart:
git switch dima/fork-customizations && git merge --ff-only dima/merge-upstream
launchctl kickstart -k gui/$(id -u)/com.dimasik.cloudcli
git push backup dima/fork-customizations
```

### npm install / ripgrep gotcha (bites every merge)
`npm install` runs `@vscode/ripgrep`'s postinstall, which downloads the `rg`
binary from GitHub releases — this **403s on Dima's network** (DNS filtering) and
aborts the whole install. Workaround: `npm install --ignore-scripts`, then
restore the two things `--ignore-scripts` skipped:
- `npm rebuild better-sqlite3` (native addon; without it the server crashes on boot).
- ripgrep binary: `cp /opt/homebrew/bin/rg node_modules/@vscode/ripgrep/bin/rg`
  (the search-across-sessions feature spawns `rgPath`; system rg 15.x is CLI-compatible).
  Without it the server still boots but session search throws `spawn ENOENT` at use.

Known conflict hotspots vs our deltas: `useChatComposerState.ts`, `MessageComponent.tsx`,
`useChatMessages.ts`, `SidebarSessionItem.tsx`, `claude-sdk.js` /
`claude-sessions.provider.ts` (image handling), and `chat.json` across all 10 locales.
The old `/api/projects/:id/upload-images` endpoint is gone — chat image uploads
moved upstream to `POST /api/assets/images` (`server/modules/assets`).

### Merge history
- **2026-07-11**: merged origin/main → **v1.36.1**. Brought upstream's queued-message
  feature (type while a turn runs → message is stashed and auto-sent when it finishes,
  instead of only offering Stop). Fork's temp-file image work was superseded by
  upstream's native-image-block + `~/.cloudcli/assets` approach; the Android
  MIME-by-extension fallback was ported into the new assets service.

## Intentional fork deltas

- Branding: "Claude CLI" naming, Claude palette, crab mascot, regenerated icons/PWA assets
- Removed: project/session delete buttons, Discord/report/star links, conversations mode,
  update banner + upgrade modal (see above)
- Keychain auth provider for Claude credentials (macOS)
- Session rename fixes (web UI + custom-title sync from jsonl)
- Sidebar search across session names/summaries
- Image upload MIME fallback by extension (Android WebView)
- Nightshift module: `/api/nightshift` + "Запуски" modal (launchd runs history)
- TWA: Digital Asset Links served for the Android app
- Composer model switcher + per-session override keyed by provider-native id
- Held-open prompt stream (`claude-sdk.js`): the SDK prompt is always a
  streaming generator that stays pending until the CLI reports
  `session_state_changed: idle` (enabled via `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1`
  in the subprocess env). Upstream's one-shot prompt lets the SDK close the
  CLI's stdin at the first `result`; background-task turns that follow then
  lose the control channel, so AskUserQuestion/ExitPlanMode fail instantly
  with "Tool permission request failed: Error: Stream closed". Requires a CLI
  that emits session-state events (verified on 2.1.207).
- Built-in project memory (`templates/memory/` + `scripts/install-memory.sh`, wired
  into `install.sh`): SessionStart hook injects `<project>/memory/INDEX.md`, Stop hook
  forces a write-up when a session changed files but recorded nothing. Plain `.md`
  files in the client's repo, no database. Pure configuration — no fork code involved,
  it rides on the SDK's existing `settingSources: ['project','user','local']`.
- Idle-fallback safety net for the held-open stream (`claude-sdk.js`): if
  `idle` never arrives, sustained post-`result` silence releases the input so
  the run terminates instead of hanging forever — 60s when the CLI has emitted
  no session-state events at all (version drift: the event will never come),
  30min otherwise (background agents may be quietly working). A pending
  permission/question prompt counts as activity and resets the clock, so a
  user taking hours to answer never trips it. Tunable via
  `CLAUDE_IDLE_FALLBACK_NO_STATE_EVENTS_MS` / `CLAUDE_IDLE_FALLBACK_SILENCE_MS`.

## Freeze-proofing (2026-07-12)

The "chat freezes mid-run until you poke it" bug class. Root cause: a
half-open websocket (mobile sleep, network blip) never fires `onclose` — the
client keeps a stale view while the server finishes the run into the void.
Layered fixes:

- Client stall watchdog (`src/components/chat/hooks/useConnectionWatchdog.ts`,
  wired in `ChatInterface`): while a run is processing, 30s without a single
  WS frame forces a reconnect through the existing `websocket_reconnected`
  catch-up path; `visibilitychange`/`online` re-sync immediately on tab wake.
- Server pong reaping (`websocket-server.service.ts`): pings now track pongs;
  a socket that misses one 30s cycle is `terminate()`d instead of being fed
  events forever.
- Completed-run tail refetch (`useChatRealtimeHandlers.ts`): the
  `chat_subscribed` idle ack compares server `lastSeq` with the last seq seen
  live; on a gap the client re-fetches history (completed runs are never
  replayed over WS by design).
- Idle-fallback safety net (see fork deltas above) — insurance against a run
  hanging forever.

## Deploy

**Always via `./deploy.sh`.** It builds client+server, restarts launchd
`com.dimasik.cloudcli`, and smoke-checks that all three layers serve the SAME
bundle: `dist/index.html` == Mac origin (`http://<tailscale-ip>:3001`) ==
prod edge (`https://claude.neo3.ru`, checked FROM the VPS — the domain is
unreachable from this Mac's own network). Red smoke means the deploy did not
happen. History: before this script, sessions kept rebuilding only the server
or restarting without rebuilding the client, so prod served a stale `dist/`
for days while git said everything shipped.

## 2026-07-23 — Interactive tools fixed: AskUserQuestion Stream closed + ExitPlanMode on Kimi

**Symptom 1:** `AskUserQuestion` panel rendered, answer failed with
`Tool permission request failed: AbortError: Stream closed`. Root cause: race —
the CLI emits `session_state_changed: idle` BEFORE its can-use-tool control
request registers the pending approval, so the pending-approval guard saw 0 and
`releaseInput()` closed stdin mid-question. Fix in `server/claude-sdk.js`:
debounced release (`RELEASE_GRACE_MS`, default 3s, env-overridable) — on idle,
re-check `inputReleased` / newer stream activity / pending approvals at fire
time before really releasing.

**Symptom 2:** Kimi in plan mode could not call `ExitPlanMode` (tried
`Skill("ExitPlanMode")`, then looped on `Bash: true` claiming to load it via
ToolSearch). Root cause: CLI 2.1.218 defers built-in tools with
`shouldDefer: true` (ExitPlanMode is one) behind ToolSearch; Kimi can't operate
ToolSearch. Fix (no deploy needed, applies per spawned CLI):
`tengu_non_deferrable_builtins: ["ExitPlanMode","AskUserQuestion"]` in
`~/.claude.json` (flat array = all models; per-model map also supported).
Verified with `scripts/probe-tools.mjs`: `deferredBuiltinTools: []`,
ExitPlanMode PRESENT, and Kimi actually calls it. MCP deferral untouched
(telegram/playwright stay lazy; obsidian-dimasik stays alwaysLoad).
Caveat: `~/.claude.json` is rewritten by running CLI sessions — if the key
vanishes, re-apply it. The settings.json key `non_deferrable_builtins` does NOT
exist (schema rejects it) — only the tengu key in `~/.claude.json` works.
Note: the snake_case `exit_plan_mode` entry in plan-mode `allowedTools` is a
load-bearing typo — an exact `ExitPlanMode` match would auto-allow the tool and
skip the plan-approval panel. Do not "fix" it.
