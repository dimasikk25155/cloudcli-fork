// Sequential executor for pipeline runs.
//
// A run is long (minutes per step), so nothing here is tied to an HTTP request:
// the route creates the run row and returns, this module drives it in the
// background and the UI polls the run status.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  pipelineRunStepsDb,
  pipelineRunsDb,
  type PipelineRunStepRow,
} from '@/modules/database/repositories/pipelines.db.js';

const OUTPUT_PREVIEW_LIMIT = 2000;

export type ProjectAccessResult = { ok: true; projectPath: string } | { ok: false; error: string };

export type RunnerDeps = {
  runHeadlessPrompt: (options: {
    projectPath: string;
    prompt: string;
    userId: number;
    provider?: string;
  }) => Promise<{ sessionId: string | null; text: string }>;
  checkProjectAccess: (userId: number, projectPath: string) => ProjectAccessResult | Promise<ProjectAccessResult>;
};

// The agent-run service pulls in every engine CLI, so it is loaded on first use
// rather than at import time — routes and tests that never start a run stay light.
const defaultDeps: RunnerDeps = {
  runHeadlessPrompt: async (options) => {
    const { runHeadlessPrompt } = await import('@/modules/agent-run/agent-run.service.js');
    return runHeadlessPrompt(options);
  },
  checkProjectAccess: async (userId, projectPath) => {
    const { checkProjectAccess } = await import('@/modules/agent-run/agent-run.service.js');
    return checkProjectAccess(userId, projectPath);
  },
};

// Cancellation is cooperative: the flag is checked between steps, because an
// engine call already in flight has no abort handle.
const activeRuns = new Map<number, { canceled: boolean }>();

export function isRunActive(runId: number): boolean {
  return activeRuns.has(runId);
}

/** Returns false when the run is not executing in this process (already finished, or a restart lost it). */
export function requestCancel(runId: number): boolean {
  const control = activeRuns.get(runId);
  if (!control) {
    return false;
  }
  control.canceled = true;
  return true;
}

export function resolveArtifactsRoot(): string {
  return process.env.PIPELINE_ARTIFACTS_DIR || path.join(os.homedir(), '.cloudcli', 'pipeline-runs');
}

export function resolveRunArtifactsDir(runId: number): string {
  return path.join(resolveArtifactsRoot(), String(runId));
}

/** Filesystem-safe, still readable for Cyrillic step names. Separators and dots cannot survive. */
export function slugifyStepName(name: string): string {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'step';
}

export function artifactFileName(stepIndex: number, name: string): string {
  return `step-${stepIndex}-${slugifyStepName(name)}.md`;
}

/**
 * Fills `{{prev}}` and `{{step:N}}` (1-based) with earlier step outputs.
 *
 * This is the whole point of a pipeline — without it every step would be an
 * isolated prompt — so an unresolvable reference is a hard error rather than a
 * silently empty string.
 *
 * @param outputs Outputs of already finished steps, index 0 = step 1.
 */
export function resolveStepPrompt(prompt: string, outputs: string[]): string {
  return String(prompt).replace(/\{\{\s*(?:prev|step\s*:\s*(\d+))\s*\}\}/gu, (match, stepNumber) => {
    const index = stepNumber === undefined ? outputs.length - 1 : Number.parseInt(stepNumber, 10) - 1;

    if (stepNumber === undefined && outputs.length === 0) {
      throw new Error('{{prev}} cannot be used in the first step — there is no previous output yet');
    }

    if (index < 0 || index >= outputs.length) {
      throw new Error(`${match} refers to a step that has not produced output yet`);
    }

    return outputs[index];
  });
}

async function writeStepArtifact(
  artifactsDir: string,
  step: PipelineRunStepRow,
  resolvedPrompt: string,
  output: string,
): Promise<void> {
  await fs.mkdir(artifactsDir, { recursive: true });
  const body = [
    `# ${step.name || `Шаг ${step.step_index}`}`,
    '',
    `- Проект: ${step.project_path}`,
    `- Начат: ${new Date().toISOString()}`,
    '',
    '## Промпт',
    '',
    resolvedPrompt,
    '',
    '## Вывод',
    '',
    output,
    '',
  ].join('\n');

  await fs.writeFile(path.join(artifactsDir, artifactFileName(step.step_index, step.name)), body, 'utf8');
}

/**
 * Drives one run to completion. Never rejects — failures land in the run row,
 * because nobody is awaiting this promise.
 */
export async function runPipeline(runId: number, deps: RunnerDeps = defaultDeps): Promise<void> {
  const run = pipelineRunsDb.getRunById(runId);
  if (!run || run.status !== 'pending') {
    return;
  }

  const control = { canceled: false };
  activeRuns.set(runId, control);

  const artifactsDir = run.artifacts_dir || resolveRunArtifactsDir(runId);
  const outputs: string[] = [];
  let failure: string | null = null;

  try {
    pipelineRunsDb.markRunning(runId);
    const steps = pipelineRunStepsDb.listStepsByRun(runId);

    for (const step of steps) {
      if (control.canceled) {
        break;
      }

      let resolvedPrompt = step.prompt;

      try {
        resolvedPrompt = resolveStepPrompt(step.prompt, outputs);
        pipelineRunStepsDb.markStepRunning(step.id, resolvedPrompt);

        // Re-checked on every step under the pipeline owner's id: access can be
        // revoked mid-run, and a step must never borrow the previous step's grant.
        const access = await deps.checkProjectAccess(run.user_id, step.project_path);
        if (!access.ok) {
          throw new Error(access.error);
        }

        const result = await deps.runHeadlessPrompt({
          projectPath: access.projectPath,
          prompt: resolvedPrompt,
          userId: run.user_id,
        });

        const output = typeof result?.text === 'string' ? result.text : '';
        outputs.push(output);

        try {
          await writeStepArtifact(artifactsDir, step, resolvedPrompt, output);
        } catch (artifactError) {
          // A failed write must not throw away an engine run that already cost
          // minutes — the preview column still carries the answer.
          console.error(`[pipelines] failed to write artifact for run ${runId} step ${step.step_index}:`, artifactError);
        }

        pipelineRunStepsDb.finishStep(step.id, 'completed', {
          sessionId: result?.sessionId ?? null,
          outputPreview: output.slice(0, OUTPUT_PREVIEW_LIMIT),
        });
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        pipelineRunStepsDb.finishStep(step.id, 'failed', { error: failure });
        pipelineRunStepsDb.skipRemainingSteps(runId, step.step_index + 1);
        break;
      }
    }

    if (control.canceled) {
      pipelineRunStepsDb.skipRemainingSteps(runId, 0);
      pipelineRunsDb.finishRun(runId, 'canceled', null);
    } else if (failure) {
      pipelineRunsDb.finishRun(runId, 'failed', failure);
    } else {
      pipelineRunsDb.finishRun(runId, 'completed', null);
    }
  } catch (error) {
    pipelineRunsDb.finishRun(runId, 'failed', error instanceof Error ? error.message : String(error));
  } finally {
    activeRuns.delete(runId);
  }
}
