#!/bin/bash
# Preflight MCP health-check. Run this BEFORE real work so a dead/unauthorized
# MCP server is spotted and fixed UP FRONT — not discovered mid-task as a
# confusing red error. Exit 1 if anything needs attention.
set -uo pipefail

echo "==> MCP health (claude mcp list)..."
out=$(claude mcp list 2>&1)

# Show one line per server, trimmed.
echo "$out" | grep -E "Connected|Failed|Needs authentication" \
  | sed -E 's/ - / -> /' || true

bad=$(echo "$out" | grep -Ec "Failed to connect|Needs authentication" || true)
if [ "${bad:-0}" -gt 0 ]; then
  echo ""
  echo "⚠️  $bad MCP server(s) need attention (Failed / Needs authentication)."
  echo "   Fix or disable them before relying on those tools."
  exit 1
fi

echo "✅ all MCP servers connected"
