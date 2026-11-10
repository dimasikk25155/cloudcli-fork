#!/bin/bash
# Выключатель «Моста ИИ» (neo3-agent-proxy) на маке.
# Снимает всё, что мост ставил: автозапуск, процессы, обёртки вокруг агентов,
# системный прокси 127.0.0.1:12809 и PAC в Firefox. Повторный запуск безопасен.
# Ничего не удаляет насовсем: снятое кладётся в папку копии (см. BACKUP ниже).
# После этого агенты ходят в сеть так же, как весь мак (например, через Happ).
set -u

PROXY_PORT=12809
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${NEO3_PROXY_OFF_BACKUP:-$HOME/.cloudcli/maintenance/agent-proxy-off-$STAMP}"
UID_N="$(id -u)"
LABELS=(com.dimasik.neo3-agent-tunnel com.dimasik.neo3-agent-hysteria ru.neo3.home-direct ru.neo3.stake-tunnel)
changed=0

mkdir -p "$BACKUP/launchagents" "$BACKUP/wrappers" "$BACKUP/firefox" "$BACKUP/apps"
say() { printf '%s\n' "$*"; }

# 1. Автозапуск и процессы.
for label in "${LABELS[@]}"; do
  plist="$HOME/Library/LaunchAgents/$label.plist"
  if launchctl print "gui/$UID_N/$label" >/dev/null 2>&1; then
    launchctl bootout "gui/$UID_N/$label" 2>/dev/null || true
    say "остановлен автозапуск: $label"; changed=1
  fi
  if [ -f "$plist" ]; then
    mv "$plist" "$BACKUP/launchagents/"
    say "убран файл автозапуска: $label.plist"; changed=1
  fi
done
pids="$(pgrep -f '/\.local/share/neo3-agent-proxy/|neo3-agent-transport-|/\.local/share/neo3-home-direct/' || true)"
if [ -n "$pids" ]; then
  kill $pids 2>/dev/null; sleep 1; kill -9 $pids 2>/dev/null || true
  say "остановлены процессы моста: $(echo $pids)"; changed=1
fi

# 2. Обёртки: на месте агента лежит скрипт моста, настоящая программа — рядом с суффиксом .neo3-direct.
restore_wrapper() {
  local w="$1" direct="$1.neo3-direct" key
  head -c 200 "$w" 2>/dev/null | grep -q 'neo3-agent-proxy wrapper' || return 0
  if [ ! -e "$direct" ] && [ ! -L "$direct" ]; then
    say "ВНИМАНИЕ: обёртка без настоящей программы рядом, не трогаю: $w"; return 0
  fi
  key="$(printf '%s' "$w" | sed 's#/#__#g')"
  cp -p "$w" "$BACKUP/wrappers/$key"
  if [ -L "$direct" ]; then
    ln -sfn "$(readlink "$direct")" "$w" && rm "$direct"
  else
    mv -f "$direct" "$w"
  fi
  say "вернул настоящую программу: $w"; changed=1
}
search_dirs=(/usr/local/bin /opt/homebrew/bin "$HOME/.local/bin" "$HOME/.kimi-code/bin" "$HOME/.grok/bin" "$HOME/.local/share/claude")
while IFS= read -r -d '' d; do restore_wrapper "${d%.neo3-direct}"; done < <(
  find "${search_dirs[@]}" -maxdepth 3 -name '*.neo3-direct' -print0 2>/dev/null)
while IFS= read -r -d '' w; do restore_wrapper "$w"; done < <(
  find "$HOME/Antigravity Project/claude agent" -maxdepth 9 \
    -path '*/node_modules/@openai/codex-darwin-*/vendor/*/bin/codex' -print0 2>/dev/null)

# 3. Системный прокси: выключаем только тот, что смотрит на порт моста.
while IFS= read -r svc; do
  [ -z "$svc" ] && continue
  for kind in web secureweb; do
    info="$(networksetup -get${kind}proxy "$svc" 2>/dev/null)"
    if printf '%s' "$info" | grep -q "Port: $PROXY_PORT"; then
      networksetup -set${kind}proxystate "$svc" off && networksetup -set${kind}proxy "$svc" "" 0 2>/dev/null
      say "выключен системный прокси ($kind) у «$svc»"; changed=1
    fi
  done
done < <(networksetup -listallnetworkservices 2>/dev/null | tail -n +2 | sed 's/^\*//')

# 4. Firefox: строки PAC моста в user.js применялись при каждом запуске.
for uj in "$HOME/Library/Application Support/Firefox/Profiles"/*/user.js; do
  [ -f "$uj" ] || continue
  grep -q 'neo3-stake\|neo3-agent-proxy' "$uj" || continue
  prof="$(basename "$(dirname "$uj")")"
  cp -p "$uj" "$BACKUP/firefox/$prof.user.js"
  grep -v -e 'neo3-stake' -e 'neo3-agent-proxy' -e '"network.proxy.type"' "$uj" > "$uj.tmp" && mv "$uj.tmp" "$uj"
  say "Firefox ($prof): убраны строки PAC из user.js"; changed=1
done

# 4б. Claude: прокси моста в ~/.claude/settings.json (ставит on.sh) — без канала Claude не подключится.
settings="$HOME/.claude/settings.json"
if [ -f "$settings" ] && grep -q "127.0.0.1:$PROXY_PORT" "$settings"; then
  cp -p "$settings" "$BACKUP/claude-settings.json"
  python3 - "$settings" "$PROXY_PORT" <<'EOF'
import json, os, sys
path, port = sys.argv[1], sys.argv[2]
data = json.load(open(path, encoding='utf-8'))
env = data.get('env') or {}
if f'127.0.0.1:{port}' in str(env.get('HTTPS_PROXY', '')) + str(env.get('HTTP_PROXY', '')):
    for k in ('HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'NODE_USE_ENV_PROXY'):
        env.pop(k, None)
    data['env'] = env
    tmp = path + '.neo3-new'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False); f.write('\n')
    os.replace(tmp, path)
EOF
  say "Claude: прокси моста убран из settings.json"; changed=1
fi

# 5. Пульт «Резервный мост ИИ» — он умеет включить мост обратно.
for app in "$HOME/Applications"/*мост*ИИ*.app "$HOME/Desktop"/*мост*ИИ*; do
  [ -e "$app" ] || [ -L "$app" ] || continue
  mv "$app" "$BACKUP/apps/"
  say "убран пульт моста: $app"; changed=1
done

if [ "$changed" = 1 ]; then
  say "Готово. Копия снятого: $BACKUP"
else
  rmdir "$BACKUP"/* "$BACKUP" 2>/dev/null
  say "Мост уже выключен — менять нечего."
fi
