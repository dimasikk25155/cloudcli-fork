#!/bin/bash
# Stop hook — a session that changed something should also record why.
#
# Fires at most once per session (guard file), and only when the transcript shows
# real edits but no write into memory/. See templates/memory/README.md.
#
# A hook must never break a client session: every unexpected condition exits 0.

set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0

input=$(cat)

# Never loop: if this hook already forced a continuation, let the session end.
if [ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null)" = "true" ]; then
  exit 0
fi

sid=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
transcript=$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null)

if [ -z "$transcript" ] || [ ! -f "$transcript" ]; then
  exit 0
fi

guard="${TMPDIR:-/tmp}/cloudcli-memory-${sid:-nosession}"
[ -f "$guard" ] && exit 0

# Nothing was changed in this session -> nothing worth recording.
grep -qE '"name"[[:space:]]*:[[:space:]]*"(Edit|Write|NotebookEdit)"' "$transcript" || exit 0

# Memory already updated in this session -> done.
grep -qE '"file_path"[[:space:]]*:[[:space:]]*"[^"]*/memory/' "$transcript" && exit 0

touch "$guard" 2>/dev/null

jq -n '{
  decision: "block",
  reason: "В этой сессии менялись файлы, но в память проекта (папка memory/) ничего не записано. Оцени: было ли что-то, что пригодится в будущих сессиях — установка/настройка, баг и его причина, принятое решение и почему, как запускать и проверять? Если ДА — создай атомарную заметку в memory/ (одна заметка = один факт, имя kebab-case.md, только факты списками, без пересказа диалога) и добавь на неё строку в memory/INDEX.md. Секреты (пароли, токены, ключи) не писать — только ссылку на .env. Если правка была тривиальной (опечатка, отступ, косметика) — ничего не создавай, просто закончи."
}'
