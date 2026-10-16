import { getConnection } from '../../../modules/database/connection.js';
export const pipelinesDb = {
    listPipelines(userId) {
        const db = getConnection();
        return db.prepare(`
      SELECT * FROM pipelines WHERE user_id = ? ORDER BY updated_at DESC, id DESC
    `).all(userId);
    },
    getPipelineById(pipelineId) {
        const db = getConnection();
        const row = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(pipelineId);
        return row ?? null;
    },
    createPipeline(userId, name, description, stepsJson) {
        const db = getConnection();
        const row = db.prepare(`
      INSERT INTO pipelines (user_id, name, description, steps_json)
      VALUES (?, ?, ?, ?)
      RETURNING *
    `).get(userId, name, description, stepsJson);
        return row;
    },
    updatePipeline(pipelineId, name, description, stepsJson) {
        const db = getConnection();
        const row = db.prepare(`
      UPDATE pipelines
      SET name = ?, description = ?, steps_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      RETURNING *
    `).get(name, description, stepsJson, pipelineId);
        return row ?? null;
    },
    deletePipeline(pipelineId) {
        const db = getConnection();
        return db.prepare('DELETE FROM pipelines WHERE id = ?').run(pipelineId).changes > 0;
    },
};
export const pipelineRunsDb = {
    createRun(pipelineId, userId, trigger, artifactsDir) {
        const db = getConnection();
        return db.prepare(`
      INSERT INTO pipeline_runs (pipeline_id, user_id, status, trigger, artifacts_dir)
      VALUES (?, ?, 'pending', ?, ?)
      RETURNING *
    `).get(pipelineId, userId, trigger, artifactsDir);
    },
    getRunById(runId) {
        const db = getConnection();
        const row = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(runId);
        return row ?? null;
    },
    listRunsByPipeline(pipelineId, limit = 50) {
        const db = getConnection();
        return db.prepare(`
      SELECT * FROM pipeline_runs WHERE pipeline_id = ? ORDER BY id DESC LIMIT ?
    `).all(pipelineId, limit);
    },
    listRunsByUser(userId, limit = 50) {
        const db = getConnection();
        return db.prepare(`
      SELECT * FROM pipeline_runs WHERE user_id = ? ORDER BY id DESC LIMIT ?
    `).all(userId, limit);
    },
    /** Runs still marked live in the DB — after a restart nothing is driving them. */
    listUnfinishedRuns() {
        const db = getConnection();
        return db.prepare(`
      SELECT * FROM pipeline_runs WHERE status IN ('pending', 'running') ORDER BY id
    `).all();
    },
    setArtifactsDir(runId, artifactsDir) {
        const db = getConnection();
        db.prepare('UPDATE pipeline_runs SET artifacts_dir = ? WHERE id = ?').run(artifactsDir, runId);
    },
    markRunning(runId) {
        const db = getConnection();
        db.prepare(`UPDATE pipeline_runs SET status = 'running' WHERE id = ?`).run(runId);
    },
    finishRun(runId, status, error = null) {
        const db = getConnection();
        db.prepare(`
      UPDATE pipeline_runs SET status = ?, error = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(status, error, runId);
    },
};
export const pipelineRunStepsDb = {
    createStep(runId, stepIndex, name, projectPath, prompt) {
        const db = getConnection();
        return db.prepare(`
      INSERT INTO pipeline_run_steps (run_id, step_index, name, project_path, prompt, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
      RETURNING *
    `).get(runId, stepIndex, name, projectPath, prompt);
    },
    listStepsByRun(runId) {
        const db = getConnection();
        return db.prepare(`
      SELECT * FROM pipeline_run_steps WHERE run_id = ? ORDER BY step_index ASC
    `).all(runId);
    },
    getStep(runId, stepIndex) {
        const db = getConnection();
        const row = db.prepare(`
      SELECT * FROM pipeline_run_steps WHERE run_id = ? AND step_index = ?
    `).get(runId, stepIndex);
        return row ?? null;
    },
    markStepRunning(stepId, resolvedPrompt) {
        const db = getConnection();
        // The resolved prompt replaces the template so the history shows what the
        // engine actually received, placeholders already filled in.
        db.prepare(`
      UPDATE pipeline_run_steps
      SET status = 'running', prompt = ?, started_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(resolvedPrompt, stepId);
    },
    finishStep(stepId, status, fields = {}) {
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
    skipRemainingSteps(runId, fromStepIndex) {
        const db = getConnection();
        db.prepare(`
      UPDATE pipeline_run_steps
      SET status = 'skipped', finished_at = CURRENT_TIMESTAMP
      WHERE run_id = ? AND step_index >= ? AND status = 'pending'
    `).run(runId, fromStepIndex);
    },
};
//# sourceMappingURL=pipelines.db.js.map