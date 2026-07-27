#!/bin/bash
# CloudCLI bootstrap for a fresh Ubuntu 22.04/24.04 VPS. Run as root.
# Verified live 2026-07-22 in an isolated Ubuntu 24.04 VM (see CLIENT-ONBOARDING.md).
#
# Three ways to get the code onto this box — pick one for the 2nd argument:
#
#   install.sh <domain> --download [--enable-terminal]
#     RECOMMENDED for self-service (friend/client installs it themselves).
#     Downloads the latest golden-commit archive from Dima's own file host
#     (Basic Auth over HTTPS, no GitHub involved at all) and just runs — no
#     pausing, no keys, no waiting on anyone. Update DL_USER/DL_PASS below if
#     the release host's credentials ever rotate.
#
#   install.sh <domain> <code-archive.tar.gz> [--enable-terminal]
#     Someone with repo access (Dima) ran `git archive <golden-commit>
#     --format=tar.gz` and copied the file here. No network fetch at all.
#     This is what provision-vps.sh uses.
#
#   install.sh <domain> --clone [golden-commit] [--enable-terminal]
#     Fallback if the download host is ever down: this VPS clones the private
#     repo itself over SSH. Generates a fresh read-only deploy key and pauses
#     once, printing the public half — paste it into GitHub -> the repo ->
#     Settings -> Deploy keys -> Add deploy key (leave "Allow write access"
#     unchecked), then press Enter here to continue.
#
#   <domain>            e.g. friend.neo3.ru — Caddy will request a Let's Encrypt
#                        cert for it once DNS points here. Point DNS AFTER this
#                        script finishes (Caddy retries automatically).
#   --enable-terminal   optional: leave the raw shell tab available (default:
#                        disabled, safer for non-technical users).
set -euo pipefail

# Release host for --download mode (see wiki/synthesis note on VPS NL setup,
# 2026-07-22). Rotate the password in NPM/htpasswd on the VPS, then update here.
DL_URL="https://dl.neo3.ru/cloudcli-latest.tar.gz"
DL_USER="dl"
DL_PASS="Q3SX53MefFTNEOuyg192"

DOMAIN="${1:?Usage: install.sh <domain> <--download | code-archive.tar.gz | --clone [golden-commit]> [--enable-terminal]}"
CODE_SOURCE="${2:?Usage: install.sh <domain> <--download | code-archive.tar.gz | --clone [golden-commit]> [--enable-terminal]}"

[ "$(id -u)" -eq 0 ] || { echo "Run as root" >&2; exit 1; }

if [ "$CODE_SOURCE" = "--clone" ]; then
  GOLDEN_COMMIT="${3:-589a70b}"
  [ "${4:-}" = "--enable-terminal" ] && DISABLE_TERMINAL_VALUE=0 || DISABLE_TERMINAL_VALUE=1
elif [ "$CODE_SOURCE" = "--download" ]; then
  [ "${3:-}" = "--enable-terminal" ] && DISABLE_TERMINAL_VALUE=0 || DISABLE_TERMINAL_VALUE=1
else
  ARCHIVE="$CODE_SOURCE"
  [ -f "$ARCHIVE" ] || { echo "Archive not found: $ARCHIVE" >&2; exit 1; }
  [ "${3:-}" = "--enable-terminal" ] && DISABLE_TERMINAL_VALUE=0 || DISABLE_TERMINAL_VALUE=1
fi

echo "==> Base packages"
apt update -qq
apt install -y -qq build-essential python3 python3-setuptools git jq ripgrep sqlite3 curl

echo "==> Node 22"
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt install -y -qq nodejs
fi

echo "==> Claude Code engine (the agent itself — the UI is useless without it)"
# Installed globally so both the cloudcli user and the systemd service can reach it.
# Without this the app starts, looks healthy, and fails on the client's first task.
if ! command -v claude >/dev/null; then
  npm install -g @anthropic-ai/claude-code
fi
CLAUDE_BIN="$(command -v claude || true)"
[ -n "$CLAUDE_BIN" ] || { echo "claude CLI did not install — aborting, the product does not work without it" >&2; exit 1; }
echo "    claude at $CLAUDE_BIN ($("$CLAUDE_BIN" --version 2>/dev/null || echo 'version unknown'))"

echo "==> Caddy (not in default Ubuntu repos — add official repo first)"
if ! command -v caddy >/dev/null; then
  apt install -y -qq debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt update -qq
  apt install -y -qq caddy
fi

echo "==> cloudcli user"
id -u cloudcli &>/dev/null || adduser --disabled-password --gecos "" cloudcli

if [ "$CODE_SOURCE" = "--clone" ]; then
  echo "==> Deploy key for private repo clone"
  DEPLOY_KEY=/home/cloudcli/.ssh/cloudcli_deploy
  if [ ! -f "$DEPLOY_KEY" ]; then
    mkdir -p /home/cloudcli/.ssh
    ssh-keygen -t ed25519 -f "$DEPLOY_KEY" -N "" -C "cloudcli-deploy-$(hostname)" -q
    chown -R cloudcli:cloudcli /home/cloudcli/.ssh
    chmod 600 /home/cloudcli/.ssh/cloudcli_deploy
    cat >> /home/cloudcli/.ssh/config <<EOF
Host github.com
  HostName github.com
  User git
  IdentityFile $DEPLOY_KEY
  StrictHostKeyChecking accept-new
EOF
    chown cloudcli:cloudcli /home/cloudcli/.ssh/config
    chmod 600 /home/cloudcli/.ssh/config
    echo
    echo "=============================================================================="
    echo "Paste this public key into GitHub -> dimasikk25155/cloudcli-fork -> Settings ->"
    echo "Deploy keys -> Add deploy key (read-only, leave \"Allow write access\" unchecked):"
    echo
    cat "$DEPLOY_KEY.pub"
    echo
    read -rp "Press Enter once the deploy key is added on GitHub... " _
    echo "=============================================================================="
  fi
  echo "==> Cloning code (commit $GOLDEN_COMMIT)"
  su - cloudcli -c "git clone git@github.com:dimasikk25155/cloudcli-fork.git ~/cloudcli"
  su - cloudcli -c "cd ~/cloudcli && git checkout $GOLDEN_COMMIT"
elif [ "$CODE_SOURCE" = "--download" ]; then
  echo "==> Downloading code from release host"
  curl -fsSL -u "$DL_USER:$DL_PASS" "$DL_URL" -o /tmp/cloudcli-code.tar.gz
  mkdir -p /home/cloudcli/cloudcli
  tar xzf /tmp/cloudcli-code.tar.gz -C /home/cloudcli/cloudcli
  rm -f /tmp/cloudcli-code.tar.gz
  chown -R cloudcli:cloudcli /home/cloudcli/cloudcli
else
  echo "==> Unpack code"
  mkdir -p /home/cloudcli/cloudcli
  tar xzf "$ARCHIVE" -C /home/cloudcli/cloudcli
  chown -R cloudcli:cloudcli /home/cloudcli/cloudcli
fi

echo "==> npm install"
su - cloudcli -c "cd ~/cloudcli && npm install" || {
  echo "==> plain npm install failed, trying ripgrep-403 workaround"
  su - cloudcli -c "cd ~/cloudcli && npm install --ignore-scripts && npm rebuild better-sqlite3"
  su - cloudcli -c "cp \"\$(which rg)\" ~/cloudcli/node_modules/@vscode/ripgrep/bin/rg"
}

echo "==> npm run build"
su - cloudcli -c "cd ~/cloudcli && npm run build"

echo "==> .env"
su - cloudcli -c "cat > ~/cloudcli/.env" <<EOF
SERVER_PORT=3001
VITE_PORT=5173
HOST=127.0.0.1
WORKSPACES_ROOT=/home/cloudcli/workspace
DISABLE_TERMINAL=$DISABLE_TERMINAL_VALUE
EOF

# Gateway mode: the box itself may sit in a country the model provider does not serve,
# so the engine's outbound traffic is sent through a proxy running elsewhere while
# everything else on this host (apt, git, updates) keeps using the local network.
# Set GATEWAY_PROXY before running, e.g.
#   GATEWAY_PROXY=socks5h://127.0.0.1:10808 ./install.sh <domain> --download
if [ -n "${GATEWAY_PROXY:-}" ]; then
  echo "==> Gateway mode: engine traffic via $GATEWAY_PROXY"
  su - cloudcli -c "cat >> ~/cloudcli/.env" <<EOF
HTTPS_PROXY=$GATEWAY_PROXY
HTTP_PROXY=$GATEWAY_PROXY
NO_PROXY=localhost,127.0.0.1
EOF
fi

echo "==> Workspace folder"
su - cloudcli -c "mkdir -p ~/workspace"

# Built-in project memory: SessionStart loads memory/INDEX.md of whatever project
# is open, Stop reminds the model to record what it learned. Installed at user
# scope so it covers every project the client creates later, not just today's.
# The code archive is `git archive <golden-commit>`, so this only ships once
# templates/ + scripts/install-memory.sh are committed — never fatal if missing.
echo "==> Project memory"
if [ -f /home/cloudcli/cloudcli/scripts/install-memory.sh ]; then
  su - cloudcli -c "cd ~/cloudcli && bash scripts/install-memory.sh /home/cloudcli user" \
    || echo "    warning: memory install failed — rerun it later, not fatal"
else
  echo "    skipped: not in this build (commit templates/ + scripts/install-memory.sh)"
fi

echo "==> systemd service"
# PATH is set explicitly: systemd gives services a minimal PATH that does NOT include
# /usr/local/bin, so the service would fail to find the `claude` binary even though
# `su - cloudcli -c 'claude --version'` works fine from a shell. Silent, confusing, and
# it only shows up on the client's first task — hence the explicit list.
cat > /etc/systemd/system/cloudcli.service <<EOF
[Unit]
Description=CloudCLI (client instance)
After=network.target

[Service]
Type=simple
User=cloudcli
WorkingDirectory=/home/cloudcli/cloudcli
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EnvironmentFile=/home/cloudcli/cloudcli/.env
ExecStart=/usr/bin/node dist-server/server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable cloudcli
# restart (not enable --now) so a re-run picks up a freshly rebuilt dist-server —
# --now only starts if not already running, it won't reload an already-active service
systemctl restart cloudcli
sleep 2
systemctl is-active --quiet cloudcli || {
  echo "cloudcli service failed to start:" >&2
  journalctl -u cloudcli --no-pager | tail -40 >&2
  exit 1
}

echo "==> Caddy reverse proxy for $DOMAIN"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    reverse_proxy 127.0.0.1:3001
}
EOF
systemctl reload caddy

cat <<EOF

==============================================================================
Done. Server is up locally, waiting on DNS for public HTTPS.

Next steps:
  1. Point DNS A record: $DOMAIN -> $(curl -s -4 ifconfig.me || echo "<this server's IP>")
  2. Once DNS resolves, visit https://$DOMAIN — first visitor sets the admin password.
  3. Settings -> Агенты -> Claude -> "Войти снова" -> log in with your own
     Anthropic account (credentials stay on this VPS only).
==============================================================================
EOF
