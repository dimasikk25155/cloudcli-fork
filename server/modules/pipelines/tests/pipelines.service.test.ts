import assert from 'node:assert/strict';
import test from 'node:test';

import { projectsDb, userProjectAccessDb } from '@/modules/database/index.js';
import type { RunnerDeps } from '@/modules/pipelines/pipeline-runner.js';
import { pipelinesService } from '@/modules/pipelines/pipelines.service.js';
import { createTestUser, importRealAccessCheck, waitForRunToFinish, withPipelineTestEnv } from '@/modules/pipelines/tests/helpers.js';

const VALID_STEPS = [{ name: 'Шаг', projectPath: '/workspace/alpha', prompt: 'Сделай' }];

test('pipelines are owned: another user cannot read, run or delete them', async () => {
  await withPipelineTestEnv(async () => {
    const ownerId = createTestUser('owner');
    const strangerId = createTestUser('stranger');
    const pipeline = pipelinesService.createPipeline(ownerId, { name: 'Мой сценарий', steps: VALID_STEPS });

    assert.equal(pipelinesService.listPipelines(ownerId).length, 1);
    assert.deepEqual(pipelinesService.listPipelines(strangerId), []);
    assert.throws(() => pipelinesService.getPipeline(strangerId, pipeline.id), /Pipeline not found/);
    assert.throws(() => pipelinesService.deletePipeline(strangerId, pipeline.id), /Pipeline not found/);
    await assert.rejects(() => pipelinesService.startRun(strangerId, pipeline.id), /Pipeline not found/);
  });
});

test('pipeline payloads are validated before anything is stored', async () => {
  await withPipelineTestEnv(() => {
    const ownerId = createTestUser('owner');

    assert.throws(() => pipelinesService.createPipeline(ownerId, { name: '  ', steps: VALID_STEPS }), /name is required/);
    assert.throws(() => pipelinesService.createPipeline(ownerId, { name: 'X', steps: [] }), /at least one step/);
    assert.throws(
      () => pipelinesService.createPipeline(ownerId, { name: 'X', steps: [{ projectPath: '', prompt: 'a' }] }),
      /projectPath is required/,
    );
    assert.throws(
      () => pipelinesService.createPipeline(ownerId, { name: 'X', steps: [{ projectPath: '/p', prompt: '  ' }] }),
      /prompt is required/,
    );

    // An unnamed step still gets a label so the history is readable.
    const pipeline = pipelinesService.createPipeline(ownerId, {
      name: 'Без имён',
      steps: [{ projectPath: '/workspace/alpha', prompt: 'Сделай' }],
    });
    assert.equal(pipeline.steps[0].name, 'Шаг 1');
  });
});

test('update and delete keep the pipeline consistent', async () => {
  await withPipelineTestEnv(() => {
    const ownerId = createTestUser('owner');
    const pipeline = pipelinesService.createPipeline(ownerId, { name: 'Первый', steps: VALID_STEPS });

    const updated = pipelinesService.updatePipeline(ownerId, pipeline.id, {
      name: 'Второй',
      description: 'Описание',
      steps: [
        { name: 'A', projectPath: '/workspace/alpha', prompt: 'Раз' },
        { name: 'B', projectPath: '/workspace/beta', prompt: 'Два: {{prev}}' },
      ],
    });

    assert.equal(updated.name, 'Второй');
    assert.equal(updated.description, 'Описание');
    assert.equal(updated.steps.length, 2);
    assert.equal(pipelinesService.getPipeline(ownerId, pipeline.id).steps[1].prompt, 'Два: {{prev}}');

    pipelinesService.deletePipeline(ownerId, pipeline.id);
    assert.deepEqual(pipelinesService.listPipelines(ownerId), []);
  });
});

test('an employee cannot reach a project through a pipeline step (real access check)', async () => {
  await withPipelineTestEnv(async () => {
    const employeeId = createTestUser('worker');
    const granted = projectsDb.createProjectPath('/tmp/neo3-granted');
    const forbidden = projectsDb.createProjectPath('/tmp/neo3-forbidden');
    assert.ok(granted.project && forbidden.project);
    userProjectAccessDb.grantAccess(employeeId, granted.project!.project_id, null);

    const engineCalls: string[] = [];
    // Only the engine is faked here — the access decision is the production one.
    const deps: RunnerDeps = {
      checkProjectAccess: await importRealAccessCheck(),
      runHeadlessPrompt: async ({ projectPath }) => {
        engineCalls.push(projectPath);
        return { sessionId: null, text: 'готово' };
      },
    };

    const pipeline = pipelinesService.createPipeline(employeeId, {
      name: 'Обход доступа',
      steps: [
        { name: 'Разрешённый', projectPath: '/tmp/neo3-granted', prompt: 'Работай' },
        { name: 'Запрещённый', projectPath: '/tmp/neo3-forbidden', prompt: 'Работай' },
      ],
    });

    const { runId } = await pipelinesService.startRun(employeeId, pipeline.id, { deps });
    assert.equal(await waitForRunToFinish(runId), 'failed');

    assert.deepEqual(engineCalls, ['/tmp/neo3-granted']);
    const { steps } = pipelinesService.getRun(employeeId, runId);
    assert.deepEqual(steps.map((step) => step.status), ['completed', 'failed']);
    assert.match(String(steps[1].error), /do not have access/);
  });
});

test('an unregistered project is denied even for an admin owner', async () => {
  await withPipelineTestEnv(async () => {
    const adminId = createTestUser('boss', 'admin');

    const deps: RunnerDeps = {
      checkProjectAccess: await importRealAccessCheck(),
      runHeadlessPrompt: async () => {
        throw new Error('engine must not be reached');
      },
    };

    const pipeline = pipelinesService.createPipeline(adminId, {
      name: 'Незарегистрированный проект',
      steps: [{ name: 'Шаг', projectPath: '/tmp/neo3-unknown', prompt: 'Работай' }],
    });

    const { runId } = await pipelinesService.startRun(adminId, pipeline.id, { deps });
    assert.equal(await waitForRunToFinish(runId), 'failed');

    const { steps } = pipelinesService.getRun(adminId, runId);
    assert.equal(steps[0].status, 'failed');
    assert.match(String(steps[0].error), /not registered/);
  });
});

test('run history is scoped to the owner and step output is readable', async () => {
  await withPipelineTestEnv(async () => {
    const deps: RunnerDeps = {
      checkProjectAccess: (_userId, projectPath) => ({ ok: true, projectPath }),
      runHeadlessPrompt: async () => ({ sessionId: 'session-1', text: 'итоговый вывод' }),
    };

    const ownerId = createTestUser('owner');
    const strangerId = createTestUser('stranger');
    const pipeline = pipelinesService.createPipeline(ownerId, { name: 'История', steps: VALID_STEPS });
    const { runId } = await pipelinesService.startRun(ownerId, pipeline.id, { deps });
    assert.equal(await waitForRunToFinish(runId), 'completed');

    assert.equal(pipelinesService.listRuns(ownerId, null).length, 1);
    assert.equal(pipelinesService.listRuns(ownerId, pipeline.id)[0].id, runId);
    assert.deepEqual(pipelinesService.listRuns(strangerId, null), []);
    assert.throws(() => pipelinesService.getRun(strangerId, runId), /Run not found/);
    await assert.rejects(() => pipelinesService.readStepOutput(strangerId, runId, 1), /Run not found/);

    const output = await pipelinesService.readStepOutput(ownerId, runId, 1);
    assert.match(output.output, /итоговый вывод/);
    assert.ok(output.artifactPath);
  });
});
