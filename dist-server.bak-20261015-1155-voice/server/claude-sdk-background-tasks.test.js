import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createBackgroundTaskTracker } from './modules/background-tasks/index.js';
import { isRunBusy, mapCliOptionsToSDK, sdkOptionsForRun, stopClaudeTask } from './claude-sdk.js';
const effortModels = { OPTIONS: [], DEFAULT: 'opus[1m]' };
test('stopping a task after the turn ended (no live CLI process) says the turn is over', async () => {
    assert.deepEqual(await stopClaudeTask('no-such-session', 'task-1'), { ok: false, reason: 'turn_ended' });
});
test('every Neo3 Claude session loads the neo3-guards mod as a local SDK plugin', () => {
    const { plugins } = mapCliOptionsToSDK({ model: 'opus[1m]', effortModels });
    assert.equal(plugins?.length, 1);
    assert.equal(plugins[0].type, 'local');
    assert.equal(path.basename(plugins[0].path), 'neo3-guards');
    assert.ok(existsSync(path.join(plugins[0].path, '.claude-plugin', 'plugin.json')));
});
// Background tasks must not hold the CLI's stdin after `idle`: a `tail -f` or
// a dev server would keep the chat «working» forever and block the next
// message. Only an open tool call (its permission answer) holds it.
test('a live background task does not hold the run after idle', () => {
    const tracker = createBackgroundTaskTracker({ now: () => 0 });
    tracker.apply({
        type: 'system',
        subtype: 'background_tasks_changed',
        tasks: [{ task_id: 'b0ckrdq1i', task_type: 'local_bash', description: 'tail -f dev.log' }],
    });
    assert.equal(isRunBusy({ openToolCalls: 0, backgroundTasks: tracker }), false);
});
test('an open tool call holds the run; nothing open releases it', () => {
    assert.equal(isRunBusy({ openToolCalls: 1 }), true);
    assert.equal(isRunBusy({ openToolCalls: 0 }), false);
});
test('«Пульт фона» switched off: the neo3-guards mod is not loaded into that user\'s Claude runs', async (t) => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { closeConnection, initializeDatabase, uiPreferencesDb, userDb } = await import('./modules/database/index.js');
    const directory = await mkdtemp(path.join(tmpdir(), 'claude-guards-mod-'));
    const previous = process.env.DATABASE_PATH;
    closeConnection();
    process.env.DATABASE_PATH = path.join(directory, 'auth.db');
    await initializeDatabase();
    t.after(async () => {
        closeConnection();
        if (previous === undefined)
            delete process.env.DATABASE_PATH;
        else
            process.env.DATABASE_PATH = previous;
        await rm(directory, { recursive: true, force: true });
    });
    const off = Number(userDb.createUserWithRole('dima', 'x', 'admin').id);
    const on = Number(userDb.createUserWithRole('slava', 'x', 'user').id);
    uiPreferencesDb.updateUiPreferences(off, { modBackgroundConsole: false });
    // The run's options as queryClaudeSDK builds them: the user comes from the run's writer.
    assert.equal(sdkOptionsForRun({ model: 'opus[1m]' }, { userId: String(off) }, { effortModels }).plugins, undefined);
    assert.equal(sdkOptionsForRun({ model: 'opus[1m]' }, { userId: on }, { effortModels }).plugins?.length, 1);
});
//# sourceMappingURL=claude-sdk-background-tasks.test.js.map