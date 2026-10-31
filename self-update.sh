#!/usr/bin/env bash
# Use the staged updater: no in-place git reset, build or data replacement.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
export APP_DIR="${APP_DIR:-$ROOT}"
exec bash "$ROOT/scripts/upgrade-neo3.sh" "$@"
