#!/bin/bash
# «Починить мост» — иконка для Димы, когда агенты пишут «Agent blocked».
# Вся логика — в bridge.py fix: перезапуск канала, перебор путей (сервер Мити, свой VPS),
# перезапуск мостов на серверах. Системный прокси мака, Happ и браузеры не трогает.
set -u
DIR="$HOME/.local/share/neo3-agent-proxy"
BRIDGE="$DIR/bridge.py"
[ -f "$BRIDGE" ] || BRIDGE="$(cd "$(dirname "$0")" && pwd)/bridge.py"
echo "Проверяю мост ИИ…"
/usr/bin/python3 "$BRIDGE" fix
code=$?
echo
/usr/bin/python3 "$BRIDGE" status
echo
read -r -n 1 -s -p "Нажми любую клавишу, чтобы закрыть окно." _
echo
exit "$code"
