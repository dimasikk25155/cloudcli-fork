# Codex context and subscription limits

Status: implemented and verified in isolation; not applied to the running Neo3.

## Behavior

- The context chip continues to divide the latest occupied context by the selected
  model's catalog `contextWindow`. Runtime limits and cumulative spend remain
  separate. A draft can show 0%; missing occupancy shows an em dash.
- While viewing a running Codex chat, `useChatSessionState` reads its token-usage
  endpoint every five seconds. It also refreshes when the run stops. Polling uses
  the canonical `__provider`, preserves session/revision checks, and never reloads
  message history.
- The token-usage route prefers the indexed transcript path, including teammates'
  separate Codex homes and app/native session-id mappings. The reader scans the
  transcript backwards in chunks, stopping at the latest occupancy or compaction.
- Codex gets a separate subscription menu and store. A short-lived `codex app-server`
  process performs `initialize`, `initialized`, `account/rateLimits/read`, then
  closes. Requests share a 60-second cache. No prompts or threads are started.
- Actual quota-window durations are preserved. A weekly-only primary window is
  displayed as 7 days, without inventing a five-hour limit. The live account
  returned a weekly window at 5% used during verification.
- The menu shows utilization, reset time in Moscow, observation time, and a link
  to Codex usage. Failed reads clear the current snapshot. The panel fits narrow
  screens and closes on Escape or an outside click.
- Claude's usage guard no longer prompts before sending a Codex message.

RPC contract: https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt

## Verification

- Regression reproduced before the fix: an accessible indexed Codex transcript
  outside the main home returned HTTP 404 instead of its occupancy.
- Full suite: 1534 tests passed. Typecheck and isolated client/server builds passed.
- New/modified limits components and new modules pass targeted ESLint. Existing
  warnings remain in the larger chat files; no new lint errors.
- Shared headless Edge, isolated Vite harness using the actual session-state hook:
  fixture context changed from 100000/500000 (20%) to 200000/500000 (40%) without
  reloading, then changed to unknown. Real Codex RPC populated the weekly 5% menu
  and Moscow reset. The menu fit a 390px viewport.
- This verifies the hook, real quota RPC, parsers and protected budget route. It
  does not claim a newly deployed production chat was tested.
- Test server stopped and task-owned browser tab closed; Edge stopped.

## Apply boundary

The running `dist/` and `dist-server/` were not changed and Neo3 was not restarted.
Apply requires Dima's explicit deployment approval, per the existing project note.
After approval, preserve unrelated local edits, stage a recoverable release,
wait for active runs to finish, apply the matching client/server build, restart
`com.dimasik.neo3-local`, and verify the public UI and a live Codex chat. Commit
only this task's source changes as required by the parent project guidance.
