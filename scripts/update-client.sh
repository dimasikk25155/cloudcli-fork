#!/bin/bash
# update-client.sh — update a client's Neo3 Agent System (CloudCLI fork) instance
# in place, on the client's own VPS. Run as root on that VPS.
#
# Companion to install.sh: install.sh does the one-time bootstrap, this script
# does every update after that. It never touches the client's data — the
# database (~/.cloudcli/auth.db), Claude credentials + transcripts (~/.claude),
# projects (~/workspace) and plugins (~/.claude-code-ui) all live OUTSIDE the
# install directory, so an update only swaps the code.
#
# Safety model (why this is safe to run in front of a paying client):
#   1. Back up the database and .env BEFORE anything else.
#   2. Download + npm install + build + checks happen in a STAGING directory,
#      while the live service keeps serving. A failure here aborts with the
#      client's instance completely untouched.
#   3. Only when staging is green: stop service, swap directories (a move, so
#      it takes milliseconds), start service.
#   4. Smoke test the running service. If it is not healthy, automatically swap
#      back to the previous release and restore the database backup.
#
# Usage (as root on the client's VPS):
#   DL_PASS='<release password>' bash update-client.sh
#   bash update-client.sh --check          # only report installed vs published
#   bash update-client.sh --rollback       # go back to the previous release
#
# Credentials for the release host come from (in order):
#   1. environment: DL_USER / DL_PASS
#   2. config file: /etc/cloudcli-release.conf  (chmod 600, KEY=VALUE lines)
#
# Options:
#   --check         report versions and exit, change nothing
#   --rollback      restore the previous release (and its database backup)
#   --force         reinstall even when already on the published version
#   --skip-checks   skip typecheck/tests in staging (small VPS with <2GB RAM)
#   --skip-engine   do not touch the Claude Code CLI
#   --fresh-deps    wipe node_modules and install dependencies from scratch
#   --keep-db       on rollback, keep the current database instead of restoring
#   --keep N        how many previous releases to retain (default 1)
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (override via environment if a client box is laid out differently)
# ---------------------------------------------------------------------------
APP_USER="${APP_USER:-cloudcli}"
APP_HOME="${APP_HOME:-/home/$APP_USER}"
APP_DIR="${APP_DIR:-$APP_HOME/cloudcli}"
SERVICE="${SERVICE:-cloudcli}"
STAGING_DIR="${STAGING_DIR:-$APP_HOME/cloudcli-staging}"
RELEASES_DIR="${RELEASES_DIR:-$APP_HOME/cloudcli-releases}"
BACKUP_DIR="${BACKUP_DIR:-$APP_HOME/cloudcli-backups}"
CONF_FILE="${CONF_FILE:-/etc/cloudcli-release.conf}"
DL_BASE="${DL_BASE:-https://dl.neo3.ru}"
DL_USER="${DL_USER:-dl}"
DL_PASS="${DL_PASS:-}"
# One kept release is enough to roll back, and each one carries a ~1.5GB
# node_modules — do not fill a small VPS with history.
KEEP_RELEASES="${KEEP_RELEASES:-1}"
# Free space needed for staging: a full node_modules copy (~1.5GB) + archive.
MIN_FREE_KB="${MIN_FREE_KB:-3145728}"

MODE="update"
FORCE=0
SKIP_CHECKS=0
SKIP_ENGINE=0
FRESH_DEPS=0
KEEP_DB=0

while [ $# -gt 0 ]; do
  case "$1" in
    --check)       MODE="check" ;;
    --rollback)    MODE="rollback" ;;
    --force)       FORCE=1 ;;
    --skip-checks) SKIP_CHECKS=1 ;;
    --skip-engine) SKIP_ENGINE=1 ;;
    --fresh-deps)  FRESH_DEPS=1 ;;
    --keep-db)     KEEP_DB=1 ;;
    --keep)        KEEP_RELEASES="${2:?--keep needs a number}"; shift ;;
    -h|--help)     awk 'NR>1 && /^#/ {print; next} NR>1 {exit}' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

STAMP="$(date +%Y%m%d-%H%M%S)"
TMP_ARCHIVE="/tmp/cloudcli-update-$STAMP.tar.gz"

fail() { echo "❌ $1" >&2; exit 1; }
step() { echo "==> $1"; }
as_app() { su - "$APP_USER" -c "$1"; }
bundle_ref() { grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1; }

cleanup() { rm -f "$TMP_ARCHIVE"; }
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
[ "$(id -u)" -eq 0 ] || fail "Run as root (sudo bash update-client.sh)"
id -u "$APP_USER" >/dev/null 2>&1 || fail "User $APP_USER does not exist — is this a CloudCLI box?"
[ -d "$APP_DIR" ] || fail "Install directory not found: $APP_DIR"
[ -f "$APP_DIR/package.json" ] || fail "$APP_DIR does not look like a CloudCLI install (no package.json)"
systemctl list-unit-files "$SERVICE.service" >/dev/null 2>&1 || fail "systemd service $SERVICE not found"

for tool in curl tar jq sha256sum systemctl; do
  command -v "$tool" >/dev/null 2>&1 || fail "Missing required tool: $tool (apt install -y $tool)"
done

# Port the app listens on, so the smoke test hits the right place.
PORT="$(grep -sE '^SERVER_PORT=' "$APP_DIR/.env" | tail -1 | cut -d= -f2 | tr -d '[:space:]')"
PORT="${PORT:-3001}"

# Database location: server/load-env.js defaults it to ~/.cloudcli/auth.db, i.e.
# OUTSIDE the install directory — which is why swapping the code is safe. A
# customised .env can move it, so honour that.
DB_PATH="$(grep -sE '^DATABASE_PATH=' "$APP_DIR/.env" | tail -1 | cut -d= -f2- | tr -d '[:space:]')"
DB_PATH="${DB_PATH:-$APP_HOME/.cloudcli/auth.db}"

# Load release-host credentials from the config file when not in the environment.
if [ -z "$DL_PASS" ] && [ -f "$CONF_FILE" ]; then
  # shellcheck disable=SC1090
  . "$CONF_FILE"
  DL_USER="${DL_USER:-dl}"
fi

installed_version() {
  if [ -f "$APP_DIR/.release.json" ]; then
    jq -r '.version // "unknown"' "$APP_DIR/.release.json" 2>/dev/null || echo unknown
  else
    echo "unversioned"
  fi
}
installed_commit() {
  if [ -f "$APP_DIR/.release.json" ]; then
    jq -r '.commit // "unknown"' "$APP_DIR/.release.json" 2>/dev/null || echo unknown
  else
    echo "unknown"
  fi
}

# ---------------------------------------------------------------------------
# Smoke test: the service must be up, healthy, and serving the NEW frontend
# bundle. The bundle comparison is what catches "restarted but still serving
# the old build" — a version string alone would not.
# ---------------------------------------------------------------------------
smoke() {
  local health want got
  for _ in $(seq 1 30); do
    sleep 2
    systemctl is-active --quiet "$SERVICE" || continue
    health="$(curl -fsS --max-time 5 "http://127.0.0.1:$PORT/health" 2>/dev/null || true)"
    if [ -n "$health" ]; then break; fi
  done

  systemctl is-active --quiet "$SERVICE" || { echo "    smoke: service is not active"; return 1; }
  [ -n "${health:-}" ] || { echo "    smoke: /health never answered"; return 1; }
  echo "$health" | jq -e '.status == "ok"' >/dev/null 2>&1 \
    || { echo "    smoke: /health did not report status=ok"; return 1; }

  want="$(bundle_ref < "$APP_DIR/dist/index.html" 2>/dev/null || true)"
  got="$(curl -fsS --max-time 10 "http://127.0.0.1:$PORT/" 2>/dev/null | bundle_ref || true)"
  [ -n "$want" ] || { echo "    smoke: no bundle reference in dist/index.html (build missing?)"; return 1; }
  [ "$want" = "$got" ] || { echo "    smoke: serving '$got', expected '$want'"; return 1; }

  echo "    smoke OK: service active, /health ok, serving $want"
  return 0
}

# Restore a previous release directory (and optionally its database backup).
# $1 = release directory to put back, $2 = database backup file (may be empty),
# $3 = label for the directory being replaced (failed / replaced).
# Note: the set-aside directory is deliberately NOT named like a timestamp, so
# it is never picked up as a rollback target later.
restore_release() {
  local release="$1" db_backup="${2:-}" label="${3:-replaced}"

  systemctl stop "$SERVICE" || true
  mkdir -p "$RELEASES_DIR"
  if [ -d "$APP_DIR" ]; then
    rm -rf "${RELEASES_DIR:?}/$label-$STAMP"
    mv "$APP_DIR" "$RELEASES_DIR/$label-$STAMP"
  fi
  mv "$release" "$APP_DIR"

  if [ "$KEEP_DB" -eq 0 ] && [ -n "$db_backup" ] && [ -f "$db_backup" ]; then
    # The new version may have run forward-only schema migrations that the old
    # code cannot read, so the matching database snapshot goes back too.
    rm -f "$DB_PATH-wal" "$DB_PATH-shm"
    cp "$db_backup" "$DB_PATH"
    chown "$APP_USER:$APP_USER" "$DB_PATH"
    echo "    database restored from $db_backup"
  fi

  systemctl start "$SERVICE"
}

# ---------------------------------------------------------------------------
# --rollback: put the most recent previous release back
# ---------------------------------------------------------------------------
if [ "$MODE" = "rollback" ]; then
  [ -d "$RELEASES_DIR" ] || fail "No releases directory ($RELEASES_DIR) — nothing to roll back to"
  PREV="$(find "$RELEASES_DIR" -maxdepth 1 -mindepth 1 -type d -name '20*' | sort | tail -1)"
  [ -n "$PREV" ] || fail "No previous release found in $RELEASES_DIR"
  PREV_STAMP="$(basename "$PREV")"
  DB_BACKUP="$BACKUP_DIR/$PREV_STAMP/auth.db"

  step "Rolling back to $PREV_STAMP"
  restore_release "$PREV" "$DB_BACKUP" "replaced"

  if smoke; then
    echo "✅ Rolled back to $PREV_STAMP (version $(installed_version))"
    exit 0
  fi
  fail "Rollback restored $PREV_STAMP but the service is still unhealthy — check: journalctl -u $SERVICE -n 50"
fi

# ---------------------------------------------------------------------------
# Find out what is published
# ---------------------------------------------------------------------------
[ -n "$DL_PASS" ] || fail "No release password. Use: DL_PASS='...' bash update-client.sh
  (or put DL_USER=/DL_PASS= into $CONF_FILE and chmod 600 it)"

step "Checking the release host ($DL_BASE)"
MANIFEST="$(curl -fsS --max-time 20 -u "$DL_USER:$DL_PASS" "$DL_BASE/latest.json" 2>/dev/null || true)"

if [ -n "$MANIFEST" ] && echo "$MANIFEST" | jq -e '.version' >/dev/null 2>&1; then
  NEW_VERSION="$(echo "$MANIFEST" | jq -r '.version')"
  NEW_COMMIT="$(echo "$MANIFEST" | jq -r '.commit // "unknown"')"
  NEW_ARCHIVE="$(echo "$MANIFEST" | jq -r '.archive')"
  NEW_SHA256="$(echo "$MANIFEST" | jq -r '.sha256 // ""')"
else
  # Older release host with no manifest yet: fall back to the rolling tarball.
  echo "    no latest.json on the host — falling back to cloudcli-latest.tar.gz (version unknown)"
  NEW_VERSION="unknown"
  NEW_COMMIT="unknown"
  NEW_ARCHIVE="cloudcli-latest.tar.gz"
  NEW_SHA256=""
fi

CUR_VERSION="$(installed_version)"
CUR_COMMIT="$(installed_commit)"
echo "    installed: $CUR_VERSION ($CUR_COMMIT)"
echo "    published: $NEW_VERSION ($NEW_COMMIT) -> $NEW_ARCHIVE"

if [ "$MODE" = "check" ]; then
  if [ "$CUR_COMMIT" = "$NEW_COMMIT" ] && [ "$NEW_COMMIT" != "unknown" ]; then
    echo "✅ Up to date."
  else
    echo "ℹ️  An update is available. Apply it with: DL_PASS='...' bash update-client.sh"
  fi
  exit 0
fi

if [ "$FORCE" -eq 0 ] && [ "$NEW_COMMIT" != "unknown" ] && [ "$CUR_COMMIT" = "$NEW_COMMIT" ]; then
  echo "✅ Already on the published release ($CUR_VERSION / $CUR_COMMIT). Nothing to do."
  exit 0
fi

FREE_KB="$(df -Pk "$APP_HOME" | awk 'NR==2 {print $4}')"
[ "$FREE_KB" -ge "$MIN_FREE_KB" ] \
  || fail "Not enough free disk space: $((FREE_KB/1024))MB free, need $((MIN_FREE_KB/1024))MB. Free some space or run with --fresh-deps."

mkdir -p "$RELEASES_DIR" "$BACKUP_DIR/$STAMP"

# ---------------------------------------------------------------------------
# 1. Back up the client's data BEFORE anything else
# ---------------------------------------------------------------------------
step "Backing up database and .env"
if [ -f "$DB_PATH" ]; then
  # sqlite3 .backup is safe on a live database; plain cp can catch a torn write.
  if command -v sqlite3 >/dev/null 2>&1 \
     && sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/$STAMP/auth.db'" 2>/dev/null; then
    :
  else
    cp "$DB_PATH" "$BACKUP_DIR/$STAMP/auth.db"
    for suffix in -wal -shm; do
      if [ -f "$DB_PATH$suffix" ]; then
        cp "$DB_PATH$suffix" "$BACKUP_DIR/$STAMP/auth.db$suffix"
      fi
    done
  fi
  echo "    database -> $BACKUP_DIR/$STAMP/auth.db ($(du -h "$BACKUP_DIR/$STAMP/auth.db" | cut -f1))"
else
  echo "    no database at $DB_PATH yet (nothing logged in?) — skipping"
fi

if [ -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env" "$BACKUP_DIR/$STAMP/.env"
  echo "    .env -> $BACKUP_DIR/$STAMP/.env"
else
  echo "    WARNING: no .env in $APP_DIR — the new build will start with defaults"
fi

# ---------------------------------------------------------------------------
# 2. Build the new version in staging — the live service keeps running
# ---------------------------------------------------------------------------
step "Downloading $NEW_ARCHIVE"
curl -fsSL --max-time 600 -u "$DL_USER:$DL_PASS" "$DL_BASE/$NEW_ARCHIVE" -o "$TMP_ARCHIVE" \
  || fail "Download failed — check the release password and that $DL_BASE is reachable"

if [ -n "$NEW_SHA256" ]; then
  echo "$NEW_SHA256  $TMP_ARCHIVE" | sha256sum -c - >/dev/null 2>&1 \
    || fail "Checksum mismatch — the download is corrupt or truncated, nothing was changed"
  echo "    checksum OK"
fi

step "Unpacking into staging"
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
tar xzf "$TMP_ARCHIVE" -C "$STAGING_DIR"
[ -f "$STAGING_DIR/package.json" ] || fail "Archive does not contain a CloudCLI tree (no package.json)"

# Carry over everything that belongs to THIS client and is not in the archive.
if [ -f "$BACKUP_DIR/$STAMP/.env" ]; then
  cp "$BACKUP_DIR/$STAMP/.env" "$STAGING_DIR/.env"
fi
# Legacy in-tree database (pre-~/.cloudcli installs) — copy it so nothing is lost.
if [ -d "$APP_DIR/database" ]; then
  cp -a "$APP_DIR/database" "$STAGING_DIR/"
fi
# Android app-links file, if this client got a branded APK.
if [ -d "$APP_DIR/public/.well-known" ]; then
  mkdir -p "$STAGING_DIR/public"
  cp -a "$APP_DIR/public/.well-known" "$STAGING_DIR/public/"
fi

step "Installing dependencies"
if [ "$FRESH_DEPS" -eq 0 ] && [ -d "$APP_DIR/node_modules" ]; then
  cp -a "$APP_DIR/node_modules" "$STAGING_DIR/node_modules"
fi
chown -R "$APP_USER:$APP_USER" "$STAGING_DIR"

if [ "$FRESH_DEPS" -eq 0 ] \
   && [ -d "$STAGING_DIR/node_modules" ] \
   && cmp -s "$APP_DIR/package-lock.json" "$STAGING_DIR/package-lock.json"; then
  echo "    dependencies unchanged — reusing the existing node_modules"
else
  # Same ripgrep-403 fallback as install.sh: @vscode/ripgrep downloads its
  # binary from GitHub releases, which is blocked on some Russian networks.
  as_app "cd $STAGING_DIR && npm install" || {
    echo "    plain npm install failed, trying the ripgrep-403 workaround"
    as_app "cd $STAGING_DIR && npm install --ignore-scripts && npm rebuild better-sqlite3"
    as_app "rm -f $STAGING_DIR/node_modules/@vscode/ripgrep/bin/rg && cp \"\$(which rg)\" $STAGING_DIR/node_modules/@vscode/ripgrep/bin/rg"
  }
fi

step "Building"
as_app "cd $STAGING_DIR && npm run build" || fail "Build failed — the client's instance was NOT touched"

if [ "$SKIP_CHECKS" -eq 0 ]; then
  step "Running checks (typecheck + tests)"
  if as_app "cd $STAGING_DIR && npm run typecheck && npm test"; then
    echo "    checks green"
  else
    fail "Checks failed — the client's instance was NOT touched. Re-run with --skip-checks only if you know this build is good (e.g. the box ran out of RAM)."
  fi
else
  echo "==> Skipping checks (--skip-checks)"
fi

# ---------------------------------------------------------------------------
# 3. Swap: the only moment the client sees downtime (a few seconds)
# ---------------------------------------------------------------------------
step "Switching to the new version"
cat > "$STAGING_DIR/.release.json" <<EOF
{
  "version": "$NEW_VERSION",
  "commit": "$NEW_COMMIT",
  "archive": "$NEW_ARCHIVE",
  "installed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "previous_release": "$STAMP"
}
EOF
chown "$APP_USER:$APP_USER" "$STAGING_DIR/.release.json"

systemctl stop "$SERVICE"
rm -rf "${RELEASES_DIR:?}/$STAMP"
mv "$APP_DIR" "$RELEASES_DIR/$STAMP"
mv "$STAGING_DIR" "$APP_DIR"
systemctl start "$SERVICE"

step "Smoke testing"
if ! smoke; then
  echo "❌ The new version is not healthy — rolling back automatically."
  journalctl -u "$SERVICE" --no-pager -n 30 || true
  restore_release "$RELEASES_DIR/$STAMP" "$BACKUP_DIR/$STAMP/auth.db" "failed"
  if smoke; then
    fail "Update failed and was rolled back. The client is running the previous version again ($CUR_VERSION). Broken build kept at $RELEASES_DIR/failed-$STAMP for debugging."
  fi
  fail "Update failed AND the rollback did not come up cleanly. Look at: journalctl -u $SERVICE -n 100"
fi

# ---------------------------------------------------------------------------
# 4. Keep the AI engine current (separate from our code)
# ---------------------------------------------------------------------------
if [ "$SKIP_ENGINE" -eq 0 ]; then
  step "Claude Code engine"

  # The engine is a SEPARATE program: server/claude-sdk.js hands the SDK a bare
  # "claude" command, so the version that runs is whatever is on PATH — not
  # anything inside node_modules. Two things can go wrong on a client box:
  #   1. it is not installed at all (install.sh does not install it);
  #   2. it is installed into ~/.local/bin, which systemd's minimal PATH does
  #      not contain, so the service cannot see it even though a login shell can.
  SYSTEMD_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  CLAUDE_BIN=""
  if env -i PATH="$SYSTEMD_PATH" sh -c 'command -v claude' >/dev/null 2>&1; then
    CLAUDE_BIN="$(env -i PATH="$SYSTEMD_PATH" sh -c 'command -v claude')"
    echo "    visible to the service: $CLAUDE_BIN"
  elif [ -x "$APP_HOME/.local/bin/claude" ]; then
    CLAUDE_BIN="$APP_HOME/.local/bin/claude"
    echo "    found at $CLAUDE_BIN, but systemd's PATH does not include ~/.local/bin"
    if grep -qsE '^CLAUDE_CLI_PATH=' "$APP_DIR/.env"; then
      echo "    .env already pins CLAUDE_CLI_PATH — leaving it alone"
    else
      echo "    pinning CLAUDE_CLI_PATH in .env so the service can find it"
      echo "CLAUDE_CLI_PATH=$CLAUDE_BIN" >> "$APP_DIR/.env"
      chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
      systemctl restart "$SERVICE"
      smoke || fail "Service did not come back after pinning CLAUDE_CLI_PATH — restore .env from $BACKUP_DIR/$STAMP/.env and restart $SERVICE"
    fi
  fi

  if [ -n "$CLAUDE_BIN" ]; then
    # Claude Code ships its own self-updater; this just makes sure it has run.
    if as_app "$CLAUDE_BIN update" >/dev/null 2>&1; then
      echo "    claude -> $(as_app "$CLAUDE_BIN --version" 2>/dev/null | head -1)"
    else
      echo "    'claude update' failed (not fatal) — current: $(as_app "$CLAUDE_BIN --version" 2>/dev/null | head -1)"
    fi
  else
    echo "    WARNING: the 'claude' CLI is not installed on this server."
    echo "    The web UI will load and log in, but the Claude engine cannot run a single task."
    echo "    Fix it (as root) with:  npm install -g @anthropic-ai/claude-code"
    echo "    then have the client log in again in Settings -> Агенты -> Claude."
  fi
fi

# ---------------------------------------------------------------------------
# 5. Housekeeping
# ---------------------------------------------------------------------------
step "Cleaning up old releases (keeping $KEEP_RELEASES)"
find "$RELEASES_DIR" -maxdepth 1 -mindepth 1 -type d -name '20*' | sort -r \
  | tail -n "+$((KEEP_RELEASES + 1))" | while read -r old; do
      echo "    removing $(basename "$old")"
      rm -rf "$old"
    done
find "$BACKUP_DIR" -maxdepth 1 -mindepth 1 -type d -name '20*' | sort -r \
  | tail -n +6 | while read -r old; do rm -rf "$old"; done

echo
echo "=============================================================================="
echo "✅ Updated: $CUR_VERSION -> $NEW_VERSION ($NEW_COMMIT)"
echo "   Previous version kept at: $RELEASES_DIR/$STAMP"
echo "   Database backup:          $BACKUP_DIR/$STAMP/auth.db"
echo "   Undo this update with:    bash update-client.sh --rollback"
echo "=============================================================================="
