/**
 * «Рабочий стол»: the registry of canvas tab kinds.
 *
 * The workbench itself only knows how to open, switch and close tabs; what a
 * tab shows is registered here by the feature that owns it — the session
 * inspector and «Контекст и лимиты» (this folder), artifacts, side chats, the
 * second chat, the advisor. Registering the same kind again replaces it.
 */
import type { ReactNode } from 'react';

import type { Project, ProjectSession } from '../../types/app';

export type WorkbenchTabKind = 'inspector' | 'limits' | 'artifacts' | 'artifact' | 'btw' | 'chat' | 'advisor' | 'report';

export interface WorkbenchTab {
  id: string;
  kind: WorkbenchTabKind;
  title: string;
  /** artifactId | sessionId | reportId — whatever the kind needs to find its content. */
  ref?: string;
}

export type WorkbenchTabInput = Omit<WorkbenchTab, 'id'> & { id?: string };

/** What a tab body gets besides the tab itself. */
export type WorkbenchRenderContext = {
  /** The chat the canvas belongs to; null for a new chat that has no id yet. */
  sessionId: string | null;
  project: Project;
  session: ProjectSession | null;
  /** Opens (or focuses) another tab of the same canvas. */
  openTab: (tab: WorkbenchTabInput) => void;
  closeTab: () => void;
};

export type WorkbenchTabKindDef = {
  render: (tab: WorkbenchTab, context: WorkbenchRenderContext) => ReactNode;
  icon: ReactNode;
  defaultTitle: string;
  /** Shown in the canvas «+» menu (kinds that need a ref, e.g. one artifact, are not). */
  inMenu?: boolean;
};

const kinds = new Map<WorkbenchTabKind, WorkbenchTabKindDef>();
const listeners = new Set<() => void>();
let version = 0;

export function registerWorkbenchTabKind(kind: WorkbenchTabKind, def: WorkbenchTabKindDef): void {
  kinds.set(kind, def);
  version += 1;
  listeners.forEach((listener) => listener());
}

export function getWorkbenchTabKind(kind: WorkbenchTabKind): WorkbenchTabKindDef | undefined {
  return kinds.get(kind);
}

/** Registered kinds in registration order. */
export function listWorkbenchTabKinds(): Array<[WorkbenchTabKind, WorkbenchTabKindDef]> {
  return [...kinds.entries()];
}

/** For `useSyncExternalStore`: a kind registered after the canvas rendered still appears. */
export function subscribeWorkbenchTabKinds(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function workbenchTabKindsVersion(): number {
  return version;
}

/** Same kind + same ref = the same tab: opening it again focuses it. */
export function workbenchTabId(tab: WorkbenchTabInput): string {
  if (tab.id) return tab.id;
  return tab.ref ? `${tab.kind}:${tab.ref}` : tab.kind;
}
