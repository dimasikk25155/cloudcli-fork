import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectGrokHookContext, collectGrokStopReason } from './grok-cli.js';
// R29 (spec story 43): Grok runs Claude's user-level hooks through Neo3's own
// emulation; those hook processes must see NEO3_SESSION=1 exactly like a
// Claude session does. The hooks below only answer when the marker is set,
// so a missing marker shows up as an empty result.
async function withHooks(hooks, run) {
    const home = await mkdtemp(path.join(os.tmpdir(), 'neo3-grok-hooks-'));
    const previousHome = process.env.HOME;
    const previousMarker = process.env.NEO3_SESSION;
    await mkdir(path.join(home, '.claude'), { recursive: true });
    await writeFile(path.join(home, '.claude', 'settings.json'), JSON.stringify({ hooks }));
    process.env.HOME = home;
    // The test process itself may run inside Neo3; the marker must come from
    // the emulation, not leak in from the parent.
    delete process.env.NEO3_SESSION;
    try {
        await run();
    }
    finally {
        if (previousHome === undefined)
            delete process.env.HOME;
        else
            process.env.HOME = previousHome;
        if (previousMarker === undefined)
            delete process.env.NEO3_SESSION;
        else
            process.env.NEO3_SESSION = previousMarker;
        await rm(home, { recursive: true, force: true });
    }
}
const markerOnly = (output) => `if [ "$NEO3_SESSION" = "1" ]; then printf '%s' '${output}'; fi`;
test('emulated Stop hooks run with NEO3_SESSION=1', { skip: process.platform === 'win32' }, async () => {
    await withHooks({ Stop: [{ hooks: [{ type: 'command', command: markerOnly('{"decision":"block","reason":"marker seen"}') }] }] }, async () => {
        assert.equal(await collectGrokStopReason('sess-1'), 'marker seen');
    });
});
test('emulated SessionStart/UserPromptSubmit hooks run with NEO3_SESSION=1', { skip: process.platform === 'win32' }, async () => {
    await withHooks({ UserPromptSubmit: [{ hooks: [{ type: 'command', command: markerOnly('context with marker') }] }] }, async () => {
        assert.equal(await collectGrokHookContext({ isNewSession: false }), 'context with marker');
    });
});
test('a Stop hook that exits on the marker produces no follow-up turn', { skip: process.platform === 'win32' }, async () => {
    // The shape of the patched vault Stop hook (docs/neo3-mods-wave1-apply.md).
    const patched = `[ "$NEO3_SESSION" = "1" ] && exit 0; printf '%s' '{"decision":"block","reason":"write the vault"}'`;
    await withHooks({ Stop: [{ hooks: [{ type: 'command', command: patched }] }] }, async () => {
        assert.equal(await collectGrokStopReason('sess-2'), '');
    });
});
test('a hook that exits without reading a large stdin does not crash the server (EPIPE handled)', { skip: process.platform === 'win32' }, async () => {
    // The hook answers and exits at once, never reading stdin. The stdin JSON
    // (4 MB session id) is far larger than a pipe buffer, so the write is
    // guaranteed to hit a closed pipe: EPIPE on child.stdin. Unhandled, that
    // error event takes the whole process down; handled, the hook simply counts
    // as finished by its own exit code and its output is used.
    await withHooks({ Stop: [{ hooks: [{ type: 'command', command: `printf '%s' '{"decision":"block","reason":"answered early"}'; exit 0` }] }] }, async () => {
        const uncaught = [];
        const onUncaught = (error) => uncaught.push(error);
        process.on('uncaughtException', onUncaught);
        try {
            const reason = await collectGrokStopReason('x'.repeat(4 * 1024 * 1024));
            // Give a late 'error' event the chance to surface before judging.
            await new Promise((resolve) => setTimeout(resolve, 50));
            assert.equal(reason, 'answered early');
            assert.deepEqual(uncaught.map((error) => error.code ?? error.message), []);
        }
        finally {
            process.off('uncaughtException', onUncaught);
        }
    });
});
//# sourceMappingURL=grok-hooks-env.test.js.map