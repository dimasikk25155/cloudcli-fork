#!/bin/bash
# «Починить мост» — одна кнопка для Димы, когда агенты пишут «Agent blocked».
# 1) мост работает — так и говорит; 2) перезапускает канал на маке;
# 3) перезапускает мост на VPS NL; 4) говорит, лёг ли сам VPS.
# Системный прокси мака, Happ и браузеры не трогает. Мост в обход не выключает.
set -u
DIR="$HOME/.local/share/neo3-agent-proxy"
LABEL="${NEO3_FIX_LABEL:-com.dimasik.neo3-agent-tunnel}"
PORT="${NEO3_FIX_PORT:-12809}"
EXPECTED=45.86.61.144
[ -f "$DIR/proxy.env" ] && . "$DIR/proxy.env" && EXPECTED="${NEO3_AGENT_EXPECTED_IP:-$EXPECTED}"
KEY="$HOME/.ssh/id_brand_vps"
ON="$HOME/Antigravity Project/claude agent/cloudcli-fork/scripts/agent-proxy/on.sh"
OFF="$HOME/Antigravity Project/claude agent/cloudcli-fork/scripts/agent-proxy/off.sh"

say() { printf '%s\n' "$*"; }
finish() { say; read -r -n 1 -s -p "Нажми любую клавишу, чтобы закрыть окно." _; say; exit "$1"; }
exit_ok() {
  for url in https://api.ipify.org https://checkip.amazonaws.com; do
    ip=$(curl --fail --silent --connect-timeout 5 --max-time 8 --noproxy '' \
      --proxy "http://127.0.0.1:$PORT" "$url" 2>/dev/null | tr -d '[:space:]')
    [ "$ip" = "$EXPECTED" ] && return 0
  done
  return 1
}
wait_ok() {  # до $1 секунд ждём, пока канал заработает
  local end=$(( $(date +%s) + $1 ))
  while [ "$(date +%s)" -lt "$end" ]; do exit_ok && return 0; sleep 3; done
  return 1
}
vps() {  # команда на VPS: через Tailscale, потом через публичный адрес
  for host in 100.75.69.57 185.166.154.209; do
    /usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=10 -o HostKeyAlias=185.166.154.209 \
      -o StrictHostKeyChecking=yes -i "$KEY" "root@$host" "$@" 2>/dev/null && return 0
  done
  return 1
}

say "Проверяю мост ИИ…"
if ! launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  say "Мост выключен (его снимали off.sh). Включаю обратно…"
  "$ON" | tail -1
  if wait_ok 30; then say "✅ Мост включён: агенты выходят с $EXPECTED."; finish 0; fi
fi

if exit_ok; then
  say "✅ Мост работает: агенты выходят с $EXPECTED. Чинить нечего."
  finish 0
fi

say "Шаг 1. Перезапускаю канал на маке…"
launchctl kickstart -k "gui/$(id -u)/$LABEL"
if wait_ok 40; then say "✅ Починил: канал перезапущен, выход $EXPECTED."; finish 0; fi

say "Шаг 2. Перезапускаю мост на VPS NL…"
if ! vps systemctl restart neo3-agent-hysteria; then
  say
  say "❌ VPS NL не отвечает — лёг сам сервер, с мака его не починить."
  say "   Интернет, браузеры и Telegram работают как обычно."
  say "   Агенты постоят, пока VPS не вернётся. Нажми эту иконку ещё раз позже."
  say
  say "   Если работать надо прямо сейчас (агенты пойдут с другого IP —"
  say "   риск для общей с Митей подписки), выключи мост на время:"
  say "   \"$OFF\""
  say "   Потом вернуть — эта же иконка."
  finish 1
fi
sleep 3
launchctl kickstart -k "gui/$(id -u)/$LABEL"
if wait_ok 40; then say "✅ Починил: мост на VPS перезапущен, выход $EXPECTED."; finish 0; fi

say
say "❌ VPS отвечает, но выход $EXPECTED не появился. Последние строки журнала:"
tail -5 "$DIR/tunnel.log"
say
say "Пришли этот экран агенту, когда он снова заработает, или запусти мост позже."
finish 1
