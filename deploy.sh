#!/bin/bash
# Deploy this fork to prod — https://claude.neo3.ru, served by THIS box under
# the `neo3` systemd unit. (Until 10.08.2026 prod was Dima's Mac behind a
# tailnet proxy; that whole path is gone, along with the Mac.)
#
#   ./deploy.sh                 build, then restart only if the server changed
#   ./deploy.sh --restart       restart no matter what
#   ./deploy.sh --no-restart    never restart (frontend-only, keeps this chat alive)
#
# Two facts shape everything below:
#   1. The server serves dist/ straight off disk, so a frontend-only change is
#      live the moment the build finishes — no restart, no dropped session.
#   2. Restarting kills the agent that is running this script (it is a child of
#      the very service being restarted). So a needed restart is handed to a
#      detached runner that survives us, and its verdict lands in a log file.
#
# Rule: red smoke == the deploy did NOT happen, no matter what git says.
set -euo pipefail

FORK_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE="neo3"
ORIGIN_URL="http://127.0.0.1:3001/"
PROD_URL="https://claude.neo3.ru/"
RESTART_LOG="/tmp/neo3-deploy.log"
# Fingerprint of the server build the running service was actually started on.
# Compared by content, not mtime: `npm run build` wipes and regenerates
# dist-server every time, so every file is always "new" and a timestamp check
# would demand a restart (and drop the chat) on every single frontend tweak.
SERVER_STAMP="$FORK_DIR/.neo3-deployed-server"

RESTART_MODE="auto"
for arg in "$@"; do
  case "$arg" in
    --restart) RESTART_MODE="always" ;;
    --no-restart) RESTART_MODE="never" ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

bundle_ref() { grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1; }
fail() { echo "❌ SMOKE FAILED: $1" >&2; exit 1; }

cd "$FORK_DIR"

# Gate: types + tests must pass BEFORE we build or touch prod. `set -e` aborts
# the deploy here on any red, so prod is never served a broken tree.
echo "==> Gate: typecheck + tests..."
npm run typecheck
npm test
echo "    gate OK: types clean, tests green"

server_fingerprint() {
  find dist-server -type f -name '*.js' -exec sha1sum {} + 2>/dev/null | sort -k2 | sha1sum | cut -d' ' -f1
}

echo "==> Building client + server..."
npm run build

LOCAL_BUNDLE=$(bundle_ref < dist/index.html)
[ -n "$LOCAL_BUNDLE" ] || fail "no bundle reference in dist/index.html"
echo "    built: $LOCAL_BUNDLE"

# The frontend is live already — verify it through the running server and the
# public edge before deciding anything about restarts.
echo "==> Checking origin $ORIGIN_URL ..."
ORIGIN_BUNDLE=$(curl -s --max-time 10 "$ORIGIN_URL" | bundle_ref || true)
[ "$ORIGIN_BUNDLE" = "$LOCAL_BUNDLE" ] || fail "origin serves ${ORIGIN_BUNDLE:-nothing}, built $LOCAL_BUNDLE"
echo "    origin OK: $ORIGIN_BUNDLE"

echo "==> Checking prod edge $PROD_URL ..."
EDGE_BUNDLE=$(curl -s --max-time 20 "$PROD_URL" | bundle_ref || true)
[ -n "$EDGE_BUNDLE" ] || fail "prod edge returned no bundle reference (proxy down?)"
[ "$EDGE_BUNDLE" = "$LOCAL_BUNDLE" ] || fail "prod edge serves $EDGE_BUNDLE, built $LOCAL_BUNDLE"
echo "    edge OK: $EDGE_BUNDLE"

SERVER_NOW=$(server_fingerprint)
SERVER_DEPLOYED=$(cat "$SERVER_STAMP" 2>/dev/null || true)

needs_restart() {
  [ "$RESTART_MODE" = "always" ] && return 0
  [ "$RESTART_MODE" = "never" ] && return 1
  # Auto: does the built server code differ from what the service is running?
  if [ -z "$SERVER_DEPLOYED" ]; then
    # First run after this script landed — no fingerprint to compare against.
    # Assume the running service is current rather than dropping the chat on a
    # guess; a real server change is deployed with --restart.
    echo "$SERVER_NOW" > "$SERVER_STAMP"
    echo "    (first run: server fingerprint recorded, assuming service is current)"
    return 1
  fi
  [ "$SERVER_NOW" != "$SERVER_DEPLOYED" ]
}

if ! needs_restart; then
  echo "✅ Deploy verified, no restart needed: local == origin == edge ($LOCAL_BUNDLE)"
  echo "   Frontend-only change — Dima just reloads the page."
  exit 0
fi

# Server code changed. The restart takes this chat down with it, so hand it to
# a runner that outlives us: it waits long enough for the answer to reach Dima,
# restarts, waits for the service to serve again, and writes its verdict to
# $RESTART_LOG (readable afterwards, and from the Server tab).
echo "==> Server code changed — restart required."
echo "    Handing it to a detached runner; THIS CHAT WILL DROP in ~20s."
echo "    Verdict lands in $RESTART_LOG — reload the page after ~1 min."

setsid nohup bash -c "
  sleep 20
  {
    echo \"[\$(date '+%F %T')] restarting $SERVICE for bundle $LOCAL_BUNDLE\"
    sudo systemctl restart $SERVICE
    for _ in \$(seq 1 30); do
      sleep 2
      SERVED=\$(curl -s --max-time 5 '$ORIGIN_URL' | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)
      if [ \"\$SERVED\" = '$LOCAL_BUNDLE' ]; then
        # Only now is this server build actually the one in production.
        echo '$SERVER_NOW' > '$SERVER_STAMP'
        echo \"[\$(date '+%F %T')] ✅ back up, serving \$SERVED\"
        exit 0
      fi
    done
    echo \"[\$(date '+%F %T')] ❌ did not come back on $LOCAL_BUNDLE — last 40 log lines:\"
    journalctl -u $SERVICE --no-pager | tail -40
  } >> '$RESTART_LOG' 2>&1
" >/dev/null 2>&1 &

echo "✅ Build verified ($LOCAL_BUNDLE); restart scheduled."
