import assert from 'node:assert/strict';
import test from 'node:test';

import { ClaudeProviderAuth } from '@/modules/providers/list/claude/claude-auth.provider.js';

/**
 * Regression guard for a silent, expensive bug: cross-spawn's `sync` RESOLVES when the
 * binary is missing (reporting ENOENT on `result.error`) instead of throwing, so a
 * `try { spawn.sync(...); return true } catch { return false }` check reported every
 * engine as installed — including on a freshly provisioned box that has no CLI at all.
 * The UI then showed a green "installed" badge while the agent answered nothing.
 */
test('Claude auth status reports NOT installed when the CLI binary is missing', async () => {
  const previous = process.env.CLAUDE_CLI_PATH;
  process.env.CLAUDE_CLI_PATH = '/nonexistent/definitely-not-claude';

  try {
    const status = await new ClaudeProviderAuth().getStatus();

    assert.equal(status.installed, false);
    assert.equal(status.authenticated, false);
    assert.equal(status.error, 'Claude Code CLI is not installed');
  } finally {
    if (previous === undefined) {
      delete process.env.CLAUDE_CLI_PATH;
    } else {
      process.env.CLAUDE_CLI_PATH = previous;
    }
  }
});
