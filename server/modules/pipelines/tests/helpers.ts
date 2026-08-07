// Shared harness for pipeline tests: every test gets its own SQLite file and its
// own artifacts directory, so runs never touch the developer's real ~/.cloudcli.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { closeConnection, initializeDatabase, userDb } from '@/modules/database/index.js';
import { pipelineRunsDb } from '@/modules/database/repositories/pipelines.db.js';

export type PipelineTestContext = {
  artifactsRoot: string;
};

/** Foreign keys are enforced, so every pipeline needs a real owner row. */
export function createTestUser(username: string, role: 'admin' | 'user' = 'user'): number {
  return Number(userDb.createUserWithRole(username, 'test-hash', role).id);
}

/**
 * Loads the production access check for tests that must not fake it.
 *
 * The import is wrapped because the engine modules behind it start a module-scope
 * cleanup interval (server/openai-codex.js) that is never unref'd — without this
 * the test process would stay alive forever after the assertions pass.
 */
export async function importRealAccessCheck(): Promise<
  (userId: number, projectPath: string) => { ok: true; projectPath: string } | { ok: false; error: string }
> {
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = ((...args: Parameters<typeof originalSetInterval>) => {
    const timer = originalSetInterval(...args);
    timer.unref?.();
    return timer;
  }) as typeof globalThis.setInterval;

  try {
    const { checkProjectAccess } = await import('@/modules/agent-run/agent-run.service.js');
    return checkProjectAccess;
  } finally {
    globalThis.setInterval = originalSetInterval;
  }
}

export async function withPipelineTestEnv(
  runTest: (context: PipelineTestContext) => void | Promise<void>,
): Promise<void> {
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
  } finally {
    closeConnection();
    restoreEnv('DATABASE_PATH', previousDatabasePath);
    restoreEnv('PIPELINE_ARTIFACTS_DIR', previousArtifactsDir);
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previousValue;
  }
}

/** A background run has no promise to await, so the test waits for the row to settle. */
export async function waitForRunToFinish(runId: number, timeoutMs = 5000): Promise<string> {
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

export async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await sleep(5);
  }

  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
