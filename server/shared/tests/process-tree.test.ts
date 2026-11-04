import assert from 'node:assert/strict';
import test from 'node:test';

import {
  commandMatcher, findDescendantProcess, killProcessTree, markStoppableTasks, stopEngineTask, type ProcessEntry,
} from '@/shared/process-tree.js';

/**
 * «Стоп» for Codex and Grok background commands: the engine has no API for
 * it, so the command is looked up among the descendants of the engine
 * process and its own process tree is stopped. A fake `ps` table stands in.
 */
const TABLE: ProcessEntry[] = [
  { pid: 100, ppid: 1, command: 'node server/index.js' },
  { pid: 200, ppid: 100, command: '/opt/codex/codex exec --experimental-json --cd /work/a' },
  { pid: 210, ppid: 200, command: '/bin/zsh -lc npm run dev' },
  { pid: 211, ppid: 210, command: 'node /work/a/node_modules/.bin/vite' },
  { pid: 220, ppid: 200, command: '/bin/zsh -lc sleep 30' },
  { pid: 300, ppid: 100, command: '/opt/codex/codex exec --experimental-json --cd /work/b' },
  { pid: 310, ppid: 300, command: '/bin/zsh -lc npm run dev' },
];

const listProcesses = async () => TABLE;

test('a command is found only under the given engine process, topmost match first', async () => {
  const dev = await findDescendantProcess(200, (command) => command.includes('npm run dev'), { listProcesses });
  assert.deepEqual(dev, { pid: 210, command: '/bin/zsh -lc npm run dev' });
  // The same command of another chat (pid 300) is never picked for 200.
  assert.equal((await findDescendantProcess(300, (command) => command.includes('npm run dev'), { listProcesses }))?.pid, 310);
  assert.equal(await findDescendantProcess(200, (command) => command.includes('pytest'), { listProcesses }), null);
  // The root itself is not its own descendant.
  assert.equal(await findDescendantProcess(200, (command) => command.includes('codex exec'), { listProcesses }), null);
  // No ps (Windows, a failure) = not found.
  assert.equal(await findDescendantProcess(200, () => true, { listProcesses: async () => { throw new Error('no ps'); } }), null);
});

test('killing a tree stops children before the parent and reports the parent gone', async () => {
  const alive = new Set(TABLE.map((entry) => entry.pid));
  const signals: Array<[number, string]> = [];
  const ok = await killProcessTree(210, {
    listProcesses: async () => TABLE.filter((entry) => alive.has(entry.pid)),
    kill: (pid, signal) => { signals.push([pid, signal]); alive.delete(pid); },
    isAlive: (pid) => alive.has(pid),
    sleep: async () => {},
  });
  assert.equal(ok, true);
  assert.deepEqual(signals, [[211, 'SIGTERM'], [210, 'SIGTERM']]);
  assert.ok(alive.has(200) && alive.has(220), 'the engine and its other commands live on');
});

test('a tree that ignores SIGTERM gets SIGKILL; one that survives both is reported', async () => {
  const signals: Array<[number, string]> = [];
  const stubborn = new Set([220]);
  const ok = await killProcessTree(220, {
    listProcesses,
    kill: (pid, signal) => { signals.push([pid, signal]); if (signal === 'SIGKILL') stubborn.delete(pid); },
    isAlive: (pid) => stubborn.has(pid),
    sleep: async () => {},
  });
  assert.equal(ok, true);
  assert.deepEqual(signals.map(([, signal]) => signal), ['SIGTERM', 'SIGKILL']);

  const immortal = await killProcessTree(220, {
    listProcesses, kill: () => {}, isAlive: () => true, sleep: async () => {},
  });
  assert.equal(immortal, false);
});

test('a command is matched by its script as ps prints it (quotes gone, spaces folded, first line)', () => {
  const dev = commandMatcher('npm run dev');
  assert.equal(dev('/bin/zsh -lc npm run dev'), true);
  assert.equal(dev('/bin/zsh -lc npm   run dev --port 3000'), true, 'spaces fold');
  assert.equal(dev('/bin/zsh -lc npm run build'), false, 'another command is not it');
  assert.equal(commandMatcher("ssh -o ConnectTimeout=10 server python3 - <<'PY'\nprint(1)\nPY")(
    "/bin/zsh -lc ssh -o ConnectTimeout=10 server python3 - <<'PY'\\012print(1)"), true);
  assert.equal(commandMatcher('')('anything'), false);
  assert.equal(commandMatcher('ls')('/bin/zsh -lc ls'), true);
});

test('«Стоп» of an engine task: found → its tree is killed; otherwise the honest reason', async () => {
  const killed: number[] = [];
  const deps = {
    listProcesses,
    kill: (pid: number) => { killed.push(pid); },
    isAlive: (pid: number) => !killed.includes(pid),
    sleep: async () => {},
  };
  const base = { running: true, hasTask: true, rootPid: 200, command: 'npm run dev' };
  assert.deepEqual(await stopEngineTask(base, deps), { ok: true });
  assert.deepEqual(killed, [211, 210], 'the command and its child; the engine (200) lives on');

  assert.deepEqual(await stopEngineTask({ ...base, running: false }, deps), { ok: false, reason: 'turn_ended' });
  assert.deepEqual(await stopEngineTask({ ...base, hasTask: false }, deps), { ok: false, reason: 'not_running' });
  assert.deepEqual(await stopEngineTask({ ...base, rootPid: null }, deps), { ok: false, reason: 'unsupported' });
  assert.deepEqual(await stopEngineTask({ ...base, command: null }, deps), { ok: false, reason: 'unsupported' });
  assert.deepEqual(await stopEngineTask({ ...base, command: 'pytest -x' }, deps), { ok: false, reason: 'not_running' });
  assert.deepEqual(await stopEngineTask(base, { ...deps, kill: () => {}, isAlive: () => true }), { ok: false, reason: 'failed' });
});

test('a task with an engine-reported pid is stopped by that pid — only inside the engine tree', async () => {
  const killed: number[] = [];
  const deps = { listProcesses, kill: (pid: number) => { killed.push(pid); }, isAlive: (pid: number) => !killed.includes(pid), sleep: async () => {} };
  // The command text would not match (Grok wraps it), the pid does.
  assert.deepEqual(await stopEngineTask({ running: true, hasTask: true, rootPid: 200, command: 'different text', pid: 220 }, deps), { ok: true });
  assert.deepEqual(killed, [220]);
  // A pid outside this engine's tree (another chat's command) is never touched.
  assert.deepEqual(await stopEngineTask({ running: true, hasTask: true, rootPid: 200, command: null, pid: 310 }, deps), { ok: false, reason: 'not_running' });
  assert.deepEqual(killed, [220]);
});

test('each task says whether its process was found: no process — no «Стоп» on that row', async () => {
  const tasks = [
    { taskId: 'a', kind: 'bash' as const, description: 'npm run dev', startedAt: 1 },
    { taskId: 'b', kind: 'bash' as const, description: 'pytest', startedAt: 2 },
  ];
  const marked = await markStoppableTasks(tasks, async (task) => task.taskId === 'a');
  assert.deepEqual(marked.map((task) => [task.taskId, task.stoppable]), [['a', true], ['b', false]]);
  const failing = await markStoppableTasks(tasks, async () => { throw new Error('ps'); });
  assert.deepEqual(failing.map((task) => task.stoppable), [false, false]);
});
