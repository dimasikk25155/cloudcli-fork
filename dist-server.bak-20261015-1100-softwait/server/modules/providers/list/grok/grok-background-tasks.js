import { GROK_SUBAGENT_TOOL } from './grok-subagents.js';
const TERMINAL_TOOLS = new Set(['run_terminal_command', 'run_terminal_cmd']);
const MONITOR_TOOL = 'monitor';
const KILL_TOOLS = new Set(['kill_command_or_subagent', 'kill_task']);
/** Tools whose results are Grok's own reports about background tasks. */
const REPORT_TOOLS = new Set([
    'get_command_or_subagent_output', 'get_task_output',
    'wait_commands_or_subagents', 'wait_tasks',
    MONITOR_TOOL, ...KILL_TOOLS,
]);
const DESCRIPTION_MAX = 200;
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
function readInput(value) {
    if (typeof value === 'string') {
        try {
            return record(JSON.parse(value)) ?? {};
        }
        catch {
            return {};
        }
    }
    return record(value) ?? {};
}
function textOf(content) {
    if (typeof content === 'string')
        return content;
    if (Array.isArray(content)) {
        return content
            .map((part) => {
            const block = record(part);
            return block && typeof block.text === 'string' ? block.text : '';
        })
            .filter(Boolean)
            .join('\n');
    }
    return '';
}
function clip(text) {
    const line = text.replace(/\s+/g, ' ').trim();
    return line.length > DESCRIPTION_MAX ? `${line.slice(0, DESCRIPTION_MAX - 1)}…` : line;
}
/** One stream or history line → the calls, results and texts it carries. */
function eventsOf(line) {
    const raw = record(line);
    if (!raw)
        return [];
    // A helper's own lines (live) belong to the crab, not to the main chat.
    if (typeof raw.parent_tool_use_id === 'string' && raw.parent_tool_use_id.trim())
        return [];
    const events = [];
    if (raw.type === 'assistant') {
        const message = record(raw.message);
        if (message && Array.isArray(message.content)) {
            for (const part of message.content) {
                const block = record(part);
                if (block?.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
                    events.push({ kind: 'call', id: block.id, name: block.name, input: readInput(block.input) });
                }
            }
        }
        if (Array.isArray(raw.tool_calls)) {
            for (const item of raw.tool_calls) {
                const call = record(item);
                if (call && typeof call.id === 'string' && typeof call.name === 'string') {
                    events.push({ kind: 'call', id: call.id, name: call.name, input: readInput(call.arguments) });
                }
            }
        }
        return events;
    }
    if (raw.type === 'tool_result' && typeof raw.tool_call_id === 'string') {
        return [{ kind: 'result', id: raw.tool_call_id, text: textOf(raw.content) }];
    }
    if (raw.type === 'user') {
        const content = record(raw.message)?.content ?? raw.content;
        const marked = typeof raw.synthetic_reason === 'string' && raw.synthetic_reason.trim() !== '';
        const synthetic = (text) => marked || text.includes('<system-reminder>');
        if (typeof content === 'string')
            return [{ kind: 'text', text: content, synthetic: synthetic(content) }];
        if (!Array.isArray(content))
            return [];
        for (const part of content) {
            const block = record(part);
            if (!block)
                continue;
            if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
                events.push({ kind: 'result', id: block.tool_use_id, text: textOf(block.content) });
            }
            else if (typeof block.text === 'string') {
                events.push({ kind: 'text', text: block.text, synthetic: synthetic(block.text) });
            }
        }
    }
    return events;
}
function kindOf(taskType) {
    if (taskType === 'bash')
        return 'bash';
    if (taskType === 'monitor')
        return 'monitor';
    return 'other';
}
function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** Whether `text` says the task `id` is over (any of the endings above). */
function saysEnded(text, id) {
    const quoted = escapeRegExp(id);
    if (new RegExp(`Background task "${quoted}" (?:completed|failed|was|ended|exited|terminated)`, 'i').test(text))
        return true;
    if (new RegExp(`Monitor "${quoted}" ended`, 'i').test(text))
        return true;
    const bracket = new RegExp(`--- Task ${quoted} \\[([a-z_]+)\\] ---`, 'i').exec(text);
    if (bracket && bracket[1].toLowerCase() !== 'running')
        return true;
    const header = new RegExp(`=== Task ${quoted} ===\\n(?:[^\\n]*\\n)*?Status: ([a-z_]+)`, 'i').exec(text);
    if (header && header[1].toLowerCase() !== 'running')
        return true;
    return false;
}
/** A started background task in a tool result: (id, type) or null. */
function startedTask(call, text) {
    if (call?.name === GROK_SUBAGENT_TOOL)
        return null;
    if (call?.name === MONITOR_TOOL) {
        const monitor = /Monitor started \(task ([^\s,)]+)/i.exec(text);
        if (monitor)
            return { taskId: monitor[1], taskType: 'monitor' };
    }
    const id = /<task-id>([^<\s]+)<\/task-id>/.exec(text)?.[1];
    const status = /<status>([^<\s]+)<\/status>/.exec(text)?.[1];
    if (!id || (status && status.toLowerCase() !== 'running'))
        return null;
    const taskType = /<task-type>([^<\s]+)<\/task-type>/.exec(text)?.[1];
    // Only commands and monitors are background work of the console; anything
    // else Grok may report this way (a helper) stays out.
    if (taskType && taskType !== 'bash' && taskType !== 'monitor')
        return null;
    if (call && !TERMINAL_TOOLS.has(call.name) && call.name !== MONITOR_TOOL)
        return null;
    return { taskId: id, taskType: taskType ?? (call?.name === MONITOR_TOOL ? 'monitor' : 'bash') };
}
function descriptionOf(call, text) {
    const input = call?.input ?? {};
    for (const key of ['description', 'command']) {
        const value = input[key];
        if (typeof value === 'string' && value.trim())
            return clip(value);
    }
    const summary = /<summary>([\s\S]*?)<\/summary>/.exec(text)?.[1];
    return summary ? clip(summary) : '';
}
export function createGrokBackgroundTaskTracker(options = {}) {
    const now = options.now ?? Date.now;
    const calls = new Map();
    let tasks = [];
    const list = () => tasks.map((task) => ({ ...task }));
    return {
        apply(line) {
            let changed = false;
            for (const event of eventsOf(line)) {
                if (event.kind === 'call') {
                    calls.set(event.id, { name: event.name, input: event.input });
                    continue;
                }
                const call = event.kind === 'result' ? calls.get(event.id) : undefined;
                const text = event.text;
                if (event.kind === 'result' && call && KILL_TOOLS.has(call.name)) {
                    const target = typeof call.input.task_id === 'string' ? call.input.task_id : null;
                    if (target && /^(?:killed|already_exited)\b|not found/i.test(text.trim())) {
                        const before = tasks.length;
                        tasks = tasks.filter((task) => task.taskId !== target);
                        changed ||= tasks.length !== before;
                    }
                }
                const fromGrok = event.kind === 'text' ? event.synthetic : Boolean(call && REPORT_TOOLS.has(call.name));
                if (fromGrok && tasks.length > 0) {
                    const left = tasks.filter((task) => !saysEnded(text, task.taskId));
                    if (left.length !== tasks.length) {
                        tasks = left;
                        changed = true;
                    }
                }
                if (event.kind === 'result') {
                    const started = startedTask(call, text);
                    if (started && !tasks.some((task) => task.taskId === started.taskId)) {
                        tasks = [...tasks, {
                                taskId: started.taskId,
                                kind: kindOf(started.taskType),
                                description: descriptionOf(call, text),
                                startedAt: now(),
                                toolUseId: event.id,
                            }];
                        changed = true;
                    }
                }
            }
            return changed ? list() : null;
        },
        list,
        has: (taskId) => tasks.some((task) => task.taskId === taskId),
    };
}
//# sourceMappingURL=grok-background-tasks.js.map