/**
 * Drag-and-drop normalisation for the composer.
 *
 * react-dropzone only reacts to drags whose `types` contain `Files`; anything
 * else it swallows without a trace (its document listener prevents the drop).
 * Native apps do not always hand the browser a ready file: Telegram Desktop
 * 7.3 dragged into Firefox 157 (12.10.2026) attached nothing at all — the drop
 * arrived either as a link/HTML flavour or as a zero-byte file, and both paths
 * ended silently. Here every flavour is read while the event is alive, turned
 * into files where the page is allowed to, and an unusable drop is described
 * so the composer can say what came in instead of doing nothing.
 */
import { collectPastedFiles } from './clipboardPaste';

export type DropSnapshot = {
  types: string[];
  files: File[];
  urls: string[];
};

export type DropResolution = {
  files: File[];
  /** Human-readable reason when nothing could be attached. */
  reason: string | null;
};

const ATTACHABLE_URL = /^(?:https?:|data:|blob:)/i;
const IMG_SRC = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;

const linesOf = (value: string): string[] =>
  value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

/** Every URL the drag carries, in preference order, deduped. */
export const extractDropUrls = (transfer: Pick<DataTransfer, 'getData'>): string[] => {
  const read = (type: string): string => {
    try {
      return transfer.getData(type) ?? '';
    } catch {
      return '';
    }
  };

  const found: string[] = [];
  // RFC 2483: one URL per line, `#` lines are comments.
  found.push(...linesOf(read('text/uri-list')).filter((line) => !line.startsWith('#')));
  // Firefox: URL and title on alternating lines.
  found.push(...linesOf(read('text/x-moz-url')).filter((_, index) => index % 2 === 0));
  for (const match of read('text/html').matchAll(IMG_SRC)) {
    found.push(match[1].replace(/&amp;/g, '&'));
  }
  const plain = read('text/plain').trim();
  if (plain && !plain.includes('\n') && /^(?:https?:|data:|blob:|file:)/i.test(plain)) {
    found.push(plain);
  }

  return [...new Set(found)];
};

/** Read everything off the transfer synchronously — it is empty once the event returns. */
export const snapshotDrop = (transfer: DataTransfer): DropSnapshot => ({
  types: Array.from(transfer.types ?? []),
  files: collectPastedFiles(transfer),
  urls: extractDropUrls(transfer),
});

/** Does the drop already carry real bytes that react-dropzone will attach on its own? */
export const hasUsableFiles = (snapshot: DropSnapshot): boolean =>
  snapshot.files.some((file) => file.size > 0);

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

const nameFromUrl = (url: string, type: string, index: number): string => {
  if (!url.startsWith('data:') && !url.startsWith('blob:')) {
    try {
      const last = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
      if (/\.[A-Za-z0-9]{1,8}$/.test(last)) {
        return last;
      }
    } catch {
      // fall through to a generated name
    }
  }
  const extension = EXTENSION_BY_TYPE[type] ?? 'bin';
  return `dropped-${Date.now()}-${index + 1}.${extension}`;
};

/** A zero-byte file may be a promise the source app finished writing a moment later. */
const rereadFile = async (file: File): Promise<File | null> => {
  try {
    const bytes = await file.arrayBuffer();
    return bytes.byteLength > 0
      ? new File([bytes], file.name || 'dropped-file', { type: file.type, lastModified: file.lastModified })
      : null;
  } catch {
    return null;
  }
};

const fetchAsFile = async (url: string, index: number, fetchImpl: typeof fetch): Promise<File | null> => {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    if (blob.size === 0) {
      return null;
    }
    const type = blob.type || response.headers.get('content-type') || '';
    return new File([blob], nameFromUrl(url, type, index), { type });
  } catch {
    return null;
  }
};

export const describeDrop = (snapshot: DropSnapshot): string => {
  const types = snapshot.types.length > 0 ? snapshot.types.join(', ') : 'нет данных';
  const localOnly = snapshot.urls.length > 0 && snapshot.urls.every((url) => url.startsWith('file:'));
  const hint = localOnly
    ? 'Браузер дал только путь к файлу на диске, а читать его страница не может.'
    : 'Браузер не передал саму картинку.';
  return `Перетаскивание не сработало: ${hint} Вставь картинку через ⌘V или кнопку «+». (Что пришло: ${types})`;
};

/** Turn whatever the drag carried into attachable files. */
export const resolveDroppedFiles = async (
  snapshot: DropSnapshot,
  fetchImpl: typeof fetch = fetch,
): Promise<DropResolution> => {
  const files: File[] = snapshot.files.filter((file) => file.size > 0);

  if (files.length === 0) {
    for (const file of snapshot.files) {
      const reread = await rereadFile(file);
      if (reread) {
        files.push(reread);
      }
    }
  }

  if (files.length === 0) {
    const remote = snapshot.urls.filter((url) => ATTACHABLE_URL.test(url));
    for (const [index, url] of remote.entries()) {
      const file = await fetchAsFile(url, index, fetchImpl);
      if (file) {
        files.push(file);
      }
    }
  }

  return files.length > 0
    ? { files, reason: null }
    : { files, reason: describeDrop(snapshot) };
};
