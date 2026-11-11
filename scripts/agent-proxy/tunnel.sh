#!/bin/sh
# Канал агентов на маке: локальный 127.0.0.1:12809 -> мост на VPS NL (127.0.0.1:12809),
# выход которого закреплён на 45.86.61.144. Идёт по SSH (TCP): сначала через Tailscale,
# если не вышло — через публичный адрес VPS. Системный прокси мака не трогается.
# Запускается LaunchAgent com.dimasik.neo3-agent-tunnel; после выхода launchd поднимает снова.
#
# Сторож: каждые 20 с проверяет выход через канал. Две неудачи подряд — канал считается
# зависшим (SSH жив, а трафик не идёт), процесс SSH убивается и берётся другой путь.
# Время последней удачной проверки — в файле health: по нему обёртка агентов стартует сразу.
PORT="${NEO3_AGENT_TUNNEL_PORT:-12809}"
KEY="${NEO3_AGENT_TUNNEL_KEY:-$HOME/.ssh/id_brand_vps}"
DIR="$(cd "$(dirname "$0")" && pwd)"
HEALTH="$DIR/health"
EVERY="${NEO3_AGENT_TUNNEL_CHECK_SEC:-20}"
EXPECTED=45.86.61.144
[ -f "$DIR/proxy.env" ] && . "$DIR/proxy.env" && EXPECTED="${NEO3_AGENT_EXPECTED_IP:-$EXPECTED}"

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

pid=''
trap '[ -n "$pid" ] && kill "$pid" 2>/dev/null; rm -f "$HEALTH"; exit 0' TERM INT
rm -f "$HEALTH"

for host in 100.75.69.57 185.166.154.209; do
  log "подключаюсь к VPS через $host"
  /usr/bin/ssh -N -T \
    -o BatchMode=yes -o ExitOnForwardFailure=yes \
    -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
    -o HostKeyAlias=185.166.154.209 -o StrictHostKeyChecking=yes \
    -i "$KEY" -L "127.0.0.1:$PORT:127.0.0.1:12809" "root@$host" &
  pid=$!
  # Ждём, пока SSH откроет порт (до 20 с), неудачи до этого не считаются.
  n=0
  while [ $n -lt 20 ] && kill -0 "$pid" 2>/dev/null && ! nc -z 127.0.0.1 "$PORT" 2>/dev/null; do
    sleep 1; n=$((n + 1))
  done
  fails=0; up=0
  while kill -0 "$pid" 2>/dev/null; do
    if probe; then
      mark_ok
      [ "$up" = 0 ] && log "канал работает через $host, выход $EXPECTED"
      up=1; fails=0; sleep "$EVERY"
    else
      rm -f "$HEALTH"
      fails=$((fails + 1))
      log "проверка выхода не прошла через $host ($fails из 2)"
      if [ "$fails" -ge 2 ]; then
        log "канал через $host завис — переподключаюсь"
        kill "$pid" 2>/dev/null; sleep 2
        kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
        break
      fi
      sleep 5
    fi
  done
  wait "$pid" 2>/dev/null
  log "канал через $host закрылся"
  rm -f "$HEALTH"; pid=''
done
sleep 5
