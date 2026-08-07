// Pipelines ("Сценарии"): a saved, ordered list of prompts that run one after
// another, each in its own project, passing output forward.
//
// Deliberately not an orchestrator agent — the list of steps is always explicit,
// nothing here decides which project should handle a task.

import fs from 'node:fs/promises';
import path from 'node:path';

import {
  pipelineRunStepsDb,
  pipelineRunsDb,
  pipelinesDb,
  type PipelineRow,
  type PipelineRunRow,
  type PipelineRunStepRow,
} from '@/modules/database/repositories/pipelines.db.js';
import {
  artifactFileName,
  requestCancel,
  resolveRunArtifactsDir,
  runPipeline,
  type RunnerDeps,
} from '@/modules/pipelines/pipeline-runner.js';
import { AppError } from '@/shared/utils.js';

export type PipelineStep = {
  name: string;
  projectPath: string;
  prompt: string;
};

export type PipelineDto = {
  id: number;
  name: string;
  description: string;
  steps: PipelineStep[];
  createdAt: string;
  updatedAt: string;
};

export type PipelineRunDto = {
  id: number;
  pipelineId: number;
  pipelineName: string;
  status: string;
  trigger: string;
  artifactsDir: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type PipelineRunStepDto = {
  stepIndex: number;
  name: string;
  projectPath: string;
  prompt: string;
  status: string;
  sessionId: string | null;
  outputPreview: string;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

const MAX_STEPS = 20;

function parseSteps(stepsJson: string): PipelineStep[] {
  try {
    const parsed = JSON.parse(stepsJson);
    return Array.isArray(parsed) ? (parsed as PipelineStep[]) : [];
  } catch {
    return [];
  }
}

function toPipelineDto(row: PipelineRow): PipelineDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    steps: parseSteps(row.steps_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRunDto(row: PipelineRunRow, pipelineName: string): PipelineRunDto {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    pipelineName,
    status: row.status,
    trigger: row.trigger,
    artifactsDir: row.artifacts_dir,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function toRunStepDto(row: PipelineRunStepRow): PipelineRunStepDto {
  return {
    stepIndex: row.step_index,
    name: row.name,
    projectPath: row.project_path,
    prompt: row.prompt,
    status: row.status,
    sessionId: row.session_id,
    outputPreview: row.output_preview,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function badRequest(message: string): AppError {
  return new AppError(message, { code: 'PIPELINE_INVALID', statusCode: 400 });
}

/** Validates the client payload and drops anything the schema does not own. */
export function normalizeSteps(input: unknown): PipelineStep[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw badRequest('A pipeline needs at least one step');
  }

  if (input.length > MAX_STEPS) {
    throw badRequest(`A pipeline cannot have more than ${MAX_STEPS} steps`);
  }

  return input.map((rawStep, index) => {
    const step = (rawStep ?? {}) as Partial<PipelineStep>;
    const projectPath = String(step.projectPath ?? '').trim();
    const prompt = String(step.prompt ?? '').trim();

    if (!projectPath) {
      throw badRequest(`Step ${index + 1}: projectPath is required`);
    }
    if (!prompt) {
      throw badRequest(`Step ${index + 1}: prompt is required`);
    }

    return {
      name: String(step.name ?? '').trim() || `Шаг ${index + 1}`,
      projectPath,
      prompt,
    };
  });
}

function normalizeName(input: unknown): string {
  const name = String(input ?? '').trim();
  if (!name) {
    throw badRequest('Pipeline name is required');
  }
  return name.slice(0, 200);
}

/**
 * Ownership is the access rule for pipelines themselves: a pipeline is visible
 * only to the user who created it, so nobody can run — or read the output of —
 * someone else's steps.
 */
function requireOwnedPipeline(userId: number, pipelineId: number): PipelineRow {
  const pipeline = pipelinesDb.getPipelineById(pipelineId);
  if (!pipeline || pipeline.user_id !== userId) {
    throw new AppError('Pipeline not found', { code: 'PIPELINE_NOT_FOUND', statusCode: 404 });
  }
  return pipeline;
}

function requireOwnedRun(userId: number, runId: number): PipelineRunRow {
  const run = pipelineRunsDb.getRunById(runId);
  if (!run || run.user_id !== userId) {
    throw new AppError('Run not found', { code: 'PIPELINE_RUN_NOT_FOUND', statusCode: 404 });
  }
  return run;
}

function pipelineNameFor(pipelineId: number): string {
  return pipelinesDb.getPipelineById(pipelineId)?.name ?? '';
}

export const pipelinesService = {
  /**
   * A run lives in the process that started it, so a restart leaves its row at
   * pending/running with nobody advancing it — the UI would show a spinner
   * forever. Close them once at boot and say why.
   */
  recoverInterruptedRuns(): number {
    const stuck = pipelineRunsDb.listUnfinishedRuns();
    for (const run of stuck) {
      pipelineRunStepsDb.skipRemainingSteps(run.id, 0);
      pipelineRunsDb.finishRun(run.id, 'failed', 'Прервано перезапуском сервера');
    }
    if (stuck.length > 0) {
      console.log(`[pipelines] closed ${stuck.length} run(s) interrupted by a restart`);
    }
    return stuck.length;
  },

  listPipelines(userId: number): PipelineDto[] {
    return pipelinesDb.listPipelines(userId).map(toPipelineDto);
  },

  getPipeline(userId: number, pipelineId: number): PipelineDto {
    return toPipelineDto(requireOwnedPipeline(userId, pipelineId));
  },

  createPipeline(userId: number, body: { name?: unknown; description?: unknown; steps?: unknown }): PipelineDto {
    const name = normalizeName(body?.name);
    const description = String(body?.description ?? '').trim().slice(0, 1000);
    const steps = normalizeSteps(body?.steps);
    return toPipelineDto(pipelinesDb.createPipeline(userId, name, description, JSON.stringify(steps)));
  },

  updatePipeline(
    userId: number,
    pipelineId: number,
    body: { name?: unknown; description?: unknown; steps?: unknown },
  ): PipelineDto {
    requireOwnedPipeline(userId, pipelineId);
    const name = normalizeName(body?.name);
    const description = String(body?.description ?? '').trim().slice(0, 1000);
    const steps = normalizeSteps(body?.steps);
    const updated = pipelinesDb.updatePipeline(pipelineId, name, description, JSON.stringify(steps));
    if (!updated) {
      throw new AppError('Pipeline not found', { code: 'PIPELINE_NOT_FOUND', statusCode: 404 });
    }
    return toPipelineDto(updated);
  },

  deletePipeline(userId: number, pipelineId: number): void {
    requireOwnedPipeline(userId, pipelineId);
    pipelinesDb.deletePipeline(pipelineId);
  },

  /**
   * Creates the run rows, kicks the runner off in the background and returns
   * immediately — a run takes minutes, the caller polls `getRun` for progress.
   */
  async startRun(
    userId: number,
    pipelineId: number,
    options: { trigger?: string; deps?: RunnerDeps } = {},
  ): Promise<{ runId: number; artifactsDir: string }> {
    const pipeline = requireOwnedPipeline(userId, pipelineId);
    const steps = parseSteps(pipeline.steps_json);
    if (steps.length === 0) {
      throw badRequest('This pipeline has no steps');
    }

    const run = pipelineRunsDb.createRun(pipelineId, userId, options.trigger || 'manual', '');
    const artifactsDir = resolveRunArtifactsDir(run.id);
    pipelineRunsDb.setArtifactsDir(run.id, artifactsDir);
    await fs.mkdir(artifactsDir, { recursive: true });

    steps.forEach((step, index) => {
      pipelineRunStepsDb.createStep(run.id, index + 1, step.name, step.projectPath, step.prompt);
    });

    void runPipeline(run.id, options.deps).catch((error) => {
      console.error(`[pipelines] run ${run.id} crashed:`, error);
    });

    return { runId: run.id, artifactsDir };
  },

  listRuns(userId: number, pipelineId: number | null, limit = 50): PipelineRunDto[] {
    if (pipelineId !== null) {
      const pipeline = requireOwnedPipeline(userId, pipelineId);
      return pipelineRunsDb.listRunsByPipeline(pipelineId, limit).map((run) => toRunDto(run, pipeline.name));
    }
    return pipelineRunsDb.listRunsByUser(userId, limit).map((run) => toRunDto(run, pipelineNameFor(run.pipeline_id)));
  },

  getRun(userId: number, runId: number): { run: PipelineRunDto; steps: PipelineRunStepDto[] } {
    const run = requireOwnedRun(userId, runId);
    return {
      run: toRunDto(run, pipelineNameFor(run.pipeline_id)),
      steps: pipelineRunStepsDb.listStepsByRun(runId).map(toRunStepDto),
    };
  },

  cancelRun(userId: number, runId: number): { status: string } {
    const run = requireOwnedRun(userId, runId);

    if (run.status !== 'pending' && run.status !== 'running') {
      throw new AppError('This run has already finished', { code: 'PIPELINE_RUN_FINISHED', statusCode: 409 });
    }

    if (requestCancel(runId)) {
      // The runner owns the final status: it stops before the next step and
      // writes 'canceled' itself, so the step currently in flight is not lost.
      return { status: 'canceling' };
    }

    // Nothing is executing this run in this process (a restart lost it), so the
    // row would stay 'running' forever unless we close it here.
    pipelineRunStepsDb.skipRemainingSteps(runId, 0);
    pipelineRunsDb.finishRun(runId, 'canceled', null);
    return { status: 'canceled' };
  },

  /** Full step output from disk, falling back to the DB preview if the artifact is gone. */
  async readStepOutput(
    userId: number,
    runId: number,
    stepIndex: number,
  ): Promise<{ stepIndex: number; name: string; output: string; artifactPath: string | null; truncated: boolean }> {
    const run = requireOwnedRun(userId, runId);
    const step = pipelineRunStepsDb.getStep(runId, stepIndex);
    if (!step) {
      throw new AppError('Step not found', { code: 'PIPELINE_STEP_NOT_FOUND', statusCode: 404 });
    }

    const artifactsDir = run.artifacts_dir || resolveRunArtifactsDir(runId);
    const artifactPath = path.join(artifactsDir, artifactFileName(step.step_index, step.name));

    try {
      const output = await fs.readFile(artifactPath, 'utf8');
      return { stepIndex: step.step_index, name: step.name, output, artifactPath, truncated: false };
    } catch {
      return {
        stepIndex: step.step_index,
        name: step.name,
        output: step.output_preview,
        artifactPath: null,
        truncated: step.output_preview.length > 0,
      };
    }
  },
};
