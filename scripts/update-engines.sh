#!/usr/bin/env bash
# update-engines.sh — keep every coding-agent CLI current for the Neo3 Agent
# System (CloudCLI fork). Run nightly by launchd
# (com.dimasik.cloudcli-engine-update, 04:30); also safe to run by hand.
# The CLIs are spawned fresh per run, so no Neo3 restart is needed afterwards.
#
# Each engine is updated with its own official mechanism and logged. A failed
# engine never aborts the others. Logs: ~/.cloudcli/engine-update.log
set -u

# launchd hands us a minimal PATH — put node/npm (/usr/local or brew) and the
# standalone-installed CLIs (~/.local/bin) back so every tool resolves.
export PATH="${HOME}/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

LOG="${HOME}/.cloudcli/engine-update.log"
mkdir -p "$(dirname "$LOG")"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

log "=== engine update: start ==="

# Claude Code — standalone binary, self-updater.
if command -v claude >/dev/null 2>&1; then
  if claude update >>"$LOG" 2>&1; then
    log "claude   -> $(claude --version 2>/dev/null | awk '{print $1}')"
  else
    log "claude   -> UPDATE FAILED (see log)"
  fi
fi

# npm-global engines — reinstall @latest (no-op when already current).
for entry in "@openai/codex:codex" "opencode-ai:opencode"; do
  pkg="${entry%%:*}"; bin="${entry##*:}"
  command -v "$bin" >/dev/null 2>&1 || continue
  if npm install -g "${pkg}@latest" >>"$LOG" 2>&1; then
    log "${bin} -> $(${bin} --version 2>/dev/null | head -1)"
  else
    log "${bin} -> UPDATE FAILED (see log)"
  fi
done

# Grok Build — standalone binary, self-updater (`grok update` is a no-op when
# current). 22.09.2026: it sat on 1.0.25 for three weeks while 4.7 shipped —
# this line is why the model picker now follows the CLI instead of the code.
if command -v grok >/dev/null 2>&1; then
  if grok update >>"$LOG" 2>&1; then
    log "grok     -> $(grok --version 2>/dev/null | awk '{print $2}')"
  else
    log "grok     -> UPDATE FAILED (see log)"
  fi
fi

# Cursor Agent — official installer is idempotent and updates in place.
if command -v cursor-agent >/dev/null 2>&1; then
  if curl https://cursor.com/install -fsS 2>>"$LOG" | bash >>"$LOG" 2>&1; then
    log "cursor-agent -> $(cursor-agent --version 2>/dev/null | head -1)"
  else
    log "cursor-agent -> UPDATE FAILED (see log)"
  fi
fi

# Kimi Code — installed via its own installer; no unattended update here (the
# installer URL/flow can change and the account may be inactive). Just report.
if [ -x "${HOME}/.kimi-code/bin/kimi" ]; then
  log "kimi     -> present $("${HOME}/.kimi-code/bin/kimi" --version 2>/dev/null | head -1) (manual installer update only)"
fi

log "=== engine update: done ==="
