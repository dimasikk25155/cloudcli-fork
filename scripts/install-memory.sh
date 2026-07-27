#!/bin/bash
# Installs the built-in project memory: auto-read of memory/INDEX.md at session
# start, auto-record reminder at session end. Plain .md files, no database.
#
#   install-memory.sh                 user scope  -> $HOME/.claude (all projects)
#   install-memory.sh <dir>           auto: $HOME -> user scope, else project scope
#   install-memory.sh <dir> project   force project scope (hooks live in <dir>/.claude)
#
# Idempotent: re-running refreshes the hook scripts and never duplicates entries
# in settings.json or CLAUDE.md.

set -euo pipefail

TARGET="${1:-$HOME}"
SCOPE="${2:-}"

if [ ! -d "$TARGET" ]; then
  echo "install-memory: target dir does not exist: $TARGET" >&2
  exit 1
fi
TARGET="$(cd "$TARGET" && pwd)"

if [ -z "$SCOPE" ]; then
  if [ "$TARGET" = "$HOME" ]; then SCOPE="user"; else SCOPE="project"; fi
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "install-memory: jq is required (apt install -y jq)" >&2
  exit 1
fi

SRC="$(cd "$(dirname "$0")/../templates/memory" && pwd)"
CLAUDE_DIR="$TARGET/.claude"
HOOKS_DIR="$CLAUDE_DIR/hooks"
SETTINGS="$CLAUDE_DIR/settings.json"

# User memory lives in ~/.claude/CLAUDE.md, project memory in <project>/CLAUDE.md.
if [ "$SCOPE" = "user" ]; then
  MEMORY_MD="$CLAUDE_DIR/CLAUDE.md"
else
  MEMORY_MD="$TARGET/CLAUDE.md"
fi

mkdir -p "$HOOKS_DIR"

install -m 0755 "$SRC/hooks/memory-load.sh" "$HOOKS_DIR/memory-load.sh"
install -m 0755 "$SRC/hooks/memory-save.sh" "$HOOKS_DIR/memory-save.sh"

# --- settings.json: merge our two hooks, keep whatever else is already there ---
BASE='{}'
if [ -s "$SETTINGS" ]; then
  if ! BASE="$(jq '.' "$SETTINGS" 2>/dev/null)"; then
    echo "install-memory: $SETTINGS is not valid JSON — fix or move it first" >&2
    exit 1
  fi
fi

TMP="$(mktemp)"
printf '%s' "$BASE" | jq \
  --arg load "$HOOKS_DIR/memory-load.sh" \
  --arg save "$HOOKS_DIR/memory-save.sh" '
  def prune(needle):
    map(.hooks |= map(select((.command // "") | contains(needle) | not)))
    | map(select(((.hooks // []) | length) > 0));
  .hooks = (.hooks // {})
  | .hooks.SessionStart = (((.hooks.SessionStart // []) | prune("memory-load.sh")) + [{hooks: [{type: "command", command: $load}]}])
  | .hooks.Stop = (((.hooks.Stop // []) | prune("memory-save.sh")) + [{hooks: [{type: "command", command: $save}]}])
' > "$TMP"

if [ ! -s "$TMP" ]; then
  rm -f "$TMP"
  echo "install-memory: failed to build settings.json" >&2
  exit 1
fi
mv "$TMP" "$SETTINGS"

# --- CLAUDE.md: append the protocol block once ---
if [ -f "$MEMORY_MD" ] && grep -q "CLOUDCLI-MEMORY:BEGIN" "$MEMORY_MD"; then
  : # already there
else
  mkdir -p "$(dirname "$MEMORY_MD")"
  if [ -s "$MEMORY_MD" ]; then printf '\n' >> "$MEMORY_MD"; fi
  cat "$SRC/CLAUDE-memory-block.md" >> "$MEMORY_MD"
fi

echo "==> memory installed ($SCOPE scope)"
echo "    hooks:    $HOOKS_DIR/memory-{load,save}.sh"
echo "    settings: $SETTINGS"
echo "    protocol: $MEMORY_MD"
