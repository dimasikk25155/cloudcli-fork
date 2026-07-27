#!/bin/bash
# setup-gateway.sh — point a client's server at the outbound gateway.
#
# Why this exists: the model provider does not serve every country. The client's
# server can sit wherever their data has to live, while only the engine's traffic
# leaves through a server in a supported country. Everything else on the box
# (apt, git, the site itself) keeps using the local network.
#
#   Client's browser ──► client's server (their country, their data)
#                              │ engine traffic only
#                              ▼
#                        gateway server ──► provider
#
# Run as root ON THE CLIENT'S SERVER:
#   GW_HOST=1.2.3.4 GW_PORT=8443 GW_ID=<uuid> GW_PBK=<public key> \
#   GW_SID=<short id> GW_SNI=www.microsoft.com bash setup-gateway.sh
#
# Options:
#   --check     report whether the gateway is up and which exit IP it gives, then stop
#   --wire      also write the proxy into the app's .env and restart the service
#   --remove    tear the local gateway client down (app .env is left alone)
#
# One gateway key per client. Sharing a key across clients makes several accounts
# reach the provider from one address, which is exactly what account farms look
# like — and a ban would land on all of them at once.
set -euo pipefail

LOCAL_PORT="${LOCAL_PORT:-10808}"
APP_DIR="${APP_DIR:-/home/cloudcli/cloudcli}"
SERVICE="${SERVICE:-cloudcli}"
XRAY_CONF="/usr/local/etc/xray/config.json"
MODE="setup"

for arg in "$@"; do
  case "$arg" in
    --check)  MODE="check" ;;
    --wire)   MODE="wire" ;;
    --remove) MODE="remove" ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

step() { echo; echo "==> $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Run as root"

# ---------------------------------------------------------------------------
# --remove
# ---------------------------------------------------------------------------
if [ "$MODE" = "remove" ]; then
  step "Removing the local gateway client"
  systemctl disable --now xray 2>/dev/null || true
  rm -f "$XRAY_CONF"
  echo "    done — the app's .env was not touched, clear HTTPS_PROXY there yourself"
  exit 0
fi

# ---------------------------------------------------------------------------
# --check: is the tunnel already up, and what does the outside world see?
# ---------------------------------------------------------------------------
report_exit_ip() {
  local direct through
  direct="$(curl -fsS -4 --max-time 10 https://api.ipify.org 2>/dev/null || echo '?')"
  through="$(curl -fsS -4 --max-time 15 --proxy "socks5h://127.0.0.1:$LOCAL_PORT" \
    https://api.ipify.org 2>/dev/null || echo '')"
  echo "    this server goes out as: $direct"
  if [ -z "$through" ]; then
    echo "    through the gateway:     (no answer)"
    return 1
  fi
  echo "    through the gateway:     $through"
  [ "$direct" != "$through" ] || {
    echo "    ⚠️  same address both ways — traffic is NOT taking the gateway"
    return 1
  }
  # The point of the whole exercise: the provider must be reachable through it.
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
    --proxy "socks5h://127.0.0.1:$LOCAL_PORT" https://api.anthropic.com/v1/messages \
    -H 'content-type: application/json' -d '{}' 2>/dev/null || echo 000)"
  # 401 means "reached the provider, you just have no key" — that is a pass.
  # 000 means the request never arrived, 403 usually means the region is blocked.
  case "$code" in
    000) echo "    provider:                unreachable"; return 1 ;;
    403) echo "    provider:                HTTP 403 — region still blocked"; return 1 ;;
    *)   echo "    provider:                HTTP $code (reached)" ;;
  esac
  return 0
}

if [ "$MODE" = "check" ]; then
  step "Checking the gateway"
  echo -n "    xray service: "; systemctl is-active xray 2>/dev/null || echo "not installed"
  report_exit_ip && echo && echo "✅ Gateway is working." \
    || { echo; fail "Gateway is not working — see the lines above"; }
  exit 0
fi

# ---------------------------------------------------------------------------
# setup
# ---------------------------------------------------------------------------
# No apostrophes in these messages: bash reads a quote inside ${VAR:?word} as
# opening a quoted string and the whole script fails to parse.
: "${GW_HOST:?Set GW_HOST to the gateway address}"
: "${GW_ID:?Set GW_ID to the gateway key for this client (uuid)}"
: "${GW_PBK:?Set GW_PBK to the gateway public key}"
GW_PORT="${GW_PORT:-8443}"
GW_SID="${GW_SID:-}"
GW_SNI="${GW_SNI:-www.microsoft.com}"

step "Installing xray"
if ! command -v xray >/dev/null; then
  apt-get update -qq && apt-get install -y -qq curl unzip
  curl -fsSL https://github.com/XTLS/Xray-install/raw/main/install-release.sh \
    | bash -s -- install >/dev/null
fi
command -v xray >/dev/null || fail "xray did not install"
echo "    $(xray version 2>/dev/null | head -1)"

step "Writing the local proxy config"
mkdir -p "$(dirname "$XRAY_CONF")"
cat > "$XRAY_CONF" <<JSON
{
  "log": { "loglevel": "warning" },
  "inbounds": [
    {
      "tag": "socks-in",
      "listen": "127.0.0.1",
      "port": $LOCAL_PORT,
      "protocol": "socks",
      "settings": { "udp": true, "auth": "noauth" }
    }
  ],
  "outbounds": [
    {
      "tag": "gateway",
      "protocol": "vless",
      "settings": {
        "vnext": [
          {
            "address": "$GW_HOST",
            "port": $GW_PORT,
            "users": [
              { "id": "$GW_ID", "encryption": "none", "flow": "xtls-rprx-vision" }
            ]
          }
        ]
      },
      "streamSettings": {
        "network": "tcp",
        "security": "reality",
        "realitySettings": {
          "serverName": "$GW_SNI",
          "fingerprint": "chrome",
          "publicKey": "$GW_PBK",
          "shortId": "$GW_SID"
        }
      }
    }
  ]
}
JSON

# Bound to 127.0.0.1 above, but the box may be exposed and defaults change.
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
  ufw deny "$LOCAL_PORT" >/dev/null 2>&1 || true
fi

step "Starting xray"
xray run -test -config "$XRAY_CONF" >/dev/null 2>&1 || fail "xray rejected the config"
systemctl enable xray >/dev/null 2>&1 || true
systemctl restart xray
sleep 3
systemctl is-active --quiet xray || {
  journalctl -u xray --no-pager -n 20 >&2
  fail "xray did not stay up"
}

step "Verifying"
report_exit_ip || fail "The tunnel came up but traffic is not going through it"

# ---------------------------------------------------------------------------
# --wire: hand the proxy to the app
# ---------------------------------------------------------------------------
if [ "$MODE" = "wire" ]; then
  step "Wiring the app to the gateway"
  [ -f "$APP_DIR/.env" ] || fail "$APP_DIR/.env not found — is the app installed here?"
  # Rewrite rather than append: re-running must not stack duplicate keys.
  sed -i '/^HTTPS_PROXY=/d;/^HTTP_PROXY=/d;/^NO_PROXY=/d' "$APP_DIR/.env"
  cat >> "$APP_DIR/.env" <<ENV
HTTPS_PROXY=socks5h://127.0.0.1:$LOCAL_PORT
HTTP_PROXY=socks5h://127.0.0.1:$LOCAL_PORT
NO_PROXY=localhost,127.0.0.1
ENV
  systemctl restart "$SERVICE"
  sleep 4
  systemctl is-active --quiet "$SERVICE" || fail "$SERVICE did not come back after restart"
  echo "    $SERVICE restarted and healthy"
fi

cat <<EOF

==============================================================================
✅ Gateway is up. The engine reaches the provider through $GW_HOST.

  local proxy:  socks5h://127.0.0.1:$LOCAL_PORT
  re-check:     bash setup-gateway.sh --check
  hand to app:  bash setup-gateway.sh --wire
  remove:       bash setup-gateway.sh --remove
==============================================================================
EOF
