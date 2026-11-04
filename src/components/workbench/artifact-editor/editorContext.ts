/**
 * Что режим «Правка» даёт своим слотам (`toolbarExtras`, `leftRail`) и
 * дополнениям — «Попросить агента», рейке кадров, масштабу: документ,
 * выделение, кадры, масштаб и действия. Вне редактора — null.
 */

import { createContext, useContext } from 'react';

import type { ArtifactDetail } from '../../../../shared/artifacts';

import type { EditorDocKind, EditorOp } from './editorModel';

export interface ArtifactEditorApi {
  projectId: string;
  artifact: ArtifactDetail;
  sessionId: string | null;
  kind: EditorDocKind;
  /** The parsed source with `data-neo3-id` (read only: change it through `apply`). */
  doc: Document;
  /** Grows on every change of the document: a dependency for memos over `doc`. */
  revision: number;
  selection: string[];
  /** Frame ids (slides) in document order; [] — not a deck. */
  frames: string[];
  zoom: number;
  setZoom(zoom: number): void;
  /** Applies operations as one undoable action. */
  apply(ops: EditorOp[]): void;
  select(ids: string[]): void;
  scrollTo(id: string): void;
  /** PNG data URL of the element drawn by the bridge; null — no snapshot. */
  snapshot(id: string): Promise<string | null>;
}

export const ArtifactEditorContext = createContext<ArtifactEditorApi | null>(null);

export function useArtifactEditor(): ArtifactEditorApi | null {
  return useContext(ArtifactEditorContext);
}
