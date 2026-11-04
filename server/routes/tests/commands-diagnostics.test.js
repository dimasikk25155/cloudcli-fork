import assert from 'node:assert/strict';
import test from 'node:test';

import { builtInCommandsFor, executeBuiltInCommand } from '../commands.js';

const names = (list) => list.map((command) => command.name);
const allOn = () => true;

test('/doctor and /skill-doctor are offered to admins only, /advisor to everyone', () => {
  const admin = names(builtInCommandsFor(1, allOn, () => true));
  const member = names(builtInCommandsFor(2, allOn, () => false));
  for (const name of ['/doctor', '/skill-doctor', '/advisor']) assert.ok(admin.includes(name), name);
  assert.ok(member.includes('/advisor'));
  assert.ok(!member.includes('/doctor'));
  assert.ok(!member.includes('/skill-doctor'));
});

test('with modDiagnostics off none of the three commands is offered or runs', async () => {
  const offered = names(builtInCommandsFor(1, (_id, key) => key !== 'modDiagnostics', () => true));
  for (const name of ['/doctor', '/skill-doctor', '/advisor']) assert.ok(!offered.includes(name), name);
  await assert.rejects(
    executeBuiltInCommand('/advisor', ['q'], {}, 1, (_id, key) => key !== 'modDiagnostics', () => true),
    (error) => error.code === 'MOD_OFF',
  );
});

test('a non-admin cannot run /doctor or /skill-doctor', async () => {
  for (const name of ['/doctor', '/skill-doctor']) {
    await assert.rejects(executeBuiltInCommand(name, [], {}, 2, allOn, () => false), (error) => error.code === 'FORBIDDEN');
  }
});

test('/advisor hands the question to the composer', async () => {
  const result = await executeBuiltInCommand('/advisor', ['что', 'думаешь?'], {}, 2, allOn, () => false);
  assert.deepEqual(result, { type: 'builtin', action: 'advisor', data: { question: 'что думаешь?' } });
});
