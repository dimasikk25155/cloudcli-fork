/**
 * Schedules repository.
 *
 * A schedule is a recurring unattended run owned by one user. `os_label` holds
 * the identifier the host scheduler knows the job by (launchd label / systemd
 * unit name), which is what lets the app reconcile its rows with the real
 * plists/units after a crash or a manual deletion outside the UI.
 */

import { getConnection } from '@/modules/database/connection.js';

export type ScheduleKind = 'prompt' | 'pipeline';

export type ScheduleRow = {
  id: number;
  user_id: number;
  name: string;
  kind: ScheduleKind;
  project_path: string | null;
  prompt: string;
  pipeline_id: number | null;
  hour: number;
  minute: number;
  /** Empty string means "every day"; otherwise a comma list of 0..6, 0 = Sunday. */
  weekdays: string;
  enabled: number;
  os_label: string | null;
  last_run_at: string | null;
  last_status: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateScheduleInput = {
  userId: number;
  name: string;
  kind?: ScheduleKind;
  projectPath?: string | null;
  prompt?: string;
  pipelineId?: number | null;
  hour: number;
  minute: number;
  weekdays?: string;
  enabled?: boolean;
};

export type UpdateScheduleInput = {
  name?: string;
  kind?: ScheduleKind;
  projectPath?: string | null;
  prompt?: string;
  pipelineId?: number | null;
  hour?: number;
  minute?: number;
  weekdays?: string;
  enabled?: boolean;
};

const SELECT_COLUMNS = `
  id, user_id, name, kind, project_path, prompt, pipeline_id,
  hour, minute, weekdays, enabled, os_label,
  last_run_at, last_status, created_at, updated_at
`;

// Column name per accepted patch key, so the dynamic UPDATE below can never
// interpolate anything a caller made up.
const UPDATABLE_COLUMNS: Record<keyof UpdateScheduleInput, string> = {
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
  listByUser(userId: number): ScheduleRow[] {
    const db = getConnection();
    return db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM schedules WHERE user_id = ? ORDER BY hour, minute, id`)
      .all(userId) as ScheduleRow[];
  },

  /** Every schedule regardless of owner (reconciliation with the host scheduler). */
  listAll(): ScheduleRow[] {
    const db = getConnection();
    return db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM schedules ORDER BY id`)
      .all() as ScheduleRow[];
  },

  getById(id: number): ScheduleRow | null {
    const db = getConnection();
    const row = db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM schedules WHERE id = ?`)
      .get(id) as ScheduleRow | undefined;
    return row ?? null;
  },

  create(input: CreateScheduleInput): ScheduleRow {
    const db = getConnection();
    const row = db
      .prepare(
        `INSERT INTO schedules
           (user_id, name, kind, project_path, prompt, pipeline_id, hour, minute, weekdays, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING ${SELECT_COLUMNS}`
      )
      .get(
        input.userId,
        input.name,
        input.kind ?? 'prompt',
        input.projectPath ?? null,
        input.prompt ?? '',
        input.pipelineId ?? null,
        input.hour,
        input.minute,
        input.weekdays ?? '',
        input.enabled === false ? 0 : 1
      ) as ScheduleRow;
    return row;
  },

  update(id: number, patch: UpdateScheduleInput): ScheduleRow | null {
    const assignments: string[] = [];
    const values: unknown[] = [];

    for (const [key, column] of Object.entries(UPDATABLE_COLUMNS) as [keyof UpdateScheduleInput, string][]) {
      const value = patch[key];
      if (value === undefined) continue;
      assignments.push(`${column} = ?`);
      values.push(key === 'enabled' ? (value ? 1 : 0) : value);
    }

    if (assignments.length === 0) {
      return schedulesDb.getById(id);
    }

    const db = getConnection();
    const row = db
      .prepare(
        `UPDATE schedules SET ${assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
         RETURNING ${SELECT_COLUMNS}`
      )
      .get(...values, id) as ScheduleRow | undefined;
    return row ?? null;
  },

  setEnabled(id: number, enabled: boolean): ScheduleRow | null {
    return schedulesDb.update(id, { enabled });
  },

  /** Records which host-scheduler entry currently backs this row (null when unscheduled). */
  setOsLabel(id: number, osLabel: string | null): void {
    const db = getConnection();
    db.prepare('UPDATE schedules SET os_label = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(osLabel, id);
  },

  markRun(id: number, status: string): void {
    const db = getConnection();
    db.prepare(
      'UPDATE schedules SET last_run_at = CURRENT_TIMESTAMP, last_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(status.slice(0, 500), id);
  },

  remove(id: number): boolean {
    const db = getConnection();
    return db.prepare('DELETE FROM schedules WHERE id = ?').run(id).changes > 0;
  },
};
