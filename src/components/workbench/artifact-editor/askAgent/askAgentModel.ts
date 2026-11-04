/**
 * «Попросить агента» — чистые правила: текст сообщения в исходный чат
 * (путь, селектор, фрагмент ≤2000 символов, просьба, снимок или пометка
 * «без снимка»), обрезка участка картинки, опрос новой версии от агента и
 * отложенная просьба для другого чата. Сообщение уходит обычным текстом через
 * композер чата — поэтому одинаково для Claude, Codex и Grok.
 */

import type { ArtifactVersionSource } from '../../../../../shared/artifacts';
import { NEO3_ID_ATTR } from '../editorModel';

/** All fragments of one message together, characters. */
export const ASK_FRAGMENT_LIMIT = 2000;
/** After «Попросить агента» the file is checked often for a while. */
export const ASK_FAST_POLL_MS = 5000;
export const ASK_FAST_WINDOW_MS = 10 * 60_000;
/** Otherwise — rarely, and only while the page is visible. */
export const IDLE_POLL_MS = 30_000;

export type AskItem = { selector: string; fragment: string };
export type PixelRect = { x: number; y: number; w: number; h: number };
export type FractionRegion = { x: number; y: number; w: number; h: number };
/** What goes to the chat: the text and the pictures to attach. */
export type AskPayload = { text: string; images: File[] };

const ID_ATTR_RE = new RegExp(`\\s${NEO3_ID_ATTR}="[^"]*"`, 'g');

/** The element markup as it is in the file: without the editor's `data-neo3-id`. */
export function stripEditorIds(html: string): string {
  return html.replace(ID_ATTR_RE, '');
}

/** A fence longer than any backtick run inside — the fragment cannot close it. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

const snapshotLine = (snapshot: boolean) => (snapshot
  ? 'Снимок участка — во вложении.'
  : 'Снимок участка: без снимка (не получилось снять).');

export function buildSelectionAskMessage(input: {
  title: string;
  filePath: string;
  versionN: number;
  items: AskItem[];
  request: string;
  snapshot: boolean;
  unsavedEdits: boolean;
}): string {
  const items = input.items.slice(0, 10);
  const budget = Math.floor(ASK_FRAGMENT_LIMIT / Math.max(1, items.length));
  const lines = [
    `Просьба по артефакту «${input.title}» (выделено в режиме «Правка»).`,
    `Файл: ${input.filePath} (версия ${input.versionN})`,
  ];
  items.forEach((item, index) => {
    const cut = item.fragment.length > budget;
    const fragment = cut ? item.fragment.slice(0, budget) : item.fragment;
    const fence = fenceFor(fragment);
    lines.push(
      '',
      `${items.length > 1 ? `${index + 1}. ` : ''}Элемент: \`${item.selector}\``,
      `Фрагмент HTML${cut ? ' (обрезан)' : ''}:`,
      `${fence}html\n${fragment}\n${fence}`,
    );
  });
  if (input.unsavedEdits) lines.push('', 'В редакторе есть несохранённые правки: фрагмент показан с ними, в файле их ещё нет.');
  lines.push(
    '',
    `Просьба: ${input.request.trim()}`,
    '',
    snapshotLine(input.snapshot),
    'Поправь сам файл — холст заметит новую версию.',
  );
  return lines.join('\n');
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

export function buildRegionAskMessage(input: {
  title: string;
  filePath: string;
  versionN: number;
  region: FractionRegion;
  pixels: PixelRect | null;
  request: string;
  snapshot: boolean;
}): string {
  const { region, pixels } = input;
  const where = `слева ${percent(region.x)}, сверху ${percent(region.y)}, ширина ${percent(region.w)}, высота ${percent(region.h)}`;
  return [
    `Просьба по картинке «${input.title}» (выделен участок).`,
    `Файл: ${input.filePath} (версия ${input.versionN})`,
    `Участок: ${where}${pixels ? ` (в пикселях: x ${pixels.x}, y ${pixels.y}, ${pixels.w}×${pixels.h})` : ''}`,
    '',
    `Просьба: ${input.request.trim()}`,
    '',
    snapshotLine(input.snapshot),
    'Поправь сам файл — холст заметит новую версию.',
  ].join('\n');
}

/** A region in fractions of the picture → whole pixels inside the picture; null — no picture size. */
export function regionToPixels(region: FractionRegion, natural: { width: number; height: number }): PixelRect | null {
  if (!(natural.width > 0) || !(natural.height > 0)) return null;
  const x = Math.min(natural.width - 1, Math.max(0, Math.round(region.x * natural.width)));
  const y = Math.min(natural.height - 1, Math.max(0, Math.round(region.y * natural.height)));
  const w = Math.max(1, Math.min(natural.width - x, Math.round(region.w * natural.width)));
  const h = Math.max(1, Math.min(natural.height - y, Math.round(region.h * natural.height)));
  return { x, y, w, h };
}

/** Delay before the next file check; null — do not check (hidden page, no recent ask). */
export function askPollDelay(input: { askedAt: number | null; now: number; visible: boolean }): number | null {
  if (input.askedAt !== null && input.now - input.askedAt < ASK_FAST_WINDOW_MS) return ASK_FAST_POLL_MS;
  return input.visible ? IDLE_POLL_MS : null;
}

/** A newer version than `beforeLatest` that is not the user's own «Правка вручную». */
export function detectAgentUpdate(
  beforeLatest: number | null,
  next: { latestVersion: number; versions: { n: number; source: ArtifactVersionSource }[] },
): { from: number; to: number } | null {
  if (beforeLatest === null || next.latestVersion <= beforeLatest) return null;
  const foreign = next.versions.some((version) => version.n > beforeLatest && version.source !== 'edit');
  return foreign ? { from: beforeLatest, to: next.latestVersion } : null;
}

export interface AskAgentStore {
  /** An ask for a chat that is not open: sent when that chat shows the artifact. */
  park(sessionId: string, artifactId: string, payload: AskPayload): void;
  take(sessionId: string, artifactId: string): AskPayload | null;
  markAsked(artifactId: string, at: number): void;
  askedAt(artifactId: string): number | null;
}

export function createAskAgentStore(): AskAgentStore {
  const parked = new Map<string, AskPayload>();
  const asked = new Map<string, number>();
  const key = (sessionId: string, artifactId: string) => `${sessionId}\u0000${artifactId}`;
  return {
    park: (sessionId, artifactId, payload) => {
      parked.set(key(sessionId, artifactId), payload);
    },
    take: (sessionId, artifactId) => {
      const id = key(sessionId, artifactId);
      const payload = parked.get(id) ?? null;
      parked.delete(id);
      return payload;
    },
    markAsked: (artifactId, at) => {
      asked.set(artifactId, at);
    },
    askedAt: (artifactId) => asked.get(artifactId) ?? null,
  };
}

/** One per app: an ask outlives the canvas tab while the source chat opens. */
export const askAgentStore = createAskAgentStore();

const PNG_DATA_URL_RE = /^data:image\/png;base64,([A-Za-z0-9+/]*={0,2})$/;

/** A PNG data URL (bridge snapshot, canvas) → a File to attach; anything else — null. */
export function dataUrlToFile(dataUrl: string | null, name: string): File | null {
  const match = typeof dataUrl === 'string' ? PNG_DATA_URL_RE.exec(dataUrl) : null;
  if (!match) return null;
  try {
    const binary = atob(match[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes.length ? new File([bytes], name, { type: 'image/png' }) : null;
  } catch {
    return null;
  }
}

/** `snapshot-<title>-<time>.png`, safe for any file system. */
export function snapshotFileName(title: string, at: Date): string {
  const base = title.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'artifact';
  const stamp = at.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-');
  return `snapshot-${base}-${stamp}.png`;
}
