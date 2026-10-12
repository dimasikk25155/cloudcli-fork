import { useSyncExternalStore } from 'react';

/**
 * «Фон: N» — background tasks of each Claude session, as the server's
 * `background_tasks` frames report them (full list, replace semantics), plus
 * the state of a «Стоп» pressed on one of them.
 */

export type BackgroundTaskKind = 'bash' | 'agent' | 'monitor' | 'workflow' | 'other';

export type BackgroundTaskView = {
  taskId: string;
  kind: BackgroundTaskKind;
  description: string;
  /** Epoch ms (server clock). */
  startedAt: number;
  lastTool?: string;
};

/**
 * `gone` = the task ended mid-turn; `turn_ended` = the turn is over and the
 * task is no longer controllable from Neo3; `failed` = the stop itself failed.
 */
export type BackgroundTaskStopState = 'stopping' | 'gone' | 'turn_ended' | 'failed';

const STOP_STATE_LABEL: Record<BackgroundTaskStopState, string> = {
  stopping: 'Останавливаю…',
  gone: 'Задача уже не идёт',
  turn_ended: 'Ход уже закончился — задача больше не управляется отсюда',
  failed: 'Не остановилась',
};

export function stopStateLabel(state: BackgroundTaskStopState): string {
  return STOP_STATE_LABEL[state];
}

export type SessionBackgroundTasks = {
  tasks: BackgroundTaskView[];
  stops: Readonly<Record<string, BackgroundTaskStopState>>;
};

const EMPTY: SessionBackgroundTasks = { tasks: [], stops: {} };
const sessions = new Map<string, SessionBackgroundTasks>();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

function update(sessionId: string, next: SessionBackgroundTasks): void {
  if (next.tasks.length === 0 && Object.keys(next.stops).length === 0) {
    if (!sessions.delete(sessionId)) return;
  } else {
    sessions.set(sessionId, next);
  }
  emit();
}

function readTasks(raw: unknown): BackgroundTaskView[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const task = item as Record<string, unknown>;
    if (typeof task.taskId !== 'string' || !task.taskId) return [];
    return [{
      taskId: task.taskId,
      kind: (typeof task.kind === 'string' ? task.kind : 'other') as BackgroundTaskKind,
      description: typeof task.description === 'string' ? task.description : '',
      startedAt: typeof task.startedAt === 'number' ? task.startedAt : Date.now(),
      ...(typeof task.lastTool === 'string' ? { lastTool: task.lastTool } : {}),
    }];
  });
}

export const backgroundTasksStore = {
  /** `background_tasks` frame: the full list replaces the old one. */
  setTasks(sessionId: string, rawTasks: unknown): void {
    const tasks = readTasks(rawTasks);
    const previous = sessions.get(sessionId) ?? EMPTY;
    const live = new Set(tasks.map((task) => task.taskId));
    const stops = Object.fromEntries(Object.entries(previous.stops).filter(([taskId]) => live.has(taskId)));
    update(sessionId, { tasks, stops });
  },
  markStopping(sessionId: string, taskId: string): void {
    const previous = sessions.get(sessionId) ?? EMPTY;
    update(sessionId, { ...previous, stops: { ...previous.stops, [taskId]: 'stopping' } });
  },
  /** `background_task_stop` frame. A successful stop waits for the list to drop the task. */
  recordStopResult(sessionId: string, taskId: string, ok: boolean, reason?: string): void {
    if (ok) return;
    const previous = sessions.get(sessionId) ?? EMPTY;
    const state: BackgroundTaskStopState = reason === 'not_running'
      ? 'gone'
      : reason === 'turn_ended' ? 'turn_ended' : 'failed';
    update(sessionId, { ...previous, stops: { ...previous.stops, [taskId]: state } });
  },
  /** The run ended: its process and every background task with it. */
  clear(sessionId: string): void {
    update(sessionId, EMPTY);
  },
  get(sessionId: string | null | undefined): SessionBackgroundTasks {
    return (sessionId && sessions.get(sessionId)) || EMPTY;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useBackgroundTasks(sessionId: string | null | undefined): SessionBackgroundTasks {
  return useSyncExternalStore(
    backgroundTasksStore.subscribe,
    () => backgroundTasksStore.get(sessionId),
    () => EMPTY,
  );
}
