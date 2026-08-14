#!/bin/bash
# Update THIS instance in place. Runs on the VPS itself, as root:
#
#   bash /home/cloudcli/cloudcli/self-update.sh
#
# Pulls the latest code from the public repo this box was cloned from, rebuilds
# and restarts the service, then checks the instance actually came back on the
# new version. No keys or passwords needed.
#
# Untouched, because none of it lives in git:
#   ~/.cloudcli/    database, logins, engine credentials
#   ~/workspace/    projects
#   ~/cloudcli/.env instance settings
set -euo pipefail

APP=/home/cloudcli/cloudcli

[ "$(id -u)" = "0" ] || { echo "❌ run as root: sudo bash $0" >&2; exit 1; }
[ -d "$APP" ] || { echo "❌ no instance at $APP" >&2; exit 1; }
[ -d "$APP/.git" ] || {
  echo "❌ this box was installed from a tarball, it has no git remote to pull from." >&2
  echo "   Ask Dima to run: ./update-vps.sh root@<this-ip>" >&2
  exit 1
}

echo "==> Pulling code"
su - cloudcli -c "cd ~/cloudcli && git pull --ff-only"

echo "==> npm install"
# Same ripgrep-403 fallback as install.sh: that postinstall download can be
# blocked, and it aborts the whole install when it is.
su - cloudcli -c "cd ~/cloudcli && npm install" || {
  echo "==> plain npm install failed, trying ripgrep-403 workaround"
  su - cloudcli -c "cd ~/cloudcli && npm install --ignore-scripts && npm rebuild better-sqlite3"
  su - cloudcli -c "cp \"\$(which rg)\" ~/cloudcli/node_modules/@vscode/ripgrep/bin/rg" || true
}

echo "==> Build"
su - cloudcli -c "cd ~/cloudcli && npm run build"

echo "==> Restart"
systemctl restart cloudcli
sleep 3
systemctl is-active --quiet cloudcli || {
  echo "❌ cloudcli did not come back up:" >&2
  journalctl -u cloudcli --no-pager | tail -40 >&2
  exit 1
}

EXPECTED=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$APP/package.json" | head -1)
RUNNING=$(curl -s --max-time 5 http://127.0.0.1:3001/health | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
[ "$RUNNING" = "$EXPECTED" ] || {
  echo "❌ instance reports '$RUNNING', code on disk is '$EXPECTED'" >&2
  exit 1
}

echo
echo "✅ Обновлено до версии $RUNNING. Перезагрузи страницу в браузере (в Safari — ⌥⌘R)."
