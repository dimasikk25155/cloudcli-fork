/**
 * Background work of one Claude CLI process (background Bash, monitors,
 * subagents), folded from the SDK's system events into the full list the
 * chat shows under «Фон: N».
 *
 * - `background_tasks_changed` is the level signal and decides membership
 *   (replace semantics, per sdk.d.ts);
 * - `task_started` remembers when a task began (it may precede the level);
 * - `task_progress` adds the last tool a task used;
 * - `task_notification` and a terminal `task_updated` drop a finished task at
 *   once, in case the next level is late.
 *
 * One tracker per CLI process: the level is per-process and nothing is
 * emitted at startup, so a new process starts from an empty list.
 */
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'killed', 'stopped']);
function kindOf(taskType) {
    if (typeof taskType !== 'string')
        return 'other';
    if (taskType === 'local_bash')
        return 'bash';
    if (taskType === 'local_agent' || taskType === 'remote_agent' || taskType === 'in_process_teammate')
        return 'agent';
    if (taskType === 'monitor' || taskType.startsWith('monitor_'))
        return 'monitor';
    if (taskType === 'local_workflow')
        return 'workflow';
    return 'other';
}
function text(value) {
    return typeof value === 'string' && value.trim() ? value : undefined;
}
export function createBackgroundTaskTracker(options = {}) {
    const now = options.now ?? Date.now;
    // Membership, in the CLI's order.
    let order = [];
    // What is known about a task, live or about to be (start edge before level).
    const meta = new Map();
    const list = () => order.map((taskId) => {
        const known = meta.get(taskId);
        const task = {
            taskId,
            kind: known.kind ?? 'other',
            description: known.description ?? '',
            startedAt: known.startedAt,
        };
        if (known.lastTool)
            task.lastTool = known.lastTool;
        return task;
    });
    const metaFor = (taskId) => {
        let known = meta.get(taskId);
        if (!known) {
            known = { startedAt: now() };
            meta.set(taskId, known);
        }
        return known;
    };
    const drop = (taskId) => {
        meta.delete(taskId);
        if (!order.includes(taskId))
            return null;
        order = order.filter((id) => id !== taskId);
        return list();
    };
    return {
        apply(message) {
            if (!message || typeof message !== 'object')
                return null;
            const m = message;
            if (m.type !== 'system')
                return null;
            const taskId = text(m.task_id);
            switch (m.subtype) {
                case 'background_tasks_changed': {
                    const tasks = Array.isArray(m.tasks) ? m.tasks : [];
                    const next = [];
                    for (const raw of tasks) {
                        if (!raw || typeof raw !== 'object')
                            continue;
                        const entry = raw;
                        const id = text(entry.task_id);
                        if (!id || next.includes(id))
                            continue;
                        const known = metaFor(id);
                        known.kind = kindOf(entry.task_type);
                        known.description = text(entry.description) ?? known.description;
                        next.push(id);
                    }
                    for (const id of order) {
                        if (!next.includes(id))
                            meta.delete(id);
                    }
                    order = next;
                    return list();
                }
                case 'task_started': {
                    if (!taskId)
                        return null;
                    const known = metaFor(taskId);
                    if (m.task_type !== undefined)
                        known.kind = kindOf(m.task_type);
                    known.description = text(m.description) ?? known.description;
                    return null;
                }
                case 'task_progress': {
                    if (!taskId || !order.includes(taskId))
                        return null;
                    const known = metaFor(taskId);
                    const lastTool = text(m.last_tool_name);
                    const description = text(m.description) ?? known.description;
                    if (lastTool === known.lastTool && description === known.description)
                        return null;
                    known.lastTool = lastTool ?? known.lastTool;
                    known.description = description;
                    return list();
                }
                case 'task_notification':
                    return taskId ? drop(taskId) : null;
                case 'task_updated': {
                    const patch = m.patch;
                    if (!taskId || !patch || !TERMINAL_STATUSES.has(String(patch.status)))
                        return null;
                    return drop(taskId);
                }
                default:
                    return null;
            }
        },
        list,
        has: (taskId) => order.includes(taskId),
    };
}
//# sourceMappingURL=background-tasks.service.js.map