#!/bin/bash
# Update an ALREADY provisioned CloudCLI instance (friend / client VPS) to the
# current code. Companion to provision-vps.sh: that one builds a box from
# scratch, this one only refreshes the code on a box that already runs.
#
# Usage: ./update-vps.sh <root@vps-ip> [commit-ish]
#
# Works no matter how the box was installed (git clone or tarball) — the code is
# packed here with `git archive` and unpacked over the instance, exactly like
# provisioning does. Nothing outside git is touched, so these survive:
#   ~/.cloudcli/          database, logins, engine credentials
#   ~/workspace/          the client's projects
#   ~/cloudcli/.env       instance settings (port, domain, proxy)
#   ~/cloudcli/node_modules
#
# Caveat: unpacking merges, it does not mirror — a file deleted in git stays on
# the box until someone removes it. Harmless for updates, worth knowing.
set -euo pipefail

TARGET="${1:?Usage: update-vps.sh <root@vps-ip> [commit-ish]}"
COMMIT="${2:-HEAD}"

FORK_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$FORK_DIR"

git rev-parse --verify "$COMMIT^{commit}" >/dev/null 2>&1 || {
  echo "❌ unknown commit: $COMMIT" >&2
  exit 1
}
SHA=$(git rev-parse --short "$COMMIT")
EXPECTED_VERSION=$(git show "$COMMIT:package.json" | sed -n 's/.*"version": "\([^"]*\)".*/\1/p' | head -1)

ARCHIVE="/tmp/cloudcli-update-$$.tar.gz"
REMOTE_ARCHIVE="/root/$(basename "$ARCHIVE")"
trap 'rm -f "$ARCHIVE"' EXIT

echo "==> Packaging $SHA (version $EXPECTED_VERSION)"
git archive "$COMMIT" -o "$ARCHIVE" --format=tar.gz

echo "==> Copying to $TARGET"
scp -q "$ARCHIVE" "$TARGET:$REMOTE_ARCHIVE"

echo "==> Unpack + rebuild + restart (npm install and build take a few minutes)"
ssh "$TARGET" "REMOTE_ARCHIVE='$REMOTE_ARCHIVE' bash -s" <<'REMOTE'
set -euo pipefail

[ -d /home/cloudcli/cloudcli ] || { echo "❌ no instance at /home/cloudcli/cloudcli — use provision-vps.sh for a fresh box" >&2; exit 1; }

tar xzf "$REMOTE_ARCHIVE" -C /home/cloudcli/cloudcli
rm -f "$REMOTE_ARCHIVE"
chown -R cloudcli:cloudcli /home/cloudcli/cloudcli

# Same ripgrep-403 fallback as install.sh: the postinstall download can be
# blocked, and it aborts the whole install when it is.
su - cloudcli -c "cd ~/cloudcli && npm install" || {
  echo "==> plain npm install failed, trying ripgrep-403 workaround"
  su - cloudcli -c "cd ~/cloudcli && npm install --ignore-scripts && npm rebuild better-sqlite3"
  su - cloudcli -c "cp \"\$(which rg)\" ~/cloudcli/node_modules/@vscode/ripgrep/bin/rg" || true
}

su - cloudcli -c "cd ~/cloudcli && npm run build"

systemctl restart cloudcli
sleep 3
systemctl is-active --quiet cloudcli || {
  echo "❌ cloudcli did not come back up:" >&2
  journalctl -u cloudcli --no-pager | tail -40 >&2
  exit 1
}
REMOTE

echo "==> Smoke: what does the instance actually run?"
RUNNING=$(ssh "$TARGET" "curl -s --max-time 5 http://127.0.0.1:3001/health" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
[ "$RUNNING" = "$EXPECTED_VERSION" ] || {
  echo "❌ SMOKE FAILED: instance reports '$RUNNING', shipped '$EXPECTED_VERSION'" >&2
  exit 1
}

echo
echo "✅ $TARGET updated to $SHA (version $RUNNING)"
echo "   The user must reload the page in the browser (⌥⌘R in Safari) to pick up the new bundle."
