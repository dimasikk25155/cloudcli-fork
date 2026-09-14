#!/usr/bin/env bash
# Перезапуск neo3.service ПОСЛЕ того, как текущий ответ ушёл Диме.
#
# Агент — ребёнок сервиса. `systemctl restart neo3` убивает и его, и соседние чаты.
# Старый деплой делал `sleep 20` и рестартил вслепую: агент ещё дописывал отчёт
# (или Grok вообще не считался «живым прогоном», потому что у него другой флаг
# --output-format) → чат обрывался, Дима толкал, деплой повторялся.
#
# Здесь: никаких угаданных 20 секунд. Ждём, пока не останется агентских CLI,
# короткая пауза на доставку, потом рестарт и проверка, что корень снова 200.
set -u

SERVICE="${SERVICE:-neo3}"
ORIGIN_URL="${ORIGIN_URL:-http://127.0.0.1:3001/}"
LOG="${RESTART_LOG:-/tmp/neo3-deploy.log}"
# After idle: let the last websocket frame land before we pull the process down.
FLUSH_SEC="${1:-5}"
MAX_IDLE_WAIT="${2:-180}"

count_agents() {
  # Claude Code: --output-format stream-json
  # Grok Build:  --output-format streaming-messages-json  AND  ~/.grok/bin/grok
  # Do not match this script (the pattern strings live in our source).
  pgrep -af '/.grok/bin/grok|--output-format stream-json|--output-format streaming-messages-json|claude-agent-sdk' 2>/dev/null \
    | grep -v 'restart-after-reply' \
    | grep -v 'pgrep -af' \
    | grep -v "neo3-restart-after" \
    | wc -l | tr -d ' '
}

{
  echo "[$(date '+%F %T')] жду тишины в чатах (потолок ${MAX_IDLE_WAIT}с), потом рестарт $SERVICE${LOCAL_BUNDLE:+, bundle $LOCAL_BUNDLE}"
  waited=0
  while true; do
    active=$(count_agents)
    if [ "${active:-0}" = "0" ]; then
      echo "[$(date '+%F %T')] активных агентов нет — жду ${FLUSH_SEC}с на доставку ответа"
      sleep "$FLUSH_SEC"
      break
    fi
    if [ "$waited" -ge "$MAX_IDLE_WAIT" ]; then
      echo "[$(date '+%F %T')] ПРОПУСК: ${active} агент(ов) всё ещё живы после ${MAX_IDLE_WAIT}с — рестарт отменён"
      exit 2
    fi
    echo "[$(date '+%F %T')] жду простоя: активных=${active}, прошло ${waited}с / ${MAX_IDLE_WAIT}с"
    sleep 5
    waited=$((waited + 5))
  done

  echo "[$(date '+%F %T')] restarting $SERVICE${LOCAL_BUNDLE:+ for bundle $LOCAL_BUNDLE}"
  sudo -n systemctl restart "$SERVICE"

  for _ in $(seq 1 30); do
    sleep 2
    served=$(curl -s --max-time 5 "$ORIGIN_URL" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)
    if [ -n "${LOCAL_BUNDLE:-}" ]; then
      if [ "$served" = "$LOCAL_BUNDLE" ]; then
        if [ -n "${SERVER_NOW:-}" ] && [ -n "${SERVER_STAMP:-}" ]; then
          echo "$SERVER_NOW" > "$SERVER_STAMP"
        fi
        echo "[$(date '+%F %T')] ✅ back up, serving $served"
        exit 0
      fi
    else
      code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$ORIGIN_URL" || true)
      if [ "$code" = "200" ]; then
        echo "[$(date '+%F %T')] ✅ back up, HTTP $code"
        exit 0
      fi
    fi
  done

  echo "[$(date '+%F %T')] ❌ did not come back${LOCAL_BUNDLE:+ on $LOCAL_BUNDLE} — last 40 log lines:"
  journalctl -u "$SERVICE" --no-pager | tail -40
  exit 1
} >> "$LOG" 2>&1
