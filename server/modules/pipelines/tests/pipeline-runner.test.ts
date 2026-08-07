import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { pipelineRunStepsDb } from '@/modules/database/repositories/pipelines.db.js';
import { resolveStepPrompt, type RunnerDeps } from '@/modules/pipelines/pipeline-runner.js';
import { pipelinesService } from '@/modules/pipelines/pipelines.service.js';
import {
  createDeferred,
  createTestUser,
  waitFor,
  waitForRunToFinish,
  withPipelineTestEnv,
} from '@/modules/pipelines/tests/helpers.js';

type RecordedCall = { projectPath: string; prompt: string; userId: number };

function allowAllAccess(): RunnerDeps['checkProjectAccess'] {
  return (_userId, projectPath) => ({ ok: true, projectPath });
}

test('{{prev}} and {{step:N}} are replaced with earlier step outputs', () => {
  assert.equal(resolveStepPrompt('Итог: {{prev}}', ['первый']), 'Итог: первый');
  assert.equal(resolveStepPrompt('Итог: {{ prev }}', ['a', 'b']), 'Итог: b');
  assert.equal(resolveStepPrompt('{{step:1}} + {{step:2}}', ['a', 'b']), 'a + b');
  assert.equal(resolveStepPrompt('{{ step : 1 }}', ['a', 'b']), 'a');
  assert.equal(resolveStepPrompt('без подстановок', ['a']), 'без подстановок');
});

test('a placeholder without a matching output is a hard error', () => {
  assert.throws(() => resolveStepPrompt('{{prev}}', []), /first step/);
  assert.throws(() => resolveStepPrompt('{{step:3}}', ['a']), /has not produced output yet/);
  assert.throws(() => resolveStepPrompt('{{step:0}}', ['a']), /has not produced output yet/);
});

test('steps run in order and receive the previous outputs through placeholders', async () => {
  await withPipelineTestEnv(async ({ artifactsRoot }) => {
    const ownerId = createTestUser('owner');
    const calls: RecordedCall[] = [];
    const deps: RunnerDeps = {
      checkProjectAccess: allowAllAccess(),
      runHeadlessPrompt: async ({ projectPath, prompt, userId }) => {
        calls.push({ projectPath, prompt, userId });
        return { sessionId: `session-${calls.length}`, text: `вывод-${calls.length}` };
      },
    };

    const pipeline = pipelinesService.createPipeline(ownerId, {
      name: 'Аудит и отчёт',
      steps: [
        { name: 'Собрать факты', projectPath: '/workspace/alpha', prompt: 'Собери факты' },
        { name: 'Проверить', projectPath: '/workspace/beta', prompt: 'Проверь это: {{prev}}' },
        { name: 'Отчёт', projectPath: '/workspace/alpha', prompt: 'Отчёт по {{step:1}} и {{step:2}}' },
      ],
    });

    const { runId } = await pipelinesService.startRun(ownerId, pipeline.id, { deps });
    assert.equal(await waitForRunToFinish(runId), 'completed');

    assert.deepEqual(
      calls.map((call) => call.prompt),
      ['Собери факты', 'Проверь это: вывод-1', 'Отчёт по вывод-1 и вывод-2'],
    );
    assert.deepEqual(calls.map((call) => call.projectPath), [
      '/workspace/alpha',
      '/workspace/beta',
      '/workspace/alpha',
    ]);
    assert.deepEqual(calls.map((call) => call.userId), [ownerId, ownerId, ownerId]);

    const steps = pipelineRunStepsDb.listStepsByRun(runId);
    assert.deepEqual(steps.map((step) => step.status), ['completed', 'completed', 'completed']);
    assert.deepEqual(steps.map((step) => step.session_id), ['session-1', 'session-2', 'session-3']);
    // The stored prompt is the resolved one, so the history shows what actually ran.
    assert.equal(steps[1].prompt, 'Проверь это: вывод-1');

    const artifact = await readFile(path.join(artifactsRoot, String(runId), 'step-2-проверить.md'), 'utf8');
    assert.match(artifact, /вывод-2/);
    assert.match(artifact, /Проверь это: вывод-1/);

    const stepOutput = await pipelinesService.readStepOutput(ownerId, runId, 3);
    assert.match(stepOutput.output, /вывод-3/);
  });
});

test('a step in a project the owner cannot reach fails the run and skips the rest', async () => {
  await withPipelineTestEnv(async () => {
    const ownerId = createTestUser('owner');
    const calls: RecordedCall[] = [];
    const deps: RunnerDeps = {
      checkProjectAccess: (_userId, projectPath) =>
        projectPath === '/workspace/foreign'
          ? { ok: false, error: 'You do not have access to this project' }
          : { ok: true, projectPath },
      runHeadlessPrompt: async ({ projectPath, prompt, userId }) => {
        calls.push({ projectPath, prompt, userId });
        return { sessionId: null, text: 'ок' };
      },
    };

    const pipeline = pipelinesService.createPipeline(ownerId, {
      name: 'Попытка дотянуться',
      steps: [
        { name: 'Свой проект', projectPath: '/workspace/mine', prompt: 'Работай' },
        { name: 'Чужой проект', projectPath: '/workspace/foreign', prompt: 'Работай' },
        { name: 'После чужого', projectPath: '/workspace/mine', prompt: 'Работай' },
      ],
    });

    const { runId } = await pipelinesService.startRun(ownerId, pipeline.id, { deps });
    assert.equal(await waitForRunToFinish(runId), 'failed');

    // The engine must never be reached for a denied project.
    assert.deepEqual(calls.map((call) => call.projectPath), ['/workspace/mine']);

    const { run, steps } = pipelinesService.getRun(ownerId, runId);
    assert.match(String(run.error), /do not have access/);
    assert.deepEqual(steps.map((step) => step.status), ['completed', 'failed', 'skipped']);
    assert.match(String(steps[1].error), /do not have access/);
  });
});

test('canceling a run stops it after the current step and skips the rest', async () => {
  await withPipelineTestEnv(async () => {
    const ownerId = createTestUser('owner');
    const firstStep = createDeferred<{ sessionId: string | null; text: string }>();
    const calls: RecordedCall[] = [];
    const deps: RunnerDeps = {
      checkProjectAccess: allowAllAccess(),
      runHeadlessPrompt: async ({ projectPath, prompt, userId }) => {
        calls.push({ projectPath, prompt, userId });
        return calls.length === 1 ? firstStep.promise : { sessionId: null, text: 'не должно случиться' };
      },
    };

    const pipeline = pipelinesService.createPipeline(ownerId, {
      name: 'Долгий сценарий',
      steps: [
        { name: 'Долгий шаг', projectPath: '/workspace/mine', prompt: 'Работай долго' },
        { name: 'Второй шаг', projectPath: '/workspace/mine', prompt: 'Продолжи: {{prev}}' },
      ],
    });

    const { runId } = await pipelinesService.startRun(ownerId, pipeline.id, { deps });
    await waitFor(() => calls.length === 1);

    assert.deepEqual(pipelinesService.cancelRun(ownerId, runId), { status: 'canceling' });
    firstStep.resolve({ sessionId: 'session-1', text: 'частичный вывод' });

    assert.equal(await waitForRunToFinish(runId), 'canceled');
    assert.equal(calls.length, 1);

    const { steps } = pipelinesService.getRun(ownerId, runId);
    assert.deepEqual(steps.map((step) => step.status), ['completed', 'skipped']);

    // A finished run cannot be canceled twice.
    assert.throws(() => pipelinesService.cancelRun(ownerId, runId), /already finished/);
  });
});
