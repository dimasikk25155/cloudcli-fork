#!/bin/bash
# publish-release.sh — publish a new Neo3 Agent System (CloudCLI fork) release
# to the private download host (dl.neo3.ru). Runs FROM THIS MAC.
#
# What clients get is built here: install.sh (--download) and scripts/update-client.sh
# both pull from this host, so whatever this script uploads IS the product.
#
# The one rule this script exists to enforce: a release is always packaged with
# `git archive <commit>` — the exact named commit, never the working tree.
# The tarball that was on the host before this script existed had been made with
# `tar czf` from disk: it shipped 997 macOS `._*` junk files and whatever happened
# to be uncommitted at that moment. That is unreproducible and unrollbackable.
#
# Usage:
#   ./scripts/publish-release.sh                 # publish HEAD (working tree must be clean)
#   ./scripts/publish-release.sh <commit-ish>    # publish a specific commit/tag
#
# Options:
#   --allow-dirty   publish even though there are uncommitted changes.
#                   Those changes will NOT be in the release — commit first.
#   --skip-gate     do not run typecheck/tests on the commit (not recommended)
#   --yes           no confirmation prompt
#   --keep N        how many versioned archives to keep on the host (default 5)
#
# Environment:
#   RELEASE_VPS         ssh target of the download host (default root@185.199.197.210)
#   RELEASE_VPS_KEY     ssh key                          (default ~/.ssh/id_brand_vps)
#   RELEASE_REMOTE_DIR  served directory                 (default /opt/cloudcli-dl/html)
#   DL_USER / DL_PASS   Basic Auth credentials, only used to verify over HTTPS
#                       afterwards. Keep them in ~/Antigravity Project/.secrets.env.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_VPS="${RELEASE_VPS:-root@185.199.197.210}"
RELEASE_VPS_KEY="${RELEASE_VPS_KEY:-$HOME/.ssh/id_brand_vps}"
RELEASE_REMOTE_DIR="${RELEASE_REMOTE_DIR:-/opt/cloudcli-dl/html}"
DL_BASE="${DL_BASE:-https://dl.neo3.ru}"
SECRETS_FILE="${SECRETS_FILE:-$HOME/Antigravity Project/.secrets.env}"
KEEP_ARCHIVES=5

COMMITISH=""
ALLOW_DIRTY=0
SKIP_GATE=0
ASSUME_YES=0

while [ $# -gt 0 ]; do
  case "$1" in
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --skip-gate)   SKIP_GATE=1 ;;
    --yes|-y)      ASSUME_YES=1 ;;
    --keep)        KEEP_ARCHIVES="${2:?--keep needs a number}"; shift ;;
    -h|--help)     awk 'NR>1 && /^#/ {print; next} NR>1 {exit}' "$0"; exit 0 ;;
    -*)            echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
    *)             COMMITISH="$1" ;;
  esac
  shift
done

fail() { echo "❌ $1" >&2; exit 1; }
step() { echo "==> $1"; }

cd "$REPO_DIR"

# ---------------------------------------------------------------------------
# 1. Resolve exactly what is being published
# ---------------------------------------------------------------------------
COMMITISH="${COMMITISH:-HEAD}"
SHA="$(git rev-parse --verify "${COMMITISH}^{commit}" 2>/dev/null)" \
  || fail "Not a commit: $COMMITISH"
SHORT="$(git rev-parse --short "$SHA")"
SUBJECT="$(git log -1 --pretty=%s "$SHA")"
COMMIT_DATE="$(git log -1 --pretty=%cI "$SHA")"
VERSION="$(git show "$SHA:package.json" | node -e \
  'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version||"0.0.0"))')"

step "Release candidate"
echo "    commit:  $SHORT  $SUBJECT"
echo "    dated:   $COMMIT_DATE"
echo "    version: $VERSION"

# A dirty tree is the trap this script is built around: the code on disk is NOT
# what gets published, so silently packaging the commit would ship the wrong
# product (e.g. a build with the pre-Neo3 branding).
DIRTY_COUNT="$(git status --porcelain | wc -l | tr -d ' ')"
if [ "$DIRTY_COUNT" -gt 0 ]; then
  echo
  echo "    ⚠️  $DIRTY_COUNT uncommitted change(s) in the working tree."
  echo "    The release is built from commit $SHORT — none of them will ship."
  if [ "$ALLOW_DIRTY" -eq 0 ]; then
    fail "Commit your work first (then re-run), or pass --allow-dirty if you really mean to publish $SHORT as-is."
  fi
  echo "    --allow-dirty given, continuing."
fi

ARCHIVE_NAME="cloudcli-$VERSION-$SHORT.tar.gz"
BUILD_DIR="$(mktemp -d "/tmp/cloudcli-release-$SHORT.XXXXXX")"
WORKTREE="$BUILD_DIR/src"
ARCHIVE_PATH="$BUILD_DIR/$ARCHIVE_NAME"

cleanup() {
  git worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true
  rm -rf "$BUILD_DIR"
}
trap cleanup EXIT

if [ "$ASSUME_YES" -eq 0 ] && [ -t 0 ]; then
  echo
  read -rp "Publish $ARCHIVE_NAME to $DL_BASE? [y/N] " answer
  case "$answer" in y|Y|yes|YES) ;; *) echo "Aborted."; exit 0 ;; esac
fi

# ---------------------------------------------------------------------------
# 2. Gate: typecheck + tests, run against a CLEAN CHECKOUT OF THAT COMMIT.
#    Running them in the main checkout would test the disk, not the release.
# ---------------------------------------------------------------------------
if [ "$SKIP_GATE" -eq 0 ]; then
  step "Gate: checking out $SHORT into a temporary worktree"
  git worktree add --detach "$WORKTREE" "$SHA" >/dev/null

  if git diff --quiet "$SHA" -- package.json package-lock.json; then
    # Dependencies at that commit are identical to the ones already installed
    # here, so the existing node_modules is a valid (and instant) stand-in.
    echo "    dependencies match the current checkout — reusing node_modules"
    ln -s "$REPO_DIR/node_modules" "$WORKTREE/node_modules"
  else
    echo "    dependencies differ at that commit — installing them (this takes a few minutes)"
    # --ignore-scripts avoids the @vscode/ripgrep postinstall, which 403s on
    # Dima's network (see FORK-NOTES.md); better-sqlite3 still needs its build.
    ( cd "$WORKTREE" && HUSKY=0 npm install --ignore-scripts && npm rebuild better-sqlite3 ) \
      || fail "npm install failed in the temporary worktree"
  fi

  step "Gate: typecheck + tests"
  ( cd "$WORKTREE" && npm run typecheck && npm test ) \
    || fail "Gate red on commit $SHORT — nothing was published. Fix it and commit, or use --skip-gate if you are certain."
  echo "    gate OK: types clean, tests green on $SHORT"
else
  echo "==> Skipping the gate (--skip-gate)"
fi

# ---------------------------------------------------------------------------
# 3. Package from the commit (no working-tree files, no macOS junk)
# ---------------------------------------------------------------------------
step "Packaging $ARCHIVE_NAME"
git archive "$SHA" --format=tar.gz -o "$ARCHIVE_PATH"

SHA256="$(shasum -a 256 "$ARCHIVE_PATH" | awk '{print $1}')"
SIZE="$(wc -c < "$ARCHIVE_PATH" | tr -d ' ')"
FILE_COUNT="$(tar tzf "$ARCHIVE_PATH" | wc -l | tr -d ' ')"
echo "    $((SIZE / 1024 / 1024)) MB, $FILE_COUNT entries, sha256 ${SHA256:0:16}..."

# Sanity: never ship secrets, and never ship a tree the installer cannot unpack.
LISTING="$BUILD_DIR/listing.txt"
tar tzf "$ARCHIVE_PATH" > "$LISTING"
if grep -qE '^\.env$' "$LISTING"; then
  fail "Archive contains .env — refusing to publish"
fi
grep -q '^package.json$' "$LISTING" || fail "Archive has no package.json at the top level — wrong prefix?"
if ! grep -q '^scripts/update-client.sh$' "$LISTING"; then
  echo "    ⚠️  update-client.sh is not in this commit — clients installing it will have"
  echo "        no update path until you commit scripts/update-client.sh."
fi

MANIFEST_PATH="$BUILD_DIR/latest.json"
cat > "$MANIFEST_PATH" <<EOF
{
  "version": "$VERSION",
  "commit": "$SHORT",
  "commit_full": "$SHA",
  "subject": $(printf '%s' "$SUBJECT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(s)))'),
  "archive": "$ARCHIVE_NAME",
  "sha256": "$SHA256",
  "size": $SIZE,
  "published_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

# ---------------------------------------------------------------------------
# 4. Upload. Files land under a temporary name first and are moved into place,
#    so a client downloading right now never gets a half-written archive.
# ---------------------------------------------------------------------------
step "Uploading to $RELEASE_VPS:$RELEASE_REMOTE_DIR"
SSH="ssh -i $RELEASE_VPS_KEY -o ConnectTimeout=10"
$SSH "$RELEASE_VPS" "test -d '$RELEASE_REMOTE_DIR'" \
  || fail "Remote directory $RELEASE_REMOTE_DIR does not exist on $RELEASE_VPS"

scp -q -i "$RELEASE_VPS_KEY" "$ARCHIVE_PATH" "$RELEASE_VPS:$RELEASE_REMOTE_DIR/.upload-$ARCHIVE_NAME"
scp -q -i "$RELEASE_VPS_KEY" "$MANIFEST_PATH" "$RELEASE_VPS:$RELEASE_REMOTE_DIR/.upload-latest.json"

step "Activating the release"
$SSH "$RELEASE_VPS" "set -e
  cd '$RELEASE_REMOTE_DIR'
  remote_sha=\$(sha256sum '.upload-$ARCHIVE_NAME' | awk '{print \$1}')
  [ \"\$remote_sha\" = '$SHA256' ] || { echo 'checksum mismatch after upload'; exit 1; }
  mv '.upload-$ARCHIVE_NAME' '$ARCHIVE_NAME'
  cp '$ARCHIVE_NAME' '.upload-cloudcli-latest.tar.gz'
  mv '.upload-cloudcli-latest.tar.gz' 'cloudcli-latest.tar.gz'
  mv '.upload-latest.json' 'latest.json'
  chmod 644 '$ARCHIVE_NAME' cloudcli-latest.tar.gz latest.json
  ls -1t cloudcli-*-*.tar.gz 2>/dev/null | tail -n +$((KEEP_ARCHIVES + 1)) | while read -r old; do
    echo \"    pruning \$old\"; rm -f \"\$old\"
  done" || fail "Remote activation failed — the previous release is still live"

# ---------------------------------------------------------------------------
# 5. Verify over HTTPS the same way a client will fetch it
# ---------------------------------------------------------------------------
if [ -z "${DL_PASS:-}" ] && [ -f "$SECRETS_FILE" ]; then
  # Pull only the two keys we need instead of sourcing the whole secrets file.
  eval "$(grep -E '^DL_(USER|PASS)=' "$SECRETS_FILE" 2>/dev/null || true)"
fi
DL_USER="${DL_USER:-dl}"

if [ -n "${DL_PASS:-}" ]; then
  step "Verifying over HTTPS"
  REMOTE_MANIFEST="$(curl -fsS --max-time 20 -u "$DL_USER:$DL_PASS" "$DL_BASE/latest.json")" \
    || fail "Published, but $DL_BASE/latest.json is not reachable — check the Basic Auth host"
  echo "$REMOTE_MANIFEST" | grep -q "$SHA256" \
    || fail "Published, but the manifest served over HTTPS does not match this build"
  CODE="$(curl -fsS -o /dev/null -w '%{http_code}' -r 0-0 \
    -u "$DL_USER:$DL_PASS" "$DL_BASE/cloudcli-latest.tar.gz" --max-time 20 || echo 000)"
  case "$CODE" in 200|206) echo "    tarball reachable (HTTP $CODE)" ;;
                  *) fail "Published, but cloudcli-latest.tar.gz returned HTTP $CODE" ;; esac
  echo "    verified: HTTPS serves $VERSION / $SHORT"
else
  echo "==> Skipping the HTTPS check: no DL_PASS."
  echo "    Add these to $SECRETS_FILE to enable it:"
  echo "      DL_USER=dl"
  echo "      DL_PASS=<the release host password>"
fi

cat <<EOF

==============================================================================
✅ Published $VERSION ($SHORT) — $SUBJECT

Clients update with (as root on their VPS):
  DL_PASS='<release password>' bash scripts/update-client.sh

New installs are unaffected: install.sh --download picks this up automatically.
==============================================================================
EOF
