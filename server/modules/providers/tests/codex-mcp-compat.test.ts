import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import TOML from '@iarna/toml';

import { CodexMcpProvider } from '../list/codex/codex-mcp.provider.js';

test('editing Codex MCP preserves disabled state, tool restrictions and approval policy', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-mcp-compat-'));
  const file = path.join(root, '.codex', 'config.toml');
  const provider = new CodexMcpProvider();
  try {
    await mkdir(path.dirname(file));
    await writeFile(file, TOML.stringify({ model: 'fixture', mcp_servers: { example: {
      command: 'old', args: ['old'], enabled: false, required: true, startup_timeout_sec: 30,
      tool_timeout_sec: 660, enabled_tools: ['read'], disabled_tools: ['delete'],
      tools: { read: { approval_mode: 'prompt' } },
    } } }));
    await provider.upsertServer({ name: 'example', scope: 'project', workspacePath: root, transport: 'stdio', command: 'new' });
    let config: any = TOML.parse(await readFile(file, 'utf8'));
    assert.equal(config.model, 'fixture');
    assert.equal(config.mcp_servers.example.enabled, false);
    assert.deepEqual(config.mcp_servers.example.disabled_tools, ['delete']);
    assert.deepEqual(config.mcp_servers.example.tools, { read: { approval_mode: 'prompt' } });
    assert.equal(config.mcp_servers.example.tool_timeout_sec, 660);
    assert.equal(config.mcp_servers.example.command, 'new');
    await provider.upsertServer({ name: 'example', scope: 'project', workspacePath: root, transport: 'http', url: 'https://example.invalid/mcp', toolTimeoutSec: 90 });
    config = TOML.parse(await readFile(file, 'utf8'));
    assert.equal(config.mcp_servers.example.command, undefined);
    assert.equal(config.mcp_servers.example.args, undefined);
    assert.equal(config.mcp_servers.example.enabled, false);
    assert.equal(config.mcp_servers.example.tool_timeout_sec, 90);
    assert.equal((await provider.listServersForScope('project', { workspacePath: root }))[0].toolTimeoutSec, 90);
  } finally { await rm(root, { recursive: true, force: true }); }
});
