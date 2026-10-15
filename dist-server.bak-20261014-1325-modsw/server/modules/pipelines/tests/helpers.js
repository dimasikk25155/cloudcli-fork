// Shared harness for pipeline tests: every test gets its own SQLite file and its
// own artifacts directory, so runs never touch the developer's real ~/.cloudcli.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeConnection, initializeDatabase, userDb } from '../../../modules/database/index.js';
import { pipelineRunsDb } from '../../../modules/database/repositories/pipelines.db.js';
/** Foreign keys are enforced, so every pipeline needs a real owner row. */
export function createTestUser(username, role = 'user') {
    return Number(userDb.createUserWithRole(username, 'test-hash', role).id);
}
/**
 * Loads the production access check for tests that must not fake it.
 *
 * The import is wrapped because the engine modules behind it start a module-scope
 * cleanup interval (server/openai-codex.js) that is never unref'd — without this
 * the test process would stay alive forever after the assertions pass.
 */
export async function importRealAccessCheck() {
    const originalSetInterval = globalThis.setInterval;
    globalThis.setInterval = ((...args) => {
        const timer = originalSetInterval(...args);
        timer.unref?.();
        return timer;
    });
    try {
        const { checkProjectAccess } = await import('../../../modules/agent-run/agent-run.service.js');
        return checkProjectAccess;
    }
    finally {
        globalThis.setInterval = originalSetInterval;
    }
}
export async function withPipelineTestEnv(runTest) {
    const previousDatabasePath = process.env.DATABASE_PATH;
    const previousArtifactsDir = process.env.PIPELINE_ARTIFACTS_DIR;
    const tempDirectory = await mkdtemp(path.join(tmpdir(), 'pipelines-test-'));
    const artifactsRoot = path.join(tempDirectory, 'pipeline-runs');
    const databasePath = path.join(tempDirectory, 'auth.db');
    // An empty file is already a valid SQLite database, and its presence stops the
    // connection layer from seeding the test with a copy of the developer's real db.
    await writeFile(databasePath, '');
    closeConnection();
    process.env.DATABASE_PATH = databasePath;
    process.env.PIPELINE_ARTIFACTS_DIR = artifactsRoot;
    await initializeDatabase();
    try {
        await runTest({ artifactsRoot });
    }
    finally {
        closeConnection();
        restoreEnv('DATABASE_PATH', previousDatabasePath);
        restoreEnv('PIPELINE_ARTIFACTS_DIR', previousArtifactsDir);
        await rm(tempDirectory, { recursive: true, force: true });
    }
}
function restoreEnv(name, previousValue) {
    if (previousValue === undefined) {
        delete process.env[name];
    }
    else {
        process.env[name] = previousValue;
    }
}
/** A background run has no promise to await, so the test waits for the row to settle. */
export async function waitForRunToFinish(runId, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const status = pipelineRunsDb.getRunById(runId)?.status;
        if (status === 'completed' || status === 'failed' || status === 'canceled') {
            return status;
        }
        await sleep(5);
    }
    throw new Error(`Run ${runId} did not finish within ${timeoutMs}ms`);
}
export async function waitFor(condition, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (condition()) {
            return;
        }
        await sleep(5);
    }
    throw new Error(`Condition was not met within ${timeoutMs}ms`);
}
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export function createDeferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}
//# sourceMappingURL=helpers.js.map