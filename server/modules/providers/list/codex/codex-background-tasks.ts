import type { BackgroundTask, BackgroundTaskTracker } from '@/modules/background-tasks/index.js';

/**
 * «Фон: N» of one Codex run, read from the SDK `--experimental-json` stream.
 *
 * Codex runs every command in a unified-exec session: after its yield time
 * the model gets «process still running» and goes on, the command keeps
 * running. The stream has no «moved to background» event, so the list is
 * read off what does come (checked against real rollouts in
 * ~/.codex/sessions, Codex 0.166):
 * - `item.started` of a `command_execution` (status `in_progress`) — the
 *   command runs; it is not background yet: commands of one model step run
 *   in parallel and finish before the model speaks again;
 * - `item.completed` of a `reasoning` or `agent_message` while the command is
 *   still in progress — the model went on without it: from now on it is a
 *   background task;
 * - the same when a new item starts and the command has run for at least
 *   STEP_GAP_MS: commands of one step start within ~0.1 s of each other
 *   (rollouts), the next step comes after a model round trip — this covers
 *   turns where Codex sends no reasoning items (seen in a live run);
 * - `item.completed` (or a final `item.updated`) of the command — it is over.
 *
 * Helpers (collab agents) are crabs, never background tasks. Codex itself
 * cannot stop a single command; Neo3 can only by its process
 * (`commandOf` → server/shared/process-tree.ts).
 */

export type CodexBackgroundTaskTracker = BackgroundTaskTracker & {
  /** The command a task runs (its shell script), for finding its process. */
  commandOf(taskId: string): string | null;
};

const DESCRIPTION_MAX = 200;
const MODEL_STEP_ITEMS = new Set(['reasoning', 'agent_message']);
const STEP_GAP_MS = 1_000;

type Running = { command: string; startedAt: number };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** `/bin/zsh -lc 'npm run dev'` (string or argv) → `npm run dev`. */
export function codexCommandScript(command: unknown): string {
  if (Array.isArray(command)) {
    const parts = command.filter((part): part is string => typeof part === 'string');
    const flag = parts.findIndex((part) => /^-l?c$/.test(part));
    return (flag >= 0 && parts[flag + 1] ? parts[flag + 1] : parts.join(' ')).trim();
  }
  if (typeof command !== 'string') return '';
  const wrapped = /^\S*\/?(?:ba|z)?sh\s+-l?c\s+([\s\S]+)$/.exec(command.trim());
  if (!wrapped) return command.trim();
  const script = wrapped[1].trim();
  const quoted = /^'([\s\S]*)'$/.exec(script) ?? /^"([\s\S]*)"$/.exec(script);
  return (quoted ? quoted[1] : script).trim();
}

function clip(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > DESCRIPTION_MAX ? `${line.slice(0, DESCRIPTION_MAX - 1)}…` : line;
}

export function createCodexBackgroundTaskTracker(options: { now?: () => number } = {}): CodexBackgroundTaskTracker {
  const now = options.now ?? Date.now;
  const running = new Map<string, Running>();
  const background = new Set<string>();
  let tasks: BackgroundTask[] = [];

  const list = (): BackgroundTask[] => tasks.map((task) => ({ ...task }));

  /** The model went on: running commands (older than `minAgeMs`) are background now. */
  const promote = (minAgeMs: number, except?: string): boolean => {
    const at = now();
    let changed = false;
    for (const [taskId, command] of running) {
      if (taskId === except || background.has(taskId) || at - command.startedAt < minAgeMs) continue;
      background.add(taskId);
      tasks = [...tasks, { taskId, kind: 'bash', description: clip(command.command), startedAt: command.startedAt, toolUseId: taskId }];
      changed = true;
    }
    return changed;
  };

  return {
    apply(event) {
      const raw = record(event);
      const item = record(raw?.item);
      if (!raw || !item || typeof item.id !== 'string' || !item.id) return null;
      const id = item.id;

      if (item.type === 'command_execution') {
        const finished = raw.type === 'item.completed'
          || (typeof item.status === 'string' && item.status !== 'in_progress');
        if (finished) {
          running.delete(id);
          if (!background.delete(id)) return null;
          tasks = tasks.filter((task) => task.taskId !== id);
          return list();
        }
        const isNew = (raw.type === 'item.started' || raw.type === 'item.updated') && !running.has(id);
        const changed = raw.type === 'item.started' && promote(STEP_GAP_MS, id);
        if (isNew) running.set(id, { command: codexCommandScript(item.command), startedAt: now() });
        return changed ? list() : null;
      }

      if (raw.type === 'item.completed' && MODEL_STEP_ITEMS.has(String(item.type))) {
        return promote(0) ? list() : null;
      }
      if (raw.type === 'item.started' && promote(STEP_GAP_MS)) return list();
      return null;
    },
    list,
    has: (taskId) => background.has(taskId),
    commandOf: (taskId) => running.get(taskId)?.command ?? null,
  };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Which `codex exec` process (spawned by the SDK under Neo3) runs this turn:
 * the one in the run's folder (`--cd`) — resumed with its thread id
 * (`resume <id>`), or, for a brand-new thread, the only unclaimed new run in
 * that folder. Ambiguous or nothing — null: no «Стоп» rather than a wrong one.
 */
export function pickCodexExecProcess(
  candidates: Array<{ pid: number; command: string }>,
  run: { workingDirectory: string; threadId: string | null; claimed: ReadonlySet<number> },
): number | null {
  if (!run.workingDirectory) return null;
  const folder = new RegExp(`--cd ${escapeRegExp(run.workingDirectory)}(?=\\s+--|\\s+resume\\s|\\s*$)`);
  const resumed = /\sresume\s+(\S+)/;
  const mine = candidates.filter(({ pid, command }) => !run.claimed.has(pid) && folder.test(command)
    && (run.threadId ? resumed.exec(command)?.[1] === run.threadId : !resumed.test(command)));
  return mine.length === 1 ? mine[0].pid : null;
}
