#!/bin/bash
# Включатель «Моста ИИ» на маке: агенты (Claude, Codex, Grok, Gemini, OpenCode, Cursor,
# Kimi, Codex внутри Neo3) выходят в сеть только с IP 45.86.61.144 через мост на VPS NL.
# Браузеры и остальной мак не трогаются: системный прокси и PAC здесь не ставятся никогда.
# Упал канал — агенты не запускаются (или не подключаются), интернет мака живёт.
# Повторный запуск безопасен. Выключить — off.sh рядом.
set -u
SRC="$(cd "$(dirname "$0")" && pwd)"
FORK="$(cd "$SRC/../.." && pwd)"
PREFIX="$HOME/.local/share/neo3-agent-proxy"
PORT=12809
PROXY="http://127.0.0.1:$PORT"
EXPECTED_IP=45.86.61.144
LABEL=com.dimasik.neo3-agent-tunnel
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SETTINGS="$HOME/.claude/settings.json"
say() { printf '%s\n' "$*"; }

# 1. Обёртки агентов + файлы моста (проверенный установщик).
python3 "$SRC/install.py" --sdk-root "$FORK" --proxy "$PROXY" --expected-ip "$EXPECTED_IP" || {
  say "ОШИБКА: установщик обёрток не отработал"; exit 1; }

# 2. Канал до VPS (LaunchAgent, поднимается после перезагрузки).
cp "$SRC/$LABEL.plist" "$PLIST.new" && mv "$PLIST.new" "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
launchctl bootstrap "gui/$(id -u)" "$PLIST" || { say "ОШИБКА: не запустился $LABEL"; exit 1; }
for _ in $(seq 1 30); do nc -z 127.0.0.1 "$PORT" 2>/dev/null && break; sleep 1; done
nc -z 127.0.0.1 "$PORT" 2>/dev/null && say "канал до VPS поднят (127.0.0.1:$PORT)" \
  || say "ВНИМАНИЕ: канал до VPS пока не поднялся — см. $PREFIX/tunnel.log"

# 3. Claude: прокси в настройках — страховка на случай, если автообновление снимет обёртку.
python3 - "$SETTINGS" "$PROXY" <<'EOF'
import json, os, shutil, sys, time
path, proxy = sys.argv[1], sys.argv[2]
with open(path, encoding='utf-8') as f:
    data = json.load(f)
want = {'HTTPS_PROXY': proxy, 'HTTP_PROXY': proxy,
        'NO_PROXY': 'localhost,127.0.0.1,::1,100.64.0.0/10,*.ts.net,.ts.net',
        'NODE_USE_ENV_PROXY': '1'}
env = data.get('env') or {}
if all(env.get(k) == v for k, v in want.items()):
    print('Claude: прокси в settings.json уже стоит')
else:
    shutil.copy2(path, f'{path}.bak-agent-proxy-{time.strftime("%Y%m%d-%H%M%S")}')
    env.update(want); data['env'] = env
    tmp = path + '.neo3-new'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False); f.write('\n')
    os.replace(tmp, path)
    print('Claude: прокси добавлен в settings.json (копия рядом)')
EOF

# 4. Системный прокси на порт моста — никогда (так 10.11 лёг весь интернет).
while IFS= read -r svc; do
  [ -z "$svc" ] && continue
  for kind in web secureweb; do
    if networksetup -get${kind}proxy "$svc" 2>/dev/null | grep -q "Port: $PORT"; then
      networksetup -set${kind}proxystate "$svc" off; networksetup -set${kind}proxy "$svc" "" 0 2>/dev/null
      say "выключен системный прокси ($kind) у «$svc»"
    fi
  done
done < <(networksetup -listallnetworkservices 2>/dev/null | tail -n +2 | sed 's/^\*//')

# 5. Проверка: обёртки, выход 45.86.61.144, доступность провайдеров.
python3 "$PREFIX/doctor.py" && say "Мост ИИ включён: агенты выходят с $EXPECTED_IP." \
  || { say "ВНИМАНИЕ: проверка не прошла — агенты не запустятся, пока канал не заработает. Интернет мака не затронут."; exit 2; }
