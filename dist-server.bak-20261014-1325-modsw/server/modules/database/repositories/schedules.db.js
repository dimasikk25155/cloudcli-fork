/**
 * Schedules repository.
 *
 * A schedule is a recurring unattended run owned by one user. `os_label` holds
 * the identifier the host scheduler knows the job by (launchd label / systemd
 * unit name), which is what lets the app reconcile its rows with the real
 * plists/units after a crash or a manual deletion outside the UI.
 */
import { getConnection } from '../../../modules/database/connection.js';
const SELECT_COLUMNS = `
  id, user_id, name, kind, project_path, prompt, pipeline_id,
  hour, minute, weekdays, enabled, os_label,
  last_run_at, last_status, created_at, updated_at
`;
// Column name per accepted patch key, so the dynamic UPDATE below can never
// interpolate anything a caller made up.
const UPDATABLE_COLUMNS = {
    name: 'name',
    kind: 'kind',
    projectPath: 'project_path',
    prompt: 'prompt',
    pipelineId: 'pipeline_id',
    hour: 'hour',
    minute: 'minute',
    weekdays: 'weekdays',
    enabled: 'enabled',
};
export const schedulesDb = {
    /** Every schedule owned by a user, ordered the way the UI lists them. */
    listByUser(userId) {
        const db = getConnection();
        return db
            .prepare(`SELECT ${SELECT_COLUMNS} FROM schedules WHERE user_id = ? ORDER BY hour, minute, id`)
            .all(userId);
    },
    /** Every schedule regardless of owner (reconciliation with the host scheduler). */
    listAll() {
        const db = getConnection();
        return db
            .prepare(`SELECT ${SELECT_COLUMNS} FROM schedules ORDER BY id`)
            .all();
    },
    getById(id) {
        const db = getConnection();
        const row = db
            .prepare(`SELECT ${SELECT_COLUMNS} FROM schedules WHERE id = ?`)
            .get(id);
        return row ?? null;
    },
    create(input) {
        const db = getConnection();
        const row = db
            .prepare(`INSERT INTO schedules
           (user_id, name, kind, project_path, prompt, pipeline_id, hour, minute, weekdays, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING ${SELECT_COLUMNS}`)
            .get(input.userId, input.name, input.kind ?? 'prompt', input.projectPath ?? null, input.prompt ?? '', input.pipelineId ?? null, input.hour, input.minute, input.weekdays ?? '', input.enabled === false ? 0 : 1);
        return row;
    },
    update(id, patch) {
        const assignments = [];
        const values = [];
        for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
            const value = patch[key];
            if (value === undefined)
                continue;
            assignments.push(`${column} = ?`);
            values.push(key === 'enabled' ? (value ? 1 : 0) : value);
        }
        if (assignments.length === 0) {
            return schedulesDb.getById(id);
        }
        const db = getConnection();
        const row = db
            .prepare(`UPDATE schedules SET ${assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
         RETURNING ${SELECT_COLUMNS}`)
            .get(...values, id);
        return row ?? null;
    },
    setEnabled(id, enabled) {
        return schedulesDb.update(id, { enabled });
    },
    /** Records which host-scheduler entry currently backs this row (null when unscheduled). */
    setOsLabel(id, osLabel) {
        const db = getConnection();
        db.prepare('UPDATE schedules SET os_label = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(osLabel, id);
    },
    markRun(id, status) {
        const db = getConnection();
        db.prepare('UPDATE schedules SET last_run_at = CURRENT_TIMESTAMP, last_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status.slice(0, 500), id);
    },
    remove(id) {
        const db = getConnection();
        return db.prepare('DELETE FROM schedules WHERE id = ?').run(id).changes > 0;
    },
};
//# sourceMappingURL=schedules.db.js.map