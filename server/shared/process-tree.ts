import { execFile } from 'node:child_process';

/**
 * The process tree of an engine, read from `ps` — the only handle Neo3 has on
 * a background command of Codex or Grok: neither engine can stop one of its
 * commands from outside, so «Стоп» finds the command among the descendants
 * of the engine process and stops that command's own tree. Never the engine
 * itself, never anything outside its tree. Unknown (Windows, no `ps`) = not found.
 */

export type ProcessEntry = { pid: number; ppid: number; command: string };

export type ProcessTreeDeps = {
  listProcesses?: () => Promise<ProcessEntry[]>;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  isAlive?: (pid: number) => boolean;
  sleep?: (ms: number) => Promise<void>;
};

const PS_MAX_BUFFER = 8 * 1024 * 1024;
const TERM_GRACE_MS = 2_000;
const KILL_GRACE_MS = 1_000;
const POLL_MS = 100;

/** Every process: pid, parent and full command line (`ps -axww`). */
export function listProcesses(): Promise<ProcessEntry[]> {
  if (process.platform === 'win32') return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    execFile('ps', ['-axww', '-o', 'pid=,ppid=,command='], { maxBuffer: PS_MAX_BUFFER }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      const entries: ProcessEntry[] = [];
      for (const line of String(stdout).split('\n')) {
        const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        if (match) entries.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] });
      }
      resolve(entries);
    });
  });
}

/** Descendants of `rootPid` (not the root), nearest generation first. */
function descendantsOf(rootPid: number, entries: ProcessEntry[]): ProcessEntry[] {
  const children = new Map<number, ProcessEntry[]>();
  for (const entry of entries) {
    if (entry.pid === entry.ppid) continue;
    const list = children.get(entry.ppid) ?? [];
    list.push(entry);
    children.set(entry.ppid, list);
  }
  const result: ProcessEntry[] = [];
  const seen = new Set<number>([rootPid]);
  let generation = [rootPid];
  while (generation.length > 0) {
    const next: number[] = [];
    for (const pid of generation) {
      for (const child of children.get(pid) ?? []) {
        if (seen.has(child.pid)) continue;
        seen.add(child.pid);
        result.push(child);
        next.push(child.pid);
      }
    }
    generation = next;
  }
  return result;
}

async function readTable(deps: ProcessTreeDeps): Promise<ProcessEntry[] | null> {
  try {
    return await (deps.listProcesses ?? listProcesses)();
  } catch {
    return null;
  }
}

/**
 * The topmost descendant of `rootPid` whose command line satisfies `match`
 * (the shell that runs a command, not its grandchildren), or null.
 */
export async function findDescendantProcess(
  rootPid: number,
  match: (command: string, pid: number) => boolean,
  deps: ProcessTreeDeps = {},
): Promise<{ pid: number; command: string } | null> {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return null;
  const table = await readTable(deps);
  if (!table) return null;
  const found = descendantsOf(rootPid, table).find((entry) => {
    try {
      return match(entry.command, entry.pid);
    } catch {
      return false;
    }
  });
  return found ? { pid: found.pid, command: found.command } : null;
}

/** Every descendant of `rootPid` whose command line satisfies `match`. */
export async function findDescendantProcesses(
  rootPid: number,
  match: (command: string, pid: number) => boolean,
  deps: ProcessTreeDeps = {},
): Promise<Array<{ pid: number; command: string }>> {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return [];
  const table = await readTable(deps);
  if (!table) return [];
  return descendantsOf(rootPid, table)
    .filter((entry) => {
      try {
        return match(entry.command, entry.pid);
      } catch {
        return false;
      }
    })
    .map((entry) => ({ pid: entry.pid, command: entry.command }));
}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

function defaultKill(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    /* already gone */
  }
}

async function waitGone(pid: number, ms: number, isAlive: (pid: number) => boolean, sleep: (ms: number) => Promise<void>): Promise<boolean> {
  for (let waited = 0; waited < ms; waited += POLL_MS) {
    if (!isAlive(pid)) return true;
    await sleep(POLL_MS);
  }
  return !isAlive(pid);
}

/**
 * Stops `pid` and everything under it: SIGTERM, children before the parent,
 * then SIGKILL to whatever is left. True when `pid` is gone.
 */
export async function killProcessTree(pid: number, deps: ProcessTreeDeps = {}): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  const kill = deps.kill ?? defaultKill;
  const isAlive = deps.isAlive ?? defaultIsAlive;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));

  const signalTree = async (signal: NodeJS.Signals) => {
    const table = (await readTable(deps)) ?? [];
    const tree = [...descendantsOf(pid, table).map((entry) => entry.pid).reverse(), pid];
    for (const target of tree) {
      if (isAlive(target)) kill(target, signal);
    }
  };

  await signalTree('SIGTERM');
  if (await waitGone(pid, TERM_GRACE_MS, isAlive, sleep)) return true;
  await signalTree('SIGKILL');
  return waitGone(pid, KILL_GRACE_MS, isAlive, sleep);
}

const MATCH_PREFIX_MAX = 120;
const fold = (text: string) => text.replace(/\\012/g, '\n').replace(/\s+/g, ' ').trim();

/**
 * Does a `ps` command line run this script? ps drops the shell's quotes,
 * prints newlines as `\012` and may cut very long lines, so the first line
 * of the script (spaces folded, at most 120 chars) has to be in it.
 */
export function commandMatcher(script: string): (command: string) => boolean {
  const firstLine = fold(String(script ?? '').split('\n')[0] ?? '').slice(0, MATCH_PREFIX_MAX);
  if (!firstLine) return () => false;
  return (command) => fold(command).includes(firstLine);
}

/**
 * How a task's process is recognised: by the pid the engine reported (Grok's
 * live stream gives it), else by its command line. Either way only inside the
 * engine's own tree.
 */
export function taskProcessMatcher(task: { command?: string | null; pid?: number | null }): (command: string, pid: number) => boolean {
  if (task.pid && Number.isInteger(task.pid) && task.pid > 0) return (_command, pid) => pid === task.pid;
  const byCommand = commandMatcher(task.command ?? '');
  return (command) => byCommand(command);
}

export type EngineTaskStop = { ok: boolean; reason?: 'turn_ended' | 'not_running' | 'failed' | 'unsupported' };

/**
 * «Стоп» of one Codex/Grok background command, the same answers as Claude's
 * stopTask: the turn is over → `turn_ended`; the task is not in the list or
 * its process is gone → `not_running`; no engine process or command to look
 * for → `unsupported`; the process outlived SIGKILL → `failed`.
 */
export async function stopEngineTask(
  input: { running: boolean; hasTask: boolean; rootPid: number | null; command: string | null; pid?: number | null },
  deps: ProcessTreeDeps = {},
): Promise<EngineTaskStop> {
  if (!input.running) return { ok: false, reason: 'turn_ended' };
  if (!input.hasTask) return { ok: false, reason: 'not_running' };
  if (!input.rootPid || (!input.command && !input.pid)) return { ok: false, reason: 'unsupported' };
  const found = await findDescendantProcess(input.rootPid, taskProcessMatcher(input), deps);
  if (!found) return { ok: false, reason: 'not_running' };
  return (await killProcessTree(found.pid, deps)) ? { ok: true } : { ok: false, reason: 'failed' };
}

/**
 * Per-row «Стоп»: a task gets `stoppable: true` only when its process was
 * found in the engine's tree; otherwise the row keeps «остановить может
 * только сам <движок>». A failed lookup is «not found».
 */
export async function markStoppableTasks<T extends object>(
  tasks: T[],
  found: (task: T) => Promise<boolean>,
): Promise<Array<T & { stoppable: boolean }>> {
  return Promise.all(tasks.map(async (task) => {
    let stoppable = false;
    try {
      stoppable = (await found(task)) === true;
    } catch {
      stoppable = false;
    }
    return { ...task, stoppable };
  }));
}
