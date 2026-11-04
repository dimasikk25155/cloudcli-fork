/**
 * Несохранённая правка артефакта — в памяти, по id артефакта. Холст
 * размонтирует неактивную вкладку: при возврате редактор берёт отсюда тот же
 * разобранный документ, историю, выделение, масштаб и привязку. Живёт до
 * сохранения или «Выйти без сохранения»; перезагрузка страницы её не переживает.
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
