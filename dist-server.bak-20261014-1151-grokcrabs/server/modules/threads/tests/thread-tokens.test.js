import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { closeConnection, getConnection, initializeDatabase } from '../../../modules/database/index.js';
import { createThreadTokens } from '../../../modules/threads/index.js';
// R24i (story 28): the thread token is issued for one run of a chat, bound to
// that chat and its user, and lives until the run ends + 24 hours.
const HOUR = 60 * 60 * 1000;
async function withDb(runTest) {
    const previous = process.env.DATABASE_PATH;
    const directory = await mkdtemp(path.join(tmpdir(), 'thread-tokens-'));
    closeConnection();
    process.env.DATABASE_PATH = path.join(directory, 'auth.db');
    await initializeDatabase();
    try {
        await runTest();
    }
    finally {
        closeConnection();
        if (previous === undefined)
            delete process.env.DATABASE_PATH;
        else
            process.env.DATABASE_PATH = previous;
        await rm(directory, { recursive: true, force: true });
    }
}
function clock(startIso) {
    let current = new Date(startIso).getTime();
    return {
        now: () => new Date(current),
        advance: (ms) => { current += ms; },
    };
}
test('a token issued for a run resolves to its chat, user and permission mode', async () => {
    await withDb(() => {
        const time = clock('2026-10-12T10:00:00.000Z');
        const tokens = createThreadTokens({ now: time.now });
        const token = tokens.issue({ sessionId: 'chat-1', userId: 7, permissionMode: 'bypassPermissions' });
        assert.ok(token && token.length >= 32);
        assert.deepEqual(tokens.resolve(token), { sessionId: 'chat-1', userId: 7, permissionMode: 'bypassPermissions' });
    });
});
test('the raw token is not stored in the database', async () => {
    await withDb(() => {
        const tokens = createThreadTokens();
        const token = tokens.issue({ sessionId: 'chat-1', userId: 7 });
        const dump = JSON.stringify(getConnection().prepare('SELECT * FROM thread_tokens').all());
        assert.equal(dump.includes(token), false);
    });
});
test('unknown, empty and foreign-looking tokens resolve to nothing', async () => {
    await withDb(() => {
        const tokens = createThreadTokens();
        tokens.issue({ sessionId: 'chat-1', userId: 7 });
        assert.equal(tokens.resolve(''), null);
        assert.equal(tokens.resolve('not-a-token'), null);
        assert.equal(tokens.resolve('a'.repeat(64)), null);
    });
});
test('no user, no token', async () => {
    await withDb(() => {
        const tokens = createThreadTokens();
        assert.equal(tokens.issue({ sessionId: 'chat-1', userId: null }), null);
        assert.equal(tokens.issue({ sessionId: '', userId: 3 }), null);
    });
});
test('the token stays valid during the run and for 24 hours after it ends', async () => {
    await withDb(() => {
        const time = clock('2026-10-12T10:00:00.000Z');
        const tokens = createThreadTokens({ now: time.now });
        const token = tokens.issue({ sessionId: 'chat-1', userId: 7 });
        time.advance(5 * HOUR);
        assert.ok(tokens.resolve(token), 'a long run keeps its token');
        tokens.end(token);
        time.advance(24 * HOUR - 1000);
        assert.ok(tokens.resolve(token), 'still valid just before run end + 24 h');
        time.advance(2000);
        assert.equal(tokens.resolve(token), null, 'expired after run end + 24 h');
    });
});
test('ending a run twice does not extend its token', async () => {
    await withDb(() => {
        const time = clock('2026-10-12T10:00:00.000Z');
        const tokens = createThreadTokens({ now: time.now });
        const token = tokens.issue({ sessionId: 'chat-1', userId: 7 });
        tokens.end(token);
        time.advance(20 * HOUR);
        tokens.end(token);
        time.advance(5 * HOUR);
        assert.equal(tokens.resolve(token), null);
    });
});
test('after a restart, tokens of runs that never ended expire 24 hours later', async () => {
    await withDb(() => {
        const time = clock('2026-10-12T10:00:00.000Z');
        const tokens = createThreadTokens({ now: time.now });
        const token = tokens.issue({ sessionId: 'chat-1', userId: 7 });
        time.advance(HOUR);
        tokens.reconcileOnBoot();
        time.advance(24 * HOUR - 1000);
        assert.ok(tokens.resolve(token));
        time.advance(2000);
        assert.equal(tokens.resolve(token), null);
    });
});
test('expired tokens are deleted while the server runs, at the next issue', async () => {
    await withDb(() => {
        const time = clock('2026-10-12T10:00:00.000Z');
        const tokens = createThreadTokens({ now: time.now });
        const old = tokens.issue({ sessionId: 'chat-1', userId: 7 });
        tokens.end(old);
        const live = tokens.issue({ sessionId: 'chat-2', userId: 7 });
        time.advance(25 * HOUR);
        tokens.issue({ sessionId: 'chat-3', userId: 7 });
        const sessions = getConnection().prepare('SELECT session_id FROM thread_tokens ORDER BY session_id').all()
            .map((row) => row.session_id);
        assert.deepEqual(sessions, ['chat-2', 'chat-3']);
        assert.ok(tokens.resolve(live));
    });
});
//# sourceMappingURL=thread-tokens.test.js.map