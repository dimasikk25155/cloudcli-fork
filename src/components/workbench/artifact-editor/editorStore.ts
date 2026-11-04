/**
 * Несохранённая правка артефакта — в памяти, по id артефакта. Холст
 * размонтирует неактивную вкладку: при возврате редактор берёт отсюда тот же
 * разобранный документ, историю, выделение, масштаб и привязку. Живёт до
 * сохранения или «Выйти без сохранения»; перезагрузка страницы её не переживает —
 * поэтому перезагрузка и закрытие вкладки артефакта с несохранёнными правками
 * спрашивают подтверждение, даже когда редактора нет на экране.
 */

import type { EditorDocKind, EditorOp } from './editorModel';
import type { EditorHistory } from './editorUiModel';

/** The live part: not serializable, memory only. */
export interface EditorSession {
  kind: EditorDocKind;
  /** The parsed source with `data-neo3-id` and the edits applied (what «Сохранить» writes). */
  doc: Document;
  history: EditorHistory;
}

export interface EditorState {
  /** Version the file on disk had when the edit started or was last saved (409 check). */
  baseVersionN: number;
  /** Applied operations, oldest first. */
  ops: EditorOp[];
  /** Undone operations (the next to redo last). */
  redo: EditorOp[];
  selection: string[];
  zoom: number;
  snap: boolean;
  session?: EditorSession;
  /** Path of the artifact in the project and on disk: a canvas tab opened from a file link knows only one of them. */
  path?: string;
  absPath?: string;
}

const states = new Map<string, EditorState>();
const listeners = new Set<(artifactId: string) => void>();

const notify = (artifactId: string) => {
  for (const listener of listeners) listener(artifactId);
};

export function getEditorState(artifactId: string): EditorState | null {
  return states.get(artifactId) ?? null;
}

export function setEditorState(artifactId: string, state: EditorState): void {
  states.set(artifactId, state);
  if (typeof window !== 'undefined') installUnsavedEditsGuard(window);
  notify(artifactId);
}

export function clearEditorState(artifactId: string): void {
  if (!states.delete(artifactId)) return;
  notify(artifactId);
}

/** Called with the artifact id on every set/clear. */
export function subscribeEditorState(listener: (artifactId: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const isUnsaved = (state: EditorState | undefined): boolean => state?.session?.history.dirty === true;

/** Some artifact has edits not written to the file yet. */
export function anyUnsavedEdits(): boolean {
  for (const state of states.values()) if (isUnsaved(state)) return true;
  return false;
}

const guarded = new WeakSet<object>();

/** Page reload / closing the browser tab asks while `anyUnsavedEdits()` (once per target). */
export function installUnsavedEditsGuard(target: Pick<EventTarget, 'addEventListener'>): void {
  if (guarded.has(target)) return;
  guarded.add(target);
  target.addEventListener('beforeunload', (event) => {
    if (!anyUnsavedEdits()) return;
    event.preventDefault();
    // Older browsers need returnValue set for the prompt.
    (event as unknown as { returnValue: unknown }).returnValue = '';
  });
}

/** The artifact an editor state belongs to: by id, or by its path (a tab opened from a file link). */
function unsavedArtifactId(match: { artifactId?: string | null; path?: string | null }): string | null {
  if (match.artifactId && isUnsaved(states.get(match.artifactId))) return match.artifactId;
  if (!match.path) return null;
  for (const [artifactId, state] of states) {
    if (isUnsaved(state) && (state.path === match.path || state.absPath === match.path)) return artifactId;
  }
  return null;
}

/**
 * Before closing a canvas tab of an artifact: no unsaved edits — true at once;
 * otherwise asks; «да» drops the edits (true), «нет» keeps them (false).
 */
export function confirmDiscardUnsaved(
  match: { artifactId?: string | null; path?: string | null },
  ask: (text: string) => boolean,
): boolean {
  const artifactId = unsavedArtifactId(match);
  if (!artifactId) return true;
  if (!ask('В этом артефакте есть несохранённые правки. Закрыть вкладку и отменить их?')) return false;
  clearEditorState(artifactId);
  return true;
}
