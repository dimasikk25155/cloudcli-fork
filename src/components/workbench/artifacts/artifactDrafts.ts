import type { ArtifactAnchor } from '../../../../shared/artifacts';

/**
 * Unfinished artifact comments, by artifact id. Kept in memory only: the
 * canvas unmounts a tab's view when another tab becomes active, and the
 * region plus half-written text must be there on return. Save or cancel
 * clears the entry.
 */
export type ArtifactCommentDraft = { anchor: ArtifactAnchor; text: string };

const drafts = new Map<string, ArtifactCommentDraft>();

export function getCommentDraft(artifactId: string): ArtifactCommentDraft | null {
  const draft = drafts.get(artifactId);
  return draft ? { anchor: { ...draft.anchor }, text: draft.text } : null;
}

export function setCommentDraft(artifactId: string, draft: ArtifactCommentDraft | null): void {
  if (draft) drafts.set(artifactId, { anchor: { ...draft.anchor }, text: draft.text });
  else drafts.delete(artifactId);
}
