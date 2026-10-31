import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import TOML from '@iarna/toml';
import { registerThreadsMcp, shouldRegisterThreadsMcp, THREADS_MCP_SERVER_NAME } from '../../../modules/threads/index.js';
// R14 (story 24): neo3-threads is registered globally like browser-use —
// ~/.claude.json (read by Claude and Grok) and ~/.codex/config.toml. The
// registration holds no secret; Codex whitelists the two thread variables so
// they reach the MCP process. Only ever run against a throwaway HOME.
async function withHome(runTest) {
    const previous = process.env.HOME;
    const home = await mkdtemp(path.join(tmpdir(), 'threads-mcp-home-'));
    process.env.HOME = home;
    try {
        await runTest(home);
    }
    finally {
        if (previous === undefined)
            delete process.env.HOME;
        else
            process.env.HOME = previous;
        await rm(home, { recursive: true, force: true });
    }
}
const command = { command: '/usr/local/bin/node', args: ['/opt/neo3/dist-server/server/threads-mcp.js'] };
test('registers neo3-threads for Claude/Grok and Codex without any token', async () => {
    await withHome(async (home) => {
        await writeFile(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { other: { type: 'stdio', command: 'x', args: [] } }, theme: 'dark' }));
        await registerThreadsMcp({ command });
        const claude = JSON.parse(await readFile(path.join(home, '.claude.json'), 'utf8'));
        assert.equal(claude.theme, 'dark', 'the rest of ~/.claude.json is kept');
        assert.ok(claude.mcpServers.other, 'other servers are kept');
        const entry = claude.mcpServers[THREADS_MCP_SERVER_NAME];
        assert.equal(entry.command, command.command);
        assert.deepEqual(entry.args, command.args);
        assert.equal(JSON.stringify(entry).includes('NEO3_THREADS_TOKEN'), false);
        const codex = TOML.parse(await readFile(path.join(home, '.codex', 'config.toml'), 'utf8'));
        const codexEntry = codex.mcp_servers[THREADS_MCP_SERVER_NAME];
        assert.equal(codexEntry.command, command.command);
        assert.deepEqual(codexEntry.args, command.args);
        // Codex passes MCP servers only listed variables: the token, the address and the «threads off» marker.
        assert.deepEqual([...codexEntry.env_vars].sort(), ['NEO3_THREADS_API_URL', 'NEO3_THREADS_OFF', 'NEO3_THREADS_TOKEN']);
        assert.ok(codexEntry.tool_timeout_sec > 600, 'thread_status may wait 600 s');
        assert.deepEqual(codexEntry.env ?? {}, {});
    });
});
test('a second registration with the same command writes nothing', async () => {
    await withHome(async (home) => {
        const first = await registerThreadsMcp({ command });
        assert.ok(first.some((result) => result.changed));
        const before = (await stat(path.join(home, '.claude.json'))).mtimeMs;
        const codexBefore = (await stat(path.join(home, '.codex', 'config.toml'))).mtimeMs;
        await new Promise((resolve) => setTimeout(resolve, 20));
        const second = await registerThreadsMcp({ command });
        assert.ok(second.every((result) => !result.changed));
        assert.equal((await stat(path.join(home, '.claude.json'))).mtimeMs, before);
        assert.equal((await stat(path.join(home, '.codex', 'config.toml'))).mtimeMs, codexBefore);
    });
});
test('a moved build updates the registered command', async () => {
    await withHome(async (home) => {
        await registerThreadsMcp({ command });
        await registerThreadsMcp({ command: { command: '/usr/bin/node', args: ['/srv/neo3/threads-mcp.js'] } });
        const claude = JSON.parse(await readFile(path.join(home, '.claude.json'), 'utf8'));
        assert.deepEqual(claude.mcpServers[THREADS_MCP_SERVER_NAME].args, ['/srv/neo3/threads-mcp.js']);
    });
});
test('only an instance started with NEO3_THREADS_MCP=on registers anything', () => {
    assert.equal(shouldRegisterThreadsMcp({ NEO3_THREADS_MCP: 'on' }), true);
    for (const value of [undefined, '', 'off', '1', 'true', 'ON ']) {
        assert.equal(shouldRegisterThreadsMcp({ NEO3_THREADS_MCP: value }), false, String(value));
    }
});
test('before its first change each config is copied to .bak; later changes keep that copy', async () => {
    await withHome(async (home) => {
        const claudeOriginal = JSON.stringify({ mcpServers: { other: { type: 'stdio', command: 'x', args: [] } } });
        const codexOriginal = '[mcp_servers.other]\ncommand = "y"\nargs = []\n';
        await writeFile(path.join(home, '.claude.json'), claudeOriginal);
        await mkdir(path.join(home, '.codex'), { recursive: true });
        await writeFile(path.join(home, '.codex', 'config.toml'), codexOriginal);
        await registerThreadsMcp({ command });
        assert.equal(await readFile(path.join(home, '.claude.json.bak-neo3-threads'), 'utf8'), claudeOriginal);
        assert.equal(await readFile(path.join(home, '.codex', 'config.toml.bak-neo3-threads'), 'utf8'), codexOriginal);
        await registerThreadsMcp({ command: { command: '/usr/bin/node', args: ['/srv/neo3/threads-mcp.js'] } });
        assert.equal(await readFile(path.join(home, '.claude.json.bak-neo3-threads'), 'utf8'), claudeOriginal);
        assert.equal(await readFile(path.join(home, '.codex', 'config.toml.bak-neo3-threads'), 'utf8'), codexOriginal);
    });
});
//# sourceMappingURL=threads-mcp-registration.test.js.map