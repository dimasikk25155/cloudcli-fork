import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { closeConnection, initializeDatabase, projectsDb, sessionsDb, userDb, userProjectAccessDb, } from '../../../modules/database/index.js';
import { createPendingAnswersService, } from '../../../modules/pending-answers/pending-answers.service.js';
async function withIsolatedDatabase(runTest) {
    const previousDatabasePath = process.env.DATABASE_PATH;
    const tempDirectory = await mkdtemp(path.join(tmpdir(), 'pending-answers-'));
    closeConnection();
    process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
    await initializeDatabase();
    try {
        const admin = userDb.createUserWithRole('dima', 'x', 'admin');
        const employee = userDb.createUserWithRole('slavik', 'x', 'user');
        const sessionId = sessionsDb.createSession('sess-alpha', 'claude', '/workspace/alpha', 'Пуш-ответы');
        const projectId = projectsDb.getProjectPath('/workspace/alpha').project_id;
        await runTest({ adminId: Number(admin.id), employeeId: Number(employee.id), sessionId, projectId });
    }
    finally {
        closeConnection();
        if (previousDatabasePath === undefined) {
            delete process.env.DATABASE_PATH;
        }
        else {
            process.env.DATABASE_PATH = previousDatabasePath;
        }
        await rm(tempDirectory, { recursive: true, force: true });
    }
}
/**
 * Service over a fake engine: one open request (known to the status
 * registry), every delivery recorded. `deliverWith` replaces the engine's
 * behaviour for one test (a failure, a slow delivery).
 */
function serviceWithOpenRequest(fixture, overrides = {}, deliverWith) {
    const deliveries = [];
    const answered = [];
    let open = {
        requestId: 'req-1',
        sessionId: fixture.sessionId,
        provider: 'claude',
        reason: 'ask',
    };
    const service = createPendingAnswersService({
        findRequest: (requestId) => (open && open.requestId === requestId ? open : null),
        engine: {
            locate: () => null,
            deliver: async (input) => {
                deliveries.push(input);
                if (deliverWith) {
                    return deliverWith(input);
                }
                open = null;
                return true;
            },
        },
        recordAnswer: (requestId) => {
            answered.push(requestId);
        },
        ...overrides,
    });
    return { service, deliveries, answered, closeRequest: () => { open = null; } };
}
const QUESTION_CHOICES = [
    { id: 'opt1', label: 'Postgres', decision: { allow: true, answers: { 'Какую базу берём?': 'Postgres' } } },
    { id: 'opt2', label: 'SQLite', decision: { allow: true, answers: { 'Какую базу берём?': 'SQLite' } } },
];
test('a push token answers once with its own choice; the sibling token then reports "already answered"', async () => {
    await withIsolatedDatabase(async (fixture) => {
        const { service, deliveries, answered } = serviceWithOpenRequest(fixture);
        const tokens = service.issueTokens('req-1', fixture.adminId, QUESTION_CHOICES);
        assert.deepEqual(tokens.map((token) => [token.id, token.label]), [['opt1', 'Postgres'], ['opt2', 'SQLite']]);
        assert.notEqual(tokens[0].token, tokens[1].token);
        const first = await service.redeemToken(tokens[1].token);
        assert.deepEqual(first, { ok: true, label: 'SQLite', sessionId: fixture.sessionId });
        assert.equal(deliveries.length, 1);
        assert.equal(deliveries[0].requestId, 'req-1');
        assert.deepEqual(deliveries[0].decision, { allow: true, answers: { 'Какую базу берём?': 'SQLite' } });
        assert.equal(deliveries[0].actor.id, fixture.adminId);
        assert.equal(deliveries[0].via, 'push');
        assert.deepEqual(answered, ['req-1']);
        const again = await service.redeemToken(tokens[1].token);
        const sibling = await service.redeemToken(tokens[0].token);
        assert.equal(again.ok, false);
        assert.equal(again.reason, 'already_answered');
        assert.equal(sibling.ok, false);
        assert.equal(sibling.reason, 'already_answered');
        assert.equal(deliveries.length, 1, 'a second tap must not reach the engine');
    });
});
test('a token is dead after 24 hours and does not reach the engine', async () => {
    await withIsolatedDatabase(async (fixture) => {
        let clock = new Date('2026-10-12T10:00:00.000Z');
        const { service, deliveries } = serviceWithOpenRequest(fixture, { now: () => clock });
        const [token] = service.issueTokens('req-1', fixture.adminId, QUESTION_CHOICES);
        clock = new Date('2026-10-13T10:00:01.000Z');
        const result = await service.redeemToken(token.token);
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'expired');
        assert.equal(deliveries.length, 0);
    });
});
test('a caller-verified actor other than the token owner is refused and the token stays usable', async () => {
    await withIsolatedDatabase(async (fixture) => {
        const { service, deliveries } = serviceWithOpenRequest(fixture);
        const [token] = service.issueTokens('req-1', fixture.adminId, QUESTION_CHOICES);
        const stranger = await service.redeemToken(token.token, { actorUserId: fixture.employeeId, via: 'telegram' });
        assert.equal(stranger.ok, false);
        assert.equal(stranger.reason, 'forbidden');
        assert.equal(deliveries.length, 0);
        const owner = await service.redeemToken(token.token, { actorUserId: fixture.adminId, via: 'telegram' });
        assert.equal(owner.ok, true);
        assert.equal(deliveries.length, 1);
        assert.equal(deliveries[0].via, 'telegram');
    });
});
test('a request already answered in the chat makes its push buttons report "already answered"', async () => {
    await withIsolatedDatabase(async (fixture) => {
        const { service, deliveries } = serviceWithOpenRequest(fixture);
        const [token] = service.issueTokens('req-1', fixture.adminId, QUESTION_CHOICES);
        const fromChat = await service.answer({
            requestId: 'req-1',
            decision: { allow: true, answers: { 'Какую базу берём?': 'Postgres' } },
            actorUserId: fixture.adminId,
            actorRole: 'admin',
            via: 'ui',
        });
        assert.deepEqual(fromChat, { ok: true });
        const fromPush = await service.redeemToken(token.token);
        assert.equal(fromPush.ok, false);
        assert.equal(fromPush.reason, 'already_answered');
        assert.equal(deliveries.length, 1);
    });
});
test('an unknown token is rejected', async () => {
    await withIsolatedDatabase(async (fixture) => {
        const { service, deliveries } = serviceWithOpenRequest(fixture);
        const result = await service.redeemToken('AAAAAAAAAAAAAAAAAAAAAA');
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'invalid');
        assert.equal(deliveries.length, 0);
    });
});
test('an employee without access to the session project cannot answer; after a grant they can', async () => {
    await withIsolatedDatabase(async (fixture) => {
        const { service, deliveries } = serviceWithOpenRequest(fixture);
        const decision = { allow: true };
        assert.equal(service.canUserAnswer({ id: fixture.employeeId, role: 'user' }, 'req-1'), false);
        const denied = await service.answer({ requestId: 'req-1', decision, actorUserId: fixture.employeeId, via: 'ui' });
        assert.deepEqual(denied, { ok: false, reason: 'forbidden' });
        assert.equal(deliveries.length, 0);
        userProjectAccessDb.grantAccess(fixture.employeeId, fixture.projectId, fixture.adminId);
        assert.equal(service.canUserAnswer({ id: fixture.employeeId, role: 'user' }, 'req-1'), true);
        const allowed = await service.answer({ requestId: 'req-1', decision, actorUserId: fixture.employeeId, via: 'ui' });
        assert.deepEqual(allowed, { ok: true });
        assert.equal(deliveries.length, 1);
        assert.equal(deliveries[0].actor.id, fixture.employeeId);
    });
});
test('a push token issued to an employee without access to the session project does not answer and is not spent', async () => {
    await withIsolatedDatabase(async (fixture) => {
        const { service, deliveries } = serviceWithOpenRequest(fixture);
        const [token] = service.issueTokens('req-1', fixture.employeeId, QUESTION_CHOICES);
        const refused = await service.redeemToken(token.token);
        assert.equal(refused.ok, false);
        assert.equal(refused.reason, 'forbidden');
        assert.equal(deliveries.length, 0);
        userProjectAccessDb.grantAccess(fixture.employeeId, fixture.projectId, fixture.adminId);
        const granted = await service.redeemToken(token.token);
        assert.equal(granted.ok, true);
        assert.equal(deliveries.length, 1);
    });
});
test('a delivery that fails leaves the request open and every button alive', async () => {
    await withIsolatedDatabase(async (fixture) => {
        let failNext = 'throw';
        const { service, deliveries, answered } = serviceWithOpenRequest(fixture, {}, async () => {
            if (failNext === 'throw') {
                failNext = 'refuse';
                throw new Error('engine down');
            }
            if (failNext === 'refuse') {
                failNext = null;
                return false; // e.g. the resumed Grok turn did not start
            }
            return true;
        });
        const tokens = service.issueTokens('req-1', fixture.adminId, QUESTION_CHOICES);
        const crashed = await service.redeemToken(tokens[0].token);
        const refused = await service.redeemToken(tokens[1].token);
        assert.equal(crashed.ok, false);
        assert.equal(crashed.reason, 'unavailable');
        assert.equal(refused.ok, false);
        assert.equal(refused.reason, 'unavailable');
        assert.deepEqual(answered, [], 'the status still waits for an answer');
        const retried = await service.redeemToken(tokens[0].token);
        assert.equal(retried.ok, true);
        assert.equal(deliveries.length, 3);
        assert.deepEqual(answered, ['req-1']);
    });
});
test('two taps at the same time reach the engine exactly once', async () => {
    await withIsolatedDatabase(async (fixture) => {
        let release = () => { };
        const gate = new Promise((resolve) => { release = resolve; });
        const { service, deliveries } = serviceWithOpenRequest(fixture, {}, async () => {
            await gate;
            return true;
        });
        const tokens = service.issueTokens('req-1', fixture.adminId, QUESTION_CHOICES);
        const both = Promise.all([service.redeemToken(tokens[0].token), service.redeemToken(tokens[1].token)]);
        release();
        const results = await both;
        assert.equal(deliveries.length, 1);
        assert.deepEqual(results.map((result) => result.ok).sort(), [false, true]);
        const loser = results.find((result) => !result.ok);
        assert.equal(loser && !loser.ok ? loser.reason : null, 'in_progress', 'not answered yet: the loser keeps its buttons');
    });
});
test('a push token issued before answer buttons were switched off is refused as MOD_OFF; the chat in Neo3 still answers', async () => {
    await withIsolatedDatabase(async (fixture) => {
        const off = new Set();
        const { service, deliveries } = serviceWithOpenRequest(fixture, { isModOn: (_userId, key) => !off.has(key) });
        const [token] = service.issueTokens('req-1', fixture.adminId, QUESTION_CHOICES);
        off.add('modAnswerButtons');
        const fromPush = await service.redeemToken(token.token);
        assert.deepEqual(fromPush, { ok: false, reason: 'MOD_OFF' });
        assert.equal(deliveries.length, 0, 'nothing reached the engine');
        const fromChat = await service.answer({
            requestId: 'req-1',
            decision: { allow: true, answers: { 'Какую базу берём?': 'Postgres' } },
            actorUserId: fixture.adminId,
            actorRole: 'admin',
            via: 'ui',
        });
        assert.deepEqual(fromChat, { ok: true });
        assert.equal(deliveries.length, 1);
        assert.equal(deliveries[0].via, 'ui');
    });
});
test('«Ждут тебя» switched off kills the answer buttons too (they only work together)', async () => {
    await withIsolatedDatabase(async (fixture) => {
        const { service, deliveries } = serviceWithOpenRequest(fixture, { isModOn: (_userId, key) => key !== 'modAttention' });
        const [token] = service.issueTokens('req-1', fixture.adminId, QUESTION_CHOICES);
        const result = await service.redeemToken(token.token, { actorUserId: fixture.adminId, via: 'telegram' });
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'MOD_OFF');
        assert.equal(deliveries.length, 0);
    });
});
//# sourceMappingURL=pending-answers.test.js.map