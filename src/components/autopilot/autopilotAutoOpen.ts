/**
 * Дашборд автопилота сам встаёт во вкладку справа, когда в проекте идёт
 * сборка, — чтобы агенту не приходилось открывать его в браузере.
 * Один раз на сборку: закрыл вкладку — она больше не лезет.
 */

export type AutopilotAutoOpenInput = {
  available: boolean;
  finished: boolean;
  /** Ключ прогона; null — заголовка ещё нет (state.js не дописан). */
  runKey: string | null;
  alreadyOpened: boolean;
};

const STORAGE_KEY = 'neo3.autopilot.autoOpened';
const MAX_REMEMBERED = 50;

export type AutoOpenStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

/** Прогон = проект + заголовок сборки. */
export function autopilotRunKey(projectId: string | undefined, title: string | null): string | null {
  if (!projectId || !title) return null;
  return `${projectId}::${title}`;
}

export function shouldAutoOpenAutopilot(input: AutopilotAutoOpenInput): boolean {
  return input.available && !input.finished && input.runKey !== null && !input.alreadyOpened;
}

function readOpened(storage: AutoOpenStorage | null): string[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function wasAutoOpened(runKey: string, storage: AutoOpenStorage | null = browserStorage()): boolean {
  return readOpened(storage).includes(runKey);
}

export function markAutoOpened(runKey: string, storage: AutoOpenStorage | null = browserStorage()): void {
  if (!storage) return;
  const next = [...readOpened(storage).filter((key) => key !== runKey), runKey].slice(-MAX_REMEMBERED);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Хранилище недоступно — в худшем случае вкладка откроется ещё раз.
  }
}

function browserStorage(): AutoOpenStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
