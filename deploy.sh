#!/bin/bash
# Deploy cloudcli-fork to prod (this Mac serves https://claude.neo3.ru via
# VPS-NL reverse proxy over tailnet). Build client+server, restart launchd
# service, then smoke-check that every layer serves THIS build:
#   dist/index.html == Mac origin == prod edge (fetched from the VPS, because
#   claude.neo3.ru is not reachable from this Mac's own network).
# Rule: red smoke == the deploy did NOT happen, no matter what git says.
set -euo pipefail

FORK_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE="com.dimasik.cloudcli"
VPS="root@185.199.197.210"
VPS_KEY="$HOME/.ssh/id_brand_vps"
PROD_URL="https://claude.neo3.ru/"
TAILSCALE_BIN="/opt/homebrew/bin/tailscale"

bundle_ref() { grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1; }
fail() { echo "❌ SMOKE FAILED: $1" >&2; exit 1; }

cd "$FORK_DIR"

# Gate: types + tests must pass BEFORE we build or restart prod. set -e aborts
# the deploy here on any red, so prod is never touched with a broken tree.
echo "==> Gate: typecheck + tests..."
npm run typecheck
npm test
echo "    gate OK: types clean, tests green"

echo "==> Building client + server..."
npm run build

LOCAL_BUNDLE=$(bundle_ref < dist/index.html)
[ -n "$LOCAL_BUNDLE" ] || fail "no bundle reference in dist/index.html"
echo "    built: $LOCAL_BUNDLE"

echo "==> Restarting $SERVICE..."
launchctl kickstart -k "gui/$(id -u)/$SERVICE"

ORIGIN_IP=$("$TAILSCALE_BIN" ip -4 2>/dev/null | head -1)
[ -n "$ORIGIN_IP" ] || fail "cannot resolve Mac tailscale IP"
ORIGIN_URL="http://$ORIGIN_IP:3001/"

echo "==> Waiting for origin $ORIGIN_URL ..."
ORIGIN_HTML=""
for _ in $(seq 1 15); do
  sleep 2
  ORIGIN_HTML=$(curl -s --max-time 5 "$ORIGIN_URL" || true)
  [ -n "$ORIGIN_HTML" ] && break
done
[ -n "$ORIGIN_HTML" ] || fail "origin did not come back up after restart"

ORIGIN_BUNDLE=$(bundle_ref <<< "$ORIGIN_HTML")
[ "$ORIGIN_BUNDLE" = "$LOCAL_BUNDLE" ] || fail "origin serves $ORIGIN_BUNDLE, built $LOCAL_BUNDLE (stale dist?)"
echo "    origin OK: $ORIGIN_BUNDLE"

echo "==> Checking prod edge $PROD_URL (via VPS)..."
# Retry: the VPS occasionally drops the first SSH connection (MaxStartups).
EDGE_BUNDLE=""
for _ in 1 2 3; do
  EDGE_BUNDLE=$(ssh -i "$VPS_KEY" -o ConnectTimeout=10 "$VPS" \
    "curl -s --max-time 15 '$PROD_URL'" | bundle_ref || true)
  [ -n "$EDGE_BUNDLE" ] && break
  sleep 10
done
[ -n "$EDGE_BUNDLE" ] || fail "prod edge returned no bundle reference (proxy down?)"
[ "$EDGE_BUNDLE" = "$LOCAL_BUNDLE" ] || fail "prod edge serves $EDGE_BUNDLE, built $LOCAL_BUNDLE"
echo "    edge OK: $EDGE_BUNDLE"

echo "✅ Deploy verified: local == origin == prod edge ($LOCAL_BUNDLE)"
