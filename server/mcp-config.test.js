import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// loadMcpConfig reads ~/.claude.json via os.homedir(); point HOME at a sandbox.
const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'neo3-mcp-'));
process.env.HOME = sandbox;
const { loadMcpConfig } = await import('./claude-sdk.js');

test('loadMcpConfig drops servers listed in projects[cwd].disabledMcpServers', async () => {
  const cwd = '/tmp/proj-a';
  await fs.writeFile(path.join(sandbox, '.claude.json'), JSON.stringify({
    mcpServers: {
      keep: { command: 'x' },
      lazyweb: { type: 'http', url: 'https://example' },
      'playwright-ru': { command: 'npx' }
    },
    projects: {
      [cwd]: { disabledMcpServers: ['lazyweb', 'playwright-ru'] },
      '/tmp/proj-b': { disabledMcpServers: ['keep'] }
    }
  }));

  const forA = await loadMcpConfig(cwd);
  assert.deepEqual(Object.keys(forA).sort(), ['keep']);

  const forB = await loadMcpConfig('/tmp/proj-b');
  assert.deepEqual(Object.keys(forB).sort(), ['lazyweb', 'playwright-ru']);

  // Project with no entry keeps everything.
  const forC = await loadMcpConfig('/tmp/proj-c');
  assert.deepEqual(Object.keys(forC).sort(), ['keep', 'lazyweb', 'playwright-ru']);
});

test('loadMcpConfig returns null when every server is disabled', async () => {
  const cwd = '/tmp/proj-all-off';
  await fs.writeFile(path.join(sandbox, '.claude.json'), JSON.stringify({
    mcpServers: { only: { command: 'x' } },
    projects: { [cwd]: { disabledMcpServers: ['only'] } }
  }));
  assert.equal(await loadMcpConfig(cwd), null);
});
