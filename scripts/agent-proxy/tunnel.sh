#!/bin/sh
# Канал агентов на маке: локальный 127.0.0.1:12809 -> мост на сервере, выход которого
# закреплён на 45.86.61.144. Идёт по SSH (TCP). Системный прокси мака не трогается.
# Запускается LaunchAgent com.dimasik.neo3-agent-tunnel; после выхода launchd поднимает снова.
#
# Пути — в routes.sh: сервер Мити (основной), затем свой VPS через Tailscale и напрямую.
# Режим — файл mode рядом: auto (по умолчанию, перебор всех путей), mitya, vps.
# Сторож: каждые 20 с проверяет выход через канал. Две неудачи подряд — путь считается
# зависшим, SSH убивается и берётся следующий путь. В auto на запасном пути раз в 30 мин
# проверяется основной — ожил, и канал возвращается на него.
# Файлы рядом: health (время последней удачной проверки, его читает run.sh),
# route (путь и с какого времени), switches.log (история смен пути).
PORT="${NEO3_AGENT_TUNNEL_PORT:-12809}"
DIR="$(cd "$(dirname "$0")" && pwd)"
HEALTH="$DIR/health"
EVERY="${NEO3_AGENT_TUNNEL_CHECK_SEC:-20}"
RETURN_SEC="${NEO3_AGENT_TUNNEL_RETURN_SEC:-1800}"
SSH="${NEO3_AGENT_TUNNEL_SSH:-/usr/bin/ssh}"
EXPECTED=45.86.61.144
[ -f "$DIR/proxy.env" ] && . "$DIR/proxy.env" && EXPECTED="${NEO3_AGENT_EXPECTED_IP:-$EXPECTED}"
NEO3_BRIDGE_ROUTES_FILE="$DIR/routes.sh"
. "$DIR/routes.sh"
# Агенты держат много соединений: у launchd по умолчанию 256 файлов, ssh упирался
# в «accept: Too many open files».
ulimit -n 8192 2>/dev/null || ulimit -n 4096 2>/dev/null || true

log() { echo "$(date '+%F %T') $*"; }
probe() {
  for url in https://api.ipify.org https://checkip.amazonaws.com; do
    ip=$(curl --fail --silent --connect-timeout 5 --max-time 8 --noproxy '' \
      --proxy "http://127.0.0.1:$PORT" "$url" 2>/dev/null | tr -d '[:space:]')
    [ "$ip" = "$EXPECTED" ] && return 0
  done
  return 1
}
mark_ok() { date +%s > "$HEALTH.tmp" && mv "$HEALTH.tmp" "$HEALTH"; }
read_mode() {
  m=$(cat "$DIR/mode" 2>/dev/null | tr -d '[:space:]')
  case "$m" in mitya|vps) echo "$m" ;; *) echo auto ;; esac
}
set_route() {  # $1 — имя пути; в историю пишется только смена
  prev=$(cut -d' ' -f1 "$DIR/route" 2>/dev/null)
  [ "$prev" = "$1" ] && return 0
  echo "$1 $(date +%s)" > "$DIR/route.tmp" && mv "$DIR/route.tmp" "$DIR/route"
  echo "$(date '+%F %T') $1" >> "$DIR/switches.log"
}
# Ожил ли путь: ssh на сервер и проверка выхода его моста (без смены канала).
route_alive() {
  # shellcheck disable=SC2046
  ip=$("$SSH" -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=yes \
    $(route_ssh_target "$1") \
    "curl --fail --silent --max-time 8 --proxy http://127.0.0.1:12809 https://api.ipify.org" \
    2>/dev/null | tr -d '[:space:]')
  [ "$ip" = "$EXPECTED" ]
}

pid=''
trap '[ -n "$pid" ] && kill "$pid" 2>/dev/null; rm -f "$HEALTH"; exit 0' TERM INT
rm -f "$HEALTH"

# Один путь: подключиться и сторожить. Код 2 — начать перебор сначала (основной ожил).
run_route() {
  r="$1"; first="$2"; mode="$3"
  log "подключаюсь: $(route_title "$r")"
  # shellcheck disable=SC2046
  "$SSH" -N -T \
    -o BatchMode=yes -o ExitOnForwardFailure=yes \
    -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
    -o StrictHostKeyChecking=yes \
    -L "127.0.0.1:$PORT:127.0.0.1:12809" $(route_ssh_target "$r") &
  pid=$!
  # Ждём, пока SSH откроет порт (до 20 с), неудачи до этого не считаются.
  n=0
  while [ $n -lt 20 ] && kill -0 "$pid" 2>/dev/null && ! nc -z 127.0.0.1 "$PORT" 2>/dev/null; do
    sleep 1; n=$((n + 1))
  done
  fails=0; up=0; since=$(date +%s); code=0
  while kill -0 "$pid" 2>/dev/null; do
    if probe; then
      mark_ok
      if [ "$up" = 0 ]; then
        log "канал работает: $(route_title "$r"), выход $EXPECTED"
        set_route "$r"
      fi
      up=1; fails=0
      if [ "$mode" = auto ] && [ "$r" != "$first" ] && \
         [ $(( $(date +%s) - since )) -ge "$RETURN_SEC" ]; then
        since=$(date +%s)
        if route_alive "$first"; then
          log "основной путь ($(route_title "$first")) ожил — возвращаюсь"
          code=2; break
        fi
      fi
      sleep "$EVERY"
    else
      rm -f "$HEALTH"
      fails=$((fails + 1))
      log "проверка выхода не прошла: $(route_title "$r") ($fails из 2)"
      [ "$fails" -ge 2 ] && { log "путь $(route_title "$r") завис — беру следующий"; break; }
      sleep "${NEO3_AGENT_TUNNEL_FAIL_SLEEP:-5}"
    fi
  done
  kill "$pid" 2>/dev/null; sleep 1
  kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  log "канал закрыт: $(route_title "$r")"
  rm -f "$HEALTH"; pid=''
  return "$code"
}

while :; do
  mode=$(read_mode)
  order=$(route_order "$mode")
  first=${order%% *}
  restart=0
  for r in $order; do
    run_route "$r" "$first" "$mode"
    [ $? = 2 ] && { restart=1; break; }
    # Сменили режим, пока шли по кругу, — начать с начала нового порядка.
    [ "$(read_mode)" != "$mode" ] && { restart=1; break; }
  done
  if [ "$restart" = 0 ]; then
    set_route none
    log "ни один путь не ответил (режим $mode) — пробую снова через 10 с"
    sleep "${NEO3_AGENT_TUNNEL_RETRY_SEC:-10}"
  fi
done
