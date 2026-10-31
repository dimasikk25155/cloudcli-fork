#!/usr/bin/env bash
# Public, account-independent updater for an existing Linux Neo3 service.
# Usage: sudo bash upgrade-neo3.sh [--check] [--skip-engine]
# Override SERVICE / APP_DIR only for a nonstandard installation.
set -euo pipefail
umask 077
SERVICE="${SERVICE:-cloudcli}"
REF="${NEO3_REF:-dima/fork-customizations}"
REPO=https://github.com/dimasikk25155/cloudcli-fork.git
CHECK=0
ENGINE=1
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    --skip-engine) ENGINE=0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done
fail() { echo "Ошибка: $*" >&2; exit 1; }
[[ "$(uname -s)" == Linux ]] || fail 'Этот обновлятор предназначен для Linux VPS с systemd.'
[[ "$(id -u)" == 0 ]] || fail 'Запусти через sudo bash.'
[[ "$SERVICE" =~ ^[a-zA-Z0-9_.@-]+$ ]] || fail 'Недопустимое имя службы.'
for command in git node npm python3 curl runuser systemctl; do
  command -v "$command" >/dev/null || fail "Не найдена команда $command"
done
[[ "$(systemctl show "$SERVICE" -p LoadState --value)" == loaded ]] || fail "Служба $SERVICE не найдена."
APP_USER="$(systemctl show "$SERVICE" -p User --value)"
[[ -n "$APP_USER" && "$APP_USER" != root ]] || fail 'Нужна служба с отдельным непривилегированным пользователем.'
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
[[ -d "$APP_HOME" && "$APP_HOME" != / ]] || fail 'Не найден домашний каталог владельца службы.'
APP_DIR="${APP_DIR:-$(systemctl show "$SERVICE" -p WorkingDirectory --value)}"
[[ -n "$APP_DIR" && "$APP_DIR" == "$APP_HOME/"* && -f "$APP_DIR/package.json" ]] || fail 'Не удалось определить каталог Neo3. Задай APP_DIR=/home/пользователь/cloudcli.'
[[ "$APP_DIR" != "$APP_HOME/.claude" && "$APP_DIR" != "$APP_HOME/.codex" && "$APP_DIR" != "$APP_HOME/.cloudcli" ]] || fail 'Каталог состояния нельзя использовать как каталог приложения.'
NODE_VERSION="$(node -p 'Number(process.versions.node.split(".")[0])')"
[[ "$NODE_VERSION" -ge 22 ]] || fail 'Нужен Node.js 22 или новее.'
as_app() { runuser -u "$APP_USER" -- env HOME="$APP_HOME" PATH="$APP_HOME/.local/bin:$APP_HOME/.npm-global/bin:$PATH" "$@"; }
REMOTE="$(git ls-remote "$REPO" "refs/heads/$REF" | awk '{print $1}')"
[[ "$REMOTE" =~ ^[a-f0-9]{40}$ ]] || fail 'Не удалось проверить опубликованную версию.'
echo "Neo3: опубликован $REMOTE; пользователь $APP_USER; каталог $APP_DIR"
if [[ "$CHECK" == 1 ]]; then exit 0; fi
FREE_KB="$(df -Pk "$APP_HOME" | awk 'NR==2 {print $4}')"
[[ "$FREE_KB" -ge 3145728 ]] || fail 'Для сборки и отката нужно минимум 3 ГБ свободного места.'
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$APP_HOME/neo3-rollback-$STAMP"
STAGE="$(mktemp -d "$APP_HOME/neo3-stage.XXXXXX")"
chown "$APP_USER:$(id -gn "$APP_USER")" "$STAGE"
SWAPPED=0
STOPPED=0
SUCCESS=0
DB_PATH=''
rollback() {
  local code=$?
  if [[ "$SUCCESS" != 1 ]]; then
    if [[ "$SWAPPED" == 1 ]]; then
      systemctl stop "$SERVICE" || true
      if [[ -d "$APP_DIR" ]]; then mv "$APP_DIR" "$STAGE/failed-release"; fi
      mv "$BACKUP/app" "$APP_DIR"
      if [[ -n "$DB_PATH" && -f "$BACKUP/auth.db" ]]; then
        python3 - "$BACKUP/auth.db" "$DB_PATH" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as src, sqlite3.connect(sys.argv[2]) as dst:
    src.backup(dst)
PY
      fi
    fi
    if [[ "$STOPPED" == 1 ]]; then systemctl start "$SERVICE" || true; fi
    echo "Обновление не завершено. Прежняя версия сохранена. Диагностика: $STAGE" >&2
  fi
  exit "$code"
}
trap rollback EXIT
echo 'Загружаю точный опубликованный код; действующий сервис продолжает работать.'
as_app git clone --depth 1 --single-branch --branch "$REF" "$REPO" "$STAGE/app"
ACTUAL="$(git -C "$STAGE/app" rev-parse HEAD)"
[[ "$ACTUAL" == "$REMOTE" ]] || fail 'Во время загрузки вышла новая версия. Повтори обновление.'
if [[ -f "$APP_DIR/.env" ]]; then cp -p "$APP_DIR/.env" "$STAGE/app/.env"; chown "$APP_USER:$(id -gn "$APP_USER")" "$STAGE/app/.env"; fi
# Run npm from the target directory without interpolating shell commands.
as_app npm --prefix "$STAGE/app" ci --no-audit --no-fund
as_app npm --prefix "$STAGE/app" run typecheck
as_app npm --prefix "$STAGE/app" test
as_app npm --prefix "$STAGE/app" run build
if [[ "$ENGINE" == 1 ]]; then
  as_app npm install --global --prefix "$APP_HOME/.npm-global" @openai/codex@latest --no-audit --no-fund
  as_app "$APP_HOME/.npm-global/bin/codex" --version
fi
mkdir -p "$BACKUP"
systemctl cat "$SERVICE" > "$BACKUP/service.txt"
echo 'Сборка проверена. Переключаю версию с резервной копией базы.'
STOPPED=1
systemctl stop "$SERVICE"
# Backup uses SQLite's API, so WAL transactions are included. Resolve .env as data.
DB_PATH="$(python3 - "$APP_DIR/.env" "$APP_HOME" <<'PY'
from pathlib import Path
import sys
values = {}
p = Path(sys.argv[1])
if p.exists():
    for line in p.read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            k, v = line.split('=', 1)
            values[k.strip()] = v.strip().strip('\"\x27')
print(values.get('DATABASE_PATH') or str(Path(sys.argv[2]) / '.cloudcli/auth.db'))
PY
)"
[[ "$DB_PATH" == /* ]] || fail 'DATABASE_PATH должен быть абсолютным.'
if [[ -f "$DB_PATH" ]]; then
  python3 - "$DB_PATH" "$BACKUP/auth.db" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as src, sqlite3.connect(sys.argv[2]) as dst:
    src.backup(dst)
PY
fi
if [[ -d "$APP_DIR/database" ]]; then cp -a "$APP_DIR/database" "$STAGE/app/"; fi
if [[ -d "$APP_DIR/public/.well-known" ]]; then cp -a "$APP_DIR/public/.well-known" "$STAGE/app/public/"; fi
python3 - "$STAGE/app/.release.json" "$REMOTE" <<'PY'
import json, sys
from pathlib import Path
p = Path(sys.argv[1])
p.write_text(json.dumps({'commit_full': sys.argv[2], 'version': json.loads((p.parent/'package.json').read_text())['version']}))
PY
chown -R "$APP_USER:$(id -gn "$APP_USER")" "$STAGE/app"
mv "$APP_DIR" "$BACKUP/app"
SWAPPED=1
mv "$STAGE/app" "$APP_DIR"
as_app node "$APP_DIR/scripts/sync-codex-skills.mjs"
systemctl start "$SERVICE"
PORT="$(python3 - "$APP_DIR/.env" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
values = dict(line.split('=', 1) for line in p.read_text().splitlines() if '=' in line and not line.startswith('#')) if p.exists() else {}
print(values.get('SERVER_PORT', '3001').strip().strip('\"\x27'))
PY
)"
[[ "$PORT" =~ ^[0-9]+$ ]] || fail 'Недопустимый SERVER_PORT.'
HEALTH=0
for ((i=0; i<30; i++)); do
  if curl -fsS --connect-timeout 2 --max-time 3 "http://127.0.0.1:$PORT/health" -o "$STAGE/health.json"; then
    if python3 - "$STAGE/health.json" <<'PY'
import json, sys
assert json.load(open(sys.argv[1])).get('status') == 'ok'
PY
    then HEALTH=1; break; fi
  fi
  sleep 2
done
[[ "$HEALTH" == 1 ]] || fail 'Новая версия не прошла /health; выполняется откат.'
curl -fsS --connect-timeout 5 --max-time 10 "http://127.0.0.1:$PORT/" -o "$STAGE/served.html"
python3 - "$APP_DIR/dist/index.html" "$STAGE/served.html" <<'PY'
from pathlib import Path
import re, sys
def bundle(filename):
    found = re.search(r'assets/index-[A-Za-z0-9_-]+\.js', Path(filename).read_text())
    assert found, 'Frontend bundle missing'
    return found.group()
assert bundle(sys.argv[1]) == bundle(sys.argv[2]), 'Service is serving an old frontend'
PY
systemctl is-active --quiet "$SERVICE"
SUCCESS=1
echo "Готово: Neo3 $REMOTE. /health и новый интерфейс проверены."
echo "Откат и прежние локальные правки: $BACKUP. Логины и проекты сохранены."
echo 'Codex: войди своим аккаунтом в Настройки → Агенты → Codex, если ещё не входил.'
