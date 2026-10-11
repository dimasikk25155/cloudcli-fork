#!/usr/bin/env node
/**
 * Secret guard for terminal Claude Code — UserPromptSubmit hook.
 *
 * Blocks a prompt that carries a key/token/password and tells the user to put
 * it into ~/Antigravity Project/.secrets.env instead. Uses the same detector
 * as the Neo3 composer (shared/secret-detect.ts), imported directly: Node 24
 * strips the types itself, no build step. The reason names the kind of secret
 * and a suggested variable name — never the value.
 *
 * Silent (exit 0, no output) when:
 *   - NEO3_SESSION=1 — a Neo3 session has its own guard in the composer;
 *   - stdin is not valid hook JSON or has no prompt (a broken hook must not
 *     lock the user out of their terminal).
 *
 * Installation is a separate, manual step — this script does not touch
 * ~/.claude/settings.json. Fragment to add under "hooks" (keep existing
 * UserPromptSubmit entries; the path is this repo's checkout):
 *
 *   "UserPromptSubmit": [
 *     {
 *       "hooks": [
 *         {
 *           "type": "command",
 *           "command": "node \"$HOME/Antigravity Project/claude agent/cloudcli-fork/scripts/hooks/secret-guard.mjs\"",
 *           "timeout": 10
 *         }
 *       ]
 *     }
 *   ]
 *
 * Requires Node >= 22.18 / 24 (built-in type stripping) and a source checkout:
 * Node refuses to strip types for files under node_modules.
 *
 * Test: node --test scripts/hooks/secret-guard.test.mjs
 */

import { describeSecretKind, detectSecrets } from '../../shared/secret-detect.ts';

const SECRETS_FILE_HINT = '~/Antigravity Project/.secrets.env';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function buildReason(findings) {
  const seen = new Set();
  const lines = [];
  for (const finding of findings) {
    const key = `${finding.kind}:${finding.suggestedName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`- ${describeSecretKind(finding.kind)} → $${finding.suggestedName}`);
  }
  return [
    'Похоже, в промпте секрет — промпт не отправлен:',
    ...lines,
    `Положи значение в ${SECRETS_FILE_HINT} (ИМЯ=значение) и сошлись в промпте на переменную, например $${findings[0].suggestedName}.`,
  ].join('\n');
}

async function main() {
  if (process.env.NEO3_SESSION === '1') return;

  let prompt = '';
  try {
    const input = JSON.parse(await readStdin());
    prompt = typeof input?.prompt === 'string' ? input.prompt : '';
  } catch {
    return;
  }
  if (!prompt) return;

  const findings = detectSecrets(prompt);
  if (findings.length === 0) return;

  process.stdout.write(`${JSON.stringify({ decision: 'block', reason: buildReason(findings) })}\n`);
}

main().catch(() => {
  // Never print the error: it could quote the prompt. Fail open.
  process.exitCode = 0;
});
