import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { closeConnection, initializeDatabase, sessionsDb, uiPreferencesDb, userDb } from './modules/database/index.js';
import { chatRunRegistry } from './modules/websocket/services/chat-run-registry.service.js';
import { spawnGrok } from './grok-cli.js';
// «Фон: N» in a Grok chat, end to end without Grok: a stand-in CLI prints
// the live fixture (real background commands from ~/.grok/sessions in the
// streaming-messages-json envelope) and the run goes through the same
// registry writer a chat uses. The user with «Пульт фона» off gets none of
// the background frames; the user with it on gets Grok's list.
const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'modules/providers/tests/fixtures/grok-background-live.jsonl');
const A = '01a09988-ed0a-7e02-9604-9ad6044513a8';
const B = '01a09989-0f56-7681-a091-3f2a9fb48fb6';
const M = '01a0998b-1fa1-7c62-b2ed-08f500daa0c2';
const C = 'call-68a14d0c-0a8c-4b4f-9425-88e5f3c8e6fd-4';
class FakeConnection {
    readyState = 1;
    frames = [];
    send(data) {
        this.frames.push(JSON.parse(data));
    }
}
async function runFakeGrok(directory, appSessionId, userId) {
    sessionsDb.createAppSession(appSessionId, 'grok', directory);
    const connection = new FakeConnection();
    const run = chatRunRegistry.startRun({ appSessionId, provider: 'grok', providerSessionId: null, connection, userId });
    await spawnGrok('покажи фон', { projectPath: directory, cwd: directory, skipStopHooks: true }, run.writer);
    return connection.frames;
}
test('a Grok run sends its background commands as «Фон» frames — only to a user with the console on', { skip: process.platform === 'win32' }, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'grok-background-run-'));
    const previous = { db: process.env.DATABASE_PATH, cli: process.env.GROK_CLI_PATH };
    closeConnection();
    process.env.DATABASE_PATH = path.join(directory, 'auth.db');
    await initializeDatabase();
    const cli = path.join(directory, 'fake-grok');
    await writeFile(cli, `#!/bin/sh\ncat "${FIXTURE}"\n`);
    await chmod(cli, 0o755);
    process.env.GROK_CLI_PATH = cli;
    try {
        const on = Number(userDb.createUserWithRole('dima', 'x', 'admin').id);
        const off = Number(userDb.createUserWithRole('slava', 'x', 'user').id);
        uiPreferencesDb.updateUiPreferences(off, { modBackgroundConsole: false });
        const onFrames = await runFakeGrok(directory, 'grok-bg-on', on);
        const lists = onFrames.filter((frame) => frame.kind === 'background_tasks');
        assert.deepEqual(lists.map((frame) => frame.provider), Array(7).fill('grok'));
        assert.deepEqual(lists.map((frame) => frame.tasks.map((task) => task.taskId)), [[A], [], [B], [B, M], [B, M, C], [C], []]);
        assert.ok(lists.every((frame) => frame.sessionId === 'grok-bg-on'));
        assert.equal(onFrames.at(-1)?.kind, 'complete');
        const offFrames = await runFakeGrok(directory, 'grok-bg-off', off);
        assert.equal(offFrames.filter((frame) => frame.kind === 'background_tasks').length, 0);
        assert.equal(offFrames.at(-1)?.kind, 'complete');
    }
    finally {
        chatRunRegistry.clearAll();
        closeConnection();
        if (previous.db === undefined)
            delete process.env.DATABASE_PATH;
        else
            process.env.DATABASE_PATH = previous.db;
        if (previous.cli === undefined)
            delete process.env.GROK_CLI_PATH;
        else
            process.env.GROK_CLI_PATH = previous.cli;
        await rm(directory, { recursive: true, force: true });
    }
});
//# sourceMappingURL=grok-background-run.test.js.map