# Built-in project memory

Long-term memory for every client project: plain `.md` files in the project's own
`memory/` folder. **No database, no extra service, no vendor** — the notes are just
files in the client's git repo, readable in any editor (Obsidian included, but it is
not required and not involved).

Two hooks make it automatic instead of relying on the model to remember:

| Hook | Event | What it does |
|---|---|---|
| `memory-load.sh` | `SessionStart` | Injects `<project>/memory/INDEX.md` into the session context. Creates the folder + a seed index on first run. |
| `memory-save.sh` | `Stop` | If the session edited files but wrote nothing into `memory/`, blocks the stop once and tells the model to record what is worth keeping. |

`CLAUDE-memory-block.md` is the protocol the model follows (what to record, how to
write a note, no secrets). The installer appends it to `CLAUDE.md` inside a
`CLOUDCLI-MEMORY:BEGIN/END` marker so a re-run never duplicates it.

## Install

```bash
scripts/install-memory.sh                       # user scope: $HOME/.claude — all projects
scripts/install-memory.sh /home/cloudcli user   # what install.sh runs on a client VPS
scripts/install-memory.sh /path/to/project project
```

Idempotent — re-running refreshes the hook scripts and never duplicates settings
entries. Requires `jq` (already in `install.sh`'s base packages).

**User scope is the default for clients**: hooks live once in `/home/cloudcli/.claude`,
and every project the client creates later is covered automatically, while the notes
themselves stay in each project's own repo.

Existing client VPS boxes provisioned before this feature do not have it — run
`cd ~/cloudcli && bash scripts/install-memory.sh /home/cloudcli user` as the
`cloudcli` user, no rebuild or restart needed (hooks are read per session).

## Why hooks and not just an instruction

An instruction in `CLAUDE.md` only works when the model chooses to follow it. Hooks are
executed by the engine itself, so loading the index and demanding a write-up are
deterministic. What stays with the model is judging *what* is worth recording — the
`Stop` hook explicitly tells it to skip trivial edits, so cosmetic changes don't
generate junk notes.

Nothing in the fork's own code is involved: CloudCLI already runs the SDK with
`settingSources: ['project','user','local']` (`server/claude-sdk.js`), so Claude Code
reads these settings, hooks and `CLAUDE.md` from the client's box on its own.

## Safety

Hooks must never break a client session: both scripts exit 0 on anything unexpected
(no `jq`, no transcript, unreadable dir). `memory-save.sh` fires at most once per
session (guard file in `TMPDIR`) and bails out when `stop_hook_active` is set, so it
cannot loop.

Verified end-to-end 2026-07-26 on a live headless session: index injected, protocol
delivered, `Stop` fired, and the model wrote `memory/port-3100.md` + an `INDEX.md` line
on its own — while correctly refusing to write a note for a trivial one-line change.
