/**
 * «Рабочий стол» state without React.
 *
 * Layout `{enabled, ratio}` is one per account: this browser keeps it in
 * localStorage for the first paint and sends it to the account preference
 * `workbenchLayout` (a JSON string — the preferences store only flat values),
 * so another device opens the same way. Tabs belong to a chat: localStorage
 * `neo3.workbench.tabs.<sessionId>` (a new chat without an id uses `draft`).
 * `ratio` is the canvas share of the width, clamped so neither side vanishes.
 */
import { workbenchTabId, type WorkbenchTab, type WorkbenchTabInput, type WorkbenchTabKind } from './workbenchTabs';

export type WorkbenchLayout = { enabled: boolean; ratio: number };
export type WorkbenchSessionState = { tabs: WorkbenchTab[]; activeTabId: string | null };

export type WorkbenchStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export type WorkbenchStoreDeps = {
  storage: WorkbenchStorage | null;
  /** Sends the layout to the account (`workbenchLayout`); best effort. */
  saveLayout?: (json: string) => void;
};

export const WORKBENCH_LAYOUT_KEY = 'neo3.workbench.layout';
export const WORKBENCH_TABS_PREFIX = 'neo3.workbench.tabs.';
export const WORKBENCH_DRAFT_SESSION = 'draft';
export const MIN_CANVAS_RATIO = 0.25;
export const MAX_CANVAS_RATIO = 0.75;
export const DEFAULT_LAYOUT: Readonly<WorkbenchLayout> = { enabled: false, ratio: 0.5 };

const TAB_KINDS: ReadonlySet<string> = new Set<WorkbenchTabKind>([
  'inspector', 'limits', 'artifacts', 'artifact', 'btw', 'chat', 'advisor', 'report',
]);
const EMPTY_SESSION: WorkbenchSessionState = Object.freeze({ tabs: [], activeTabId: null }) as WorkbenchSessionState;

export const clampRatio = (value: number): number =>
  Math.min(MAX_CANVAS_RATIO, Math.max(MIN_CANVAS_RATIO, value));

function parseLayout(raw: unknown): WorkbenchLayout | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<WorkbenchLayout> | null;
    if (!value || typeof value !== 'object') return null;
    const ratio = typeof value.ratio === 'number' && Number.isFinite(value.ratio) ? clampRatio(value.ratio) : DEFAULT_LAYOUT.ratio;
    return { enabled: value.enabled === true, ratio };
  } catch {
    return null;
  }
}

function parseTab(raw: unknown): WorkbenchTab | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== 'string' || typeof value.kind !== 'string' || !TAB_KINDS.has(value.kind)) return null;
  const tab: WorkbenchTab = {
    id: value.id,
    kind: value.kind as WorkbenchTabKind,
    title: typeof value.title === 'string' ? value.title : '',
  };
  if (typeof value.ref === 'string' && value.ref) tab.ref = value.ref;
  return tab;
}

function parseSession(raw: string | null): WorkbenchSessionState {
  if (!raw) return EMPTY_SESSION;
  try {
    const value = JSON.parse(raw) as { tabs?: unknown; activeTabId?: unknown } | null;
    const tabs = Array.isArray(value?.tabs) ? value.tabs.map(parseTab).filter((tab): tab is WorkbenchTab => tab !== null) : [];
    const active = typeof value?.activeTabId === 'string' && tabs.some((tab) => tab.id === value.activeTabId)
      ? value.activeTabId : tabs[0]?.id ?? null;
    return { tabs, activeTabId: active };
  } catch {
    return EMPTY_SESSION;
  }
}

export type WorkbenchStore = ReturnType<typeof createWorkbenchStore>;

export function createWorkbenchStore(deps: WorkbenchStoreDeps) {
  const { storage, saveLayout } = deps;
  const listeners = new Set<() => void>();
  const sessions = new Map<string, WorkbenchSessionState>();

  const read = (key: string): string | null => {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const write = (key: string, value: string) => {
    try {
      storage?.setItem(key, value);
    } catch {
      // Private mode / full storage: the screen still works, it just forgets.
    }
  };

  let layout: WorkbenchLayout = parseLayout(read(WORKBENCH_LAYOUT_KEY)) ?? { ...DEFAULT_LAYOUT };
  // Bumped by every openTab: a phone shows the canvas full-screen when a tab is opened.
  let openSeq = 0;

  const notify = () => listeners.forEach((listener) => listener());
  const sessionKey = (sessionId: string | null | undefined) => sessionId || WORKBENCH_DRAFT_SESSION;

  function setLayout(next: WorkbenchLayout, { persistToAccount = true } = {}) {
    if (next.enabled === layout.enabled && next.ratio === layout.ratio) return;
    layout = next;
    const json = JSON.stringify(layout);
    write(WORKBENCH_LAYOUT_KEY, json);
    if (persistToAccount) saveLayout?.(json);
    notify();
  }

  function getSession(sessionId: string | null | undefined): WorkbenchSessionState {
    const key = sessionKey(sessionId);
    let state = sessions.get(key);
    if (!state) {
      state = parseSession(read(`${WORKBENCH_TABS_PREFIX}${key}`));
      sessions.set(key, state);
    }
    return state;
  }

  function setSession(sessionId: string | null | undefined, next: WorkbenchSessionState) {
    const key = sessionKey(sessionId);
    sessions.set(key, next);
    write(`${WORKBENCH_TABS_PREFIX}${key}`, JSON.stringify(next));
    notify();
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getLayout: (): WorkbenchLayout => layout,
    getOpenSeq: (): number => openSeq,
    getSession,
    setEnabled(enabled: boolean) {
      setLayout({ ...layout, enabled });
    },
    setRatio(ratio: number) {
      if (!Number.isFinite(ratio)) return;
      setLayout({ ...layout, ratio: Math.round(clampRatio(ratio) * 1000) / 1000 });
    },
    /** The account value (another device, first load). Never echoed back to the account. */
    applyAccountLayout(raw: unknown) {
      const parsed = parseLayout(raw);
      if (parsed) setLayout(parsed, { persistToAccount: false });
    },
    openTab(sessionId: string | null | undefined, input: WorkbenchTabInput) {
      const id = workbenchTabId(input);
      openSeq += 1;
      const current = getSession(sessionId);
      const exists = current.tabs.some((tab) => tab.id === id);
      const tab: WorkbenchTab = { id, kind: input.kind, title: input.title };
      if (input.ref) tab.ref = input.ref;
      setSession(sessionId, {
        tabs: exists ? current.tabs : [...current.tabs, tab],
        activeTabId: id,
      });
      if (!layout.enabled) setLayout({ ...layout, enabled: true });
    },
    closeTab(sessionId: string | null | undefined, tabId: string) {
      const current = getSession(sessionId);
      const index = current.tabs.findIndex((tab) => tab.id === tabId);
      if (index < 0) return;
      const tabs = current.tabs.filter((tab) => tab.id !== tabId);
      const activeTabId = current.activeTabId === tabId
        ? (tabs[index] ?? tabs[index - 1])?.id ?? null
        : current.activeTabId;
      setSession(sessionId, { tabs, activeTabId });
    },
    setActive(sessionId: string | null | undefined, tabId: string) {
      const current = getSession(sessionId);
      if (current.activeTabId === tabId || !current.tabs.some((tab) => tab.id === tabId)) return;
      setSession(sessionId, { ...current, activeTabId: tabId });
    },
  };
}
