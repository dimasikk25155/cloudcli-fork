#!/bin/bash
# One-command CloudCLI deploy to a fresh VPS (client or friend instance).
# Runs FROM THIS MAC — packages the golden commit locally (repo access already
# exists here, no deploy key needed) and pushes it to the target VPS.
#
# Usage: ./provision-vps.sh <root@vps-ip> <domain> [golden-commit-sha]
#
# Prereqs:
#   - target VPS is a fresh Ubuntu 22.04/24.04 box, your SSH key already
#     added for root (ssh root@<ip> works without a password prompt)
#   - run from cloudcli-fork/ on the machine with git access to this repo
set -euo pipefail

TARGET="${1:?Usage: provision-vps.sh <root@vps-ip> <domain> [golden-commit-sha]}"
DOMAIN="${2:?Usage: provision-vps.sh <root@vps-ip> <domain> [golden-commit-sha]}"
COMMIT="${3:-589a70b}"

FORK_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$FORK_DIR"

ARCHIVE="/tmp/cloudcli-code-$$.tar.gz"
trap 'rm -f "$ARCHIVE"' EXIT

echo "==> Packaging code at $COMMIT"
git archive "$COMMIT" -o "$ARCHIVE" --format=tar.gz

echo "==> Copying install.sh + code to $TARGET"
scp -q install.sh "$ARCHIVE" "$TARGET:/root/"

echo "==> Running install remotely (this takes a few minutes: npm install + build)"
ssh "$TARGET" "bash /root/install.sh '$DOMAIN' /root/$(basename "$ARCHIVE")"

cat <<EOF

==============================================================================
Server provisioned. Remaining manual steps:
  1. Add DNS A record for $DOMAIN -> the VPS IP (Cloudflare — see cloudflare-dns skill).
  2. Send the friend/client: https://$DOMAIN + tell them to register the first
     account (sets the shared admin password) and connect their own Claude
     account via Settings -> Агенты -> Claude -> "Войти снова".
==============================================================================
EOF
