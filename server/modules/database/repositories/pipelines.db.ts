import { getConnection } from '@/modules/database/connection.js';

export type PipelineRow = {
  id: number;
  user_id: number;
  name: string;
  description: string;
  steps_json: string;
  created_at: string;
  updated_at: string;
};

export type PipelineRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'canceled';

export type PipelineRunRow = {
  id: number;
  pipeline_id: number;
  user_id: number;
  status: PipelineRunStatus;
  trigger: string;
  artifacts_dir: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

export type PipelineRunStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type PipelineRunStepRow = {
  id: number;
  run_id: number;
  step_index: number;
  name: string;
  project_path: string;
  prompt: string;
  status: PipelineRunStepStatus;
  session_id: string | null;
  output_preview: string;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export const pipelinesDb = {
  listPipelines(userId: number): PipelineRow[] {
    const db = getConnection();
    return db.prepare(`
      SELECT * FROM pipelines WHERE user_id = ? ORDER BY updated_at DESC, id DESC
    `).all(userId) as PipelineRow[];
  },

  getPipelineById(pipelineId: number): PipelineRow | null {
    const db = getConnection();
    const row = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(pipelineId) as PipelineRow | undefined;
    return row ?? null;
  },

  createPipeline(userId: number, name: string, description: string, stepsJson: string): PipelineRow {
    const db = getConnection();
    const row = db.prepare(`
      INSERT INTO pipelines (user_id, name, description, steps_json)
      VALUES (?, ?, ?, ?)
      RETURNING *
    `).get(userId, name, description, stepsJson) as PipelineRow;
    return row;
  },

  updatePipeline(pipelineId: number, name: string, description: string, stepsJson: string): PipelineRow | null {
    const db = getConnection();
    const row = db.prepare(`
      UPDATE pipelines
      SET name = ?, description = ?, steps_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      RETURNING *
    `).get(name, description, stepsJson, pipelineId) as PipelineRow | undefined;
    return row ?? null;
  },

  deletePipeline(pipelineId: number): boolean {
    const db = getConnection();
    return db.prepare('DELETE FROM pipelines WHERE id = ?').run(pipelineId).changes > 0;
  },
};

export const pipelineRunsDb = {
  createRun(pipelineId: number, userId: number, trigger: string, artifactsDir: string): PipelineRunRow {
    const db = getConnection();
    return db.prepare(`
      INSERT INTO pipeline_runs (pipeline_id, user_id, status, trigger, artifacts_dir)
      VALUES (?, ?, 'pending', ?, ?)
      RETURNING *
    `).get(pipelineId, userId, trigger, artifactsDir) as PipelineRunRow;
  },

  getRunById(runId: number): PipelineRunRow | null {
    const db = getConnection();
    const row = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(runId) as PipelineRunRow | undefined;
    return row ?? null;
  },

  listRunsByPipeline(pipelineId: number, limit = 50): PipelineRunRow[] {
    const db = getConnection();
    return db.prepare(`
      SELECT * FROM pipeline_runs WHERE pipeline_id = ? ORDER BY id DESC LIMIT ?
    `).all(pipelineId, limit) as PipelineRunRow[];
  },

  listRunsByUser(userId: number, limit = 50): PipelineRunRow[] {
    const db = getConnection();
    return db.prepare(`
      SELECT * FROM pipeline_runs WHERE user_id = ? ORDER BY id DESC LIMIT ?
    `).all(userId, limit) as PipelineRunRow[];
  },

  /** Runs still marked live in the DB — after a restart nothing is driving them. */
  listUnfinishedRuns(): PipelineRunRow[] {
    const db = getConnection();
    return db.prepare(`
      SELECT * FROM pipeline_runs WHERE status IN ('pending', 'running') ORDER BY id
    `).all() as PipelineRunRow[];
  },

  setArtifactsDir(runId: number, artifactsDir: string): void {
    const db = getConnection();
    db.prepare('UPDATE pipeline_runs SET artifacts_dir = ? WHERE id = ?').run(artifactsDir, runId);
  },

  markRunning(runId: number): void {
    const db = getConnection();
    db.prepare(`UPDATE pipeline_runs SET status = 'running' WHERE id = ?`).run(runId);
  },

  finishRun(runId: number, status: PipelineRunStatus, error: string | null = null): void {
    const db = getConnection();
    db.prepare(`
      UPDATE pipeline_runs SET status = ?, error = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(status, error, runId);
  },
};

export const pipelineRunStepsDb = {
  createStep(
    runId: number,
    stepIndex: number,
    name: string,
    projectPath: string,
    prompt: string,
  ): PipelineRunStepRow {
    const db = getConnection();
    return db.prepare(`
      INSERT INTO pipeline_run_steps (run_id, step_index, name, project_path, prompt, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
      RETURNING *
    `).get(runId, stepIndex, name, projectPath, prompt) as PipelineRunStepRow;
  },

  listStepsByRun(runId: number): PipelineRunStepRow[] {
    const db = getConnection();
    return db.prepare(`
      SELECT * FROM pipeline_run_steps WHERE run_id = ? ORDER BY step_index ASC
    `).all(runId) as PipelineRunStepRow[];
  },

  getStep(runId: number, stepIndex: number): PipelineRunStepRow | null {
    const db = getConnection();
    const row = db.prepare(`
      SELECT * FROM pipeline_run_steps WHERE run_id = ? AND step_index = ?
    `).get(runId, stepIndex) as PipelineRunStepRow | undefined;
    return row ?? null;
  },

  markStepRunning(stepId: number, resolvedPrompt: string): void {
    const db = getConnection();
    // The resolved prompt replaces the template so the history shows what the
    // engine actually received, placeholders already filled in.
    db.prepare(`
      UPDATE pipeline_run_steps
      SET status = 'running', prompt = ?, started_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(resolvedPrompt, stepId);
  },

  finishStep(
    stepId: number,
    status: PipelineRunStepStatus,
    fields: { sessionId?: string | null; outputPreview?: string; error?: string | null } = {},
  ): void {
    const db = getConnection();
    db.prepare(`
      UPDATE pipeline_run_steps
      SET status = ?,
          session_id = COALESCE(?, session_id),
          output_preview = COALESCE(?, output_preview),
          error = ?,
          finished_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, fields.sessionId ?? null, fields.outputPreview ?? null, fields.error ?? null, stepId);
  },

  skipRemainingSteps(runId: number, fromStepIndex: number): void {
    const db = getConnection();
    db.prepare(`
      UPDATE pipeline_run_steps
      SET status = 'skipped', finished_at = CURRENT_TIMESTAMP
      WHERE run_id = ? AND step_index >= ? AND status = 'pending'
    `).run(runId, fromStepIndex);
  },
};
