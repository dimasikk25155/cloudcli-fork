import type { BackgroundTask, BackgroundTaskKind, BackgroundTaskTracker } from '@/modules/background-tasks/index.js';

import { GROK_SUBAGENT_TOOL } from './grok-subagents.js';

/**
 * Background commands and monitors of one Grok CLI process, folded into the
 * same list Claude's «Фон: N» shows. Grok has no level event in the
 * `streaming-messages-json` stream (only init/compact_boundary system lines),
 * so the list is read off the texts the model itself gets — taken from real
 * sessions in ~/.grok/sessions (Grok 1.0.x):
 *
 * start — the tool result of `run_terminal_command` (`background: true`, or
 *   moved to the background by Grok after its 15 s limit):
 *     <task-id>ID</task-id> <task-type>bash</task-type> … <status>running</status>
 *   and of `monitor`: «Monitor started (task ID, timeout …ms).»
 * end — read ONLY from Grok's own notices: synthetic user turns
 *   (`synthetic_reason`, or a `<system-reminder>` text) and results of
 *   get_command_or_subagent_output / wait / monitor / kill. A command that
 *   merely prints such a phrase (`cat` of a log) never closes a task. Endings:
 *   «Background task "ID" completed (exit code: N).» / «(terminated by signal …)»
 *     (a synthetic user turn, or appended to a kill/get-output result);
 *   «Monitor "ID" ended: […]»;
 *   a `get_command_or_subagent_output` report «=== Task ID ===\n…Status: failed»
 *     or «--- Task ID [completed] ---» with a status other than running;
 *   `kill_command_or_subagent {task_id}` answered «killed:», «already_exited:»
 *     or «… not found».
 *
 * Helpers (`spawn_subagent`) are crabs, never background tasks. Nothing here
 * can stop a task: only Grok itself can, with its own tool.
 *
 * Both the live envelope (assistant `tool_use` / user `tool_result` blocks)
 * and `chat_history.jsonl` lines (`tool_calls` / `tool_result` rows) are read.
 *
 * Live stream of Grok 1.0.70 (captured 04.11 in an isolated HOME): the start
 * result is JSON — {"type":"BackgroundTaskStarted","task_id","task_type",
 * "status":"running","command","pid"} — and NO completion notice reaches the
 * stream (Grok tells the model internally). So a live task also ends when its
 * `pid` is gone (`pruneExited`, run by the runtime), and JSON reports of
 * Grok's own tools with a final `status` close it as well.
 */

type ToolCall = { name: string; input: Record<string, unknown> };

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

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readInput(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return record(JSON.parse(value)) ?? {};
    } catch {
      return {};
    }
  }
  return record(value) ?? {};
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
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

function clip(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > DESCRIPTION_MAX ? `${line.slice(0, DESCRIPTION_MAX - 1)}…` : line;
}

type Event =
  | { kind: 'call'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'result'; id: string; text: string }
  | { kind: 'text'; text: string; synthetic: boolean };

/** One stream or history line → the calls, results and texts it carries. */
function eventsOf(line: unknown): Event[] {
  const raw = record(line);
  if (!raw) return [];
  // A helper's own lines (live) belong to the crab, not to the main chat.
  if (typeof raw.parent_tool_use_id === 'string' && raw.parent_tool_use_id.trim()) return [];
  const events: Event[] = [];

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
    const synthetic = (text: string) => marked || text.includes('<system-reminder>');
    if (typeof content === 'string') return [{ kind: 'text', text: content, synthetic: synthetic(content) }];
    if (!Array.isArray(content)) return [];
    for (const part of content) {
      const block = record(part);
      if (!block) continue;
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        events.push({ kind: 'result', id: block.tool_use_id, text: textOf(block.content) });
      } else if (typeof block.text === 'string') {
        events.push({ kind: 'text', text: block.text, synthetic: synthetic(block.text) });
      }
    }
  }
  return events;
}

function kindOf(taskType: string | undefined): BackgroundTaskKind {
  if (taskType === 'bash') return 'bash';
  if (taskType === 'monitor') return 'monitor';
  return 'other';
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether `text` says the task `id` is over (any of the endings above). */
function saysEnded(text: string, id: string): boolean {
  const quoted = escapeRegExp(id);
  if (new RegExp(`Background task "${quoted}" (?:completed|failed|was|ended|exited|terminated)`, 'i').test(text)) return true;
  if (new RegExp(`Monitor "${quoted}" ended`, 'i').test(text)) return true;
  const bracket = new RegExp(`--- Task ${quoted} \\[([a-z_]+)\\] ---`, 'i').exec(text);
  if (bracket && bracket[1].toLowerCase() !== 'running') return true;
  const header = new RegExp(`=== Task ${quoted} ===\\n(?:[^\\n]*\\n)*?Status: ([a-z_]+)`, 'i').exec(text);
  if (header && header[1].toLowerCase() !== 'running') return true;
  return false;
}

/** The tool result as JSON (live Grok answers in JSON), or null. */
function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** Every `{task_id, status}` pair in a JSON report, at any depth. */
function jsonStatuses(value: unknown, found: Array<{ taskId: string; status: string }> = [], depth = 0): Array<{ taskId: string; status: string }> {
  if (depth > 4 || !value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    for (const item of value) jsonStatuses(item, found, depth + 1);
    return found;
  }
  const item = value as Record<string, unknown>;
  if (typeof item.task_id === 'string' && typeof item.status === 'string') found.push({ taskId: item.task_id, status: item.status });
  for (const child of Object.values(item)) {
    if (child && typeof child === 'object') jsonStatuses(child, found, depth + 1);
  }
  return found;
}

type Started = { taskId: string; taskType?: string; pid?: number; command?: string };

/** A started background task in a tool result, or null. */
function startedTask(call: ToolCall | undefined, text: string): Started | null {
  if (call?.name === GROK_SUBAGENT_TOOL) return null;
  const json = record(parseJson(text));
  if (json?.type === 'BackgroundTaskStarted' && typeof json.task_id === 'string' && json.task_id) {
    const taskType = typeof json.task_type === 'string' ? json.task_type : undefined;
    if (typeof json.status === 'string' && json.status.toLowerCase() !== 'running') return null;
    if (taskType && taskType !== 'bash' && taskType !== 'monitor') return null;
    if (call && !TERMINAL_TOOLS.has(call.name) && call.name !== MONITOR_TOOL) return null;
    return {
      taskId: json.task_id,
      taskType: taskType ?? (call?.name === MONITOR_TOOL ? 'monitor' : 'bash'),
      ...(Number.isInteger(json.pid) && (json.pid as number) > 0 ? { pid: json.pid as number } : {}),
      ...(typeof json.command === 'string' && json.command.trim() ? { command: json.command } : {}),
    };
  }
  if (call?.name === MONITOR_TOOL) {
    const monitor = /Monitor started \(task ([^\s,)]+)/i.exec(text);
    if (monitor) return { taskId: monitor[1], taskType: 'monitor' };
  }
  const id = /<task-id>([^<\s]+)<\/task-id>/.exec(text)?.[1];
  const status = /<status>([^<\s]+)<\/status>/.exec(text)?.[1];
  if (!id || (status && status.toLowerCase() !== 'running')) return null;
  const taskType = /<task-type>([^<\s]+)<\/task-type>/.exec(text)?.[1];
  // Only commands and monitors are background work of the console; anything
  // else Grok may report this way (a helper) stays out.
  if (taskType && taskType !== 'bash' && taskType !== 'monitor') return null;
  if (call && !TERMINAL_TOOLS.has(call.name) && call.name !== MONITOR_TOOL) return null;
  return { taskId: id, taskType: taskType ?? (call?.name === MONITOR_TOOL ? 'monitor' : 'bash') };
}

function descriptionOf(call: ToolCall | undefined, text: string): string {
  const input = call?.input ?? {};
  for (const key of ['description', 'command']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return clip(value);
  }
  const summary = /<summary>([\s\S]*?)<\/summary>/.exec(text)?.[1];
  return summary ? clip(summary) : '';
}

export type GrokBackgroundTaskTracker = BackgroundTaskTracker & {
  /** The command a running task was started with, for finding its process («Стоп»). */
  commandOf(taskId: string): string | null;
  /** The pid Grok reported for the task (live stream), or null. */
  pidOf(taskId: string): number | null;
  /** Drops tasks whose reported pid is gone; the new list when it changed, else null. */
  pruneExited(isAlive: (pid: number) => boolean): BackgroundTask[] | null;
};

export function createGrokBackgroundTaskTracker(options: { now?: () => number } = {}): GrokBackgroundTaskTracker {
  const now = options.now ?? Date.now;
  const calls = new Map<string, ToolCall>();
  const started = new Map<string, { pid?: number; command?: string }>();
  let tasks: BackgroundTask[] = [];
  const drop = (keep: (task: BackgroundTask) => boolean): boolean => {
    const before = tasks.length;
    tasks = tasks.filter((task) => {
      if (keep(task)) return true;
      started.delete(task.taskId);
      return false;
    });
    return tasks.length !== before;
  };

  const list = (): BackgroundTask[] => tasks.map((task) => ({ ...task }));

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
            changed = drop((task) => task.taskId !== target) || changed;
          }
        }

        const fromGrok = event.kind === 'text' ? event.synthetic : Boolean(call && REPORT_TOOLS.has(call.name));
        if (fromGrok && tasks.length > 0) {
          const finals = new Set(jsonStatuses(parseJson(text))
            .filter((entry) => entry.status.toLowerCase() !== 'running').map((entry) => entry.taskId));
          changed = drop((task) => !saysEnded(text, task.taskId) && !finals.has(task.taskId)) || changed;
        }

        if (event.kind === 'result') {
          const start = startedTask(call, text);
          if (start && !tasks.some((task) => task.taskId === start.taskId)) {
            tasks = [...tasks, {
              taskId: start.taskId,
              kind: kindOf(start.taskType),
              description: descriptionOf(call, text),
              startedAt: now(),
              toolUseId: event.id,
            }];
            started.set(start.taskId, { pid: start.pid, command: start.command });
            changed = true;
          }
        }
      }
      return changed ? list() : null;
    },
    list,
    has: (taskId) => tasks.some((task) => task.taskId === taskId),
    commandOf: (taskId) => {
      const task = tasks.find((item) => item.taskId === taskId);
      if (!task) return null;
      const command = started.get(taskId)?.command
        ?? (task.toolUseId ? calls.get(task.toolUseId)?.input.command : undefined);
      return typeof command === 'string' && command.trim() ? command : null;
    },
    pidOf: (taskId) => (tasks.some((task) => task.taskId === taskId) ? started.get(taskId)?.pid ?? null : null),
    pruneExited(isAlive) {
      const changed = drop((task) => {
        const pid = started.get(task.taskId)?.pid;
        if (!pid) return true;
        try {
          return isAlive(pid);
        } catch {
          return true;
        }
      });
      return changed ? list() : null;
    },
  };
}
