/**
 * Pure rules of the artifact tabs: comment regions, the pending tab of a file
 * link, where «Отправить агенту» goes, labels. Rendered by `ArtifactView`.
 */
import type { ArtifactCommentStatus, ArtifactKind, ArtifactVersionSource } from '../../../../shared/artifacts';

export type FractionRect = { x: number; y: number; w: number; h: number };

/** Smallest region side, as a fraction of the frame: a click is not a region. */
const MIN_SIDE = 0.01;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** Drag inside a frame (pixels from its top-left corner) → region in fractions 0..1. */
export function rectFromDrag(
  start: { x: number; y: number },
  end: { x: number; y: number },
  box: { width: number; height: number },
): FractionRect | null {
  if (!(box.width > 0) || !(box.height > 0)) return null;
  const x1 = clamp01(Math.min(start.x, end.x) / box.width);
  const x2 = clamp01(Math.max(start.x, end.x) / box.width);
  const y1 = clamp01(Math.min(start.y, end.y) / box.height);
  const y2 = clamp01(Math.max(start.y, end.y) / box.height);
  if (x2 - x1 < MIN_SIDE || y2 - y1 < MIN_SIDE) return null;
  return { x: round(x1), y: round(y1), w: round(x2 - x1), h: round(y2 - y1) };
}

const PATH_REF = 'path:';

/** A file link opens the artifact tab by path; the tab publishes the file when shown. */
export function artifactTabForPath(filePath: string): { kind: 'artifact'; ref: string; title: string } {
  const clean = filePath.trim().replace(/:\d+(?::\d+)?$/, '');
  const name = clean.split(/[\\/]/).filter(Boolean).pop() ?? clean;
  return { kind: 'artifact', ref: `${PATH_REF}${clean}`, title: name };
}

/** Path of a not yet published artifact tab, or null for a tab with an artifact id. */
export function pendingArtifactPath(ref: string | undefined): string | null {
  return ref && ref.startsWith(PATH_REF) ? ref.slice(PATH_REF.length) : null;
}

export type SendTarget =
  | { kind: 'here'; sessionId: string }
  | { kind: 'elsewhere'; sessionId: string }
  | { kind: 'none' };

/**
 * Comments go to the chat the artifact came from. The message is sent by that
 * chat's own composer, so it must be the chat open beside the canvas; an
 * artifact without a source chat goes to the open chat.
 */
export function sendTarget({ artifactSessionId, currentSessionId }: { artifactSessionId: string | null; currentSessionId: string | null }): SendTarget {
  const target = artifactSessionId ?? currentSessionId;
  if (!target) return { kind: 'none' };
  return target === currentSessionId ? { kind: 'here', sessionId: target } : { kind: 'elsewhere', sessionId: target };
}

export function commentStatusLabel(status: ArtifactCommentStatus): string {
  return status === 'open' ? 'Открыт' : status === 'sent' ? 'Отправлен агенту' : 'Учтён';
}

export function versionSourceLabel(version: { source: ArtifactVersionSource; restoredFrom?: number }): string {
  if (version.source === 'publish') return 'публикация';
  if (version.source === 'change') return 'изменение файла';
  if (version.source === 'edit') return 'Правка вручную';
  return version.restoredFrom ? `восстановлена версия ${version.restoredFrom}` : 'восстановление';
}

/** Regions are drawn on HTML, slides, images and PDF; quotes are taken from text. */
export function commentsWithRect(kind: ArtifactKind): boolean {
  return kind === 'html' || kind === 'slides' || kind === 'image' || kind === 'pdf';
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`;
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`;
}

/**
 * `artifacts_changed` frame for this project (and this artifact, when given).
 * A reconnect counts too: a frame may have been missed while offline.
 */
export function isArtifactsChangeFor(
  event: { kind?: string; projectId?: unknown; artifactId?: unknown },
  projectId: string,
  artifactId?: string,
): boolean {
  if (event.kind === 'websocket_reconnected') return true;
  if (event.kind !== 'artifacts_changed' || event.projectId !== projectId) return false;
  return artifactId === undefined || event.artifactId === artifactId;
}
