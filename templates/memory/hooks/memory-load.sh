#!/bin/bash
# SessionStart hook — loads the project's memory index into the session context.
#
# Part of the built-in project memory (see templates/memory/README.md). Installed
# by scripts/install-memory.sh. Claude Code picks the hook up because CloudCLI runs
# the SDK with settingSources ['project','user','local'] (server/claude-sdk.js).
#
# A hook must never break a client session: every unexpected condition exits 0.

set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0

input=$(cat)

project_dir=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$project_dir" ] || project_dir="${CLAUDE_PROJECT_DIR:-}"
[ -n "$project_dir" ] || exit 0
[ -d "$project_dir" ] || exit 0

# Never seed a memory folder outside a real project (home dir, filesystem root).
case "$project_dir" in
  "${HOME:-/nonexistent}" | "/" ) exit 0 ;;
esac

index="$project_dir/memory/INDEX.md"

if [ ! -f "$index" ]; then
  mkdir -p "$project_dir/memory" 2>/dev/null || exit 0
  cat > "$index" 2>/dev/null <<'SEED' || exit 0
# Память проекта

Оглавление. Одна строка = одна заметка из этой папки.
Формат: `- [Заголовок](файл.md) — о чём, одной фразой`

<!-- заметки появятся здесь -->
SEED
fi

# Cap the injected index so a long memory never eats the context window.
content=$(head -c 8000 "$index" 2>/dev/null)
[ -n "$content" ] || exit 0

jq -n --arg ctx "$content" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: ("Долгая память этого проекта — папка memory/ (обычные .md файлы). Ниже её оглавление. Перед нетривиальной работой открой относящиеся к задаче заметки; в конце запиши в память то, что пригодится в будущих сессиях.\n\n" + $ctx)
  }
}'
