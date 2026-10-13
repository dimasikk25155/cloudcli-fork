/**
 * Clipboard paste normalisation.
 *
 * Native apps (Telegram, Finder, Preview) put an image on the clipboard as
 * several flavours at once: the bitmap itself plus the on-disk path of the
 * cached file. Browsers disagree on what they hand to the page:
 *
 * - Chrome/Firefox expose only the image, so a paste attaches the file and
 *   nothing lands in the textarea.
 * - Safari exposes both. The file attaches *and* the path is inserted as text,
 *   which is why a Telegram paste used to fill the composer with
 *   `/Users/…/telegram-cloud-photo-size-2-….jpg`.
 * - Safari also reports those files with an empty or non-`image/*` MIME type
 *   and keeps `items` non-empty (the text flavour is an item too), so the old
 *   "image items, or `files` when there are no items" rule missed them.
 *
 * So: take every file the clipboard offers, from either list, and drop the
 * pasted text when it is merely a pointer to a file we already attached.
 */

/** A local path or `file://` URL ending in an extension — junk once the file is attached. */
const LOCAL_FILE_PATH = /^(?:file:\/\/|\/|~\/|[A-Za-z]:[\\/])[^\n]*\.[A-Za-z0-9]{1,8}$/;

/**
 * Identity of one pasted file. Deliberately without `lastModified`: Chromium
 * rebuilds the picture on every read of the clipboard and stamps each `File`
 * with the moment of that read, so the same screenshot comes back with two
 * different timestamps — measured 2 ms apart for a 1568px shot on Electron 38,
 * which is why one paste attached it twice in the desktop app. Newer Chrome
 * caches the object, so browsers never showed the duplicate.
 */
const fileKey = (file: File) => `${file.name}|${file.size}|${file.type}`;

/**
 * Every file on the clipboard, deduped — Safari lists the same file in both
 * `items` and `files`.
 */
export const collectPastedFiles = (clipboard: DataTransfer | null | undefined): File[] => {
  if (!clipboard) {
    return [];
  }

  const fromItems = Array.from(clipboard.items ?? [])
    // Trust `kind`, not `type`: Safari reports Telegram images as files with an
    // empty MIME type, and non-image files are attachable anyway.
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  const collected: File[] = [];
  const seen = new Set<string>();
  for (const file of [...fromItems, ...Array.from(clipboard.files ?? [])]) {
    const key = fileKey(file);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    collected.push(file);
  }

  return collected;
};

/**
 * Should the textarea keep the pasted text after `files` were attached?
 * Empty text and bare file paths/names are dropped; a real caption or URL stays.
 */
export const isRedundantPastedText = (text: string, files: File[]): boolean => {
  const trimmed = (text ?? '').trim();
  if (!trimmed) {
    return true;
  }
  if (trimmed.includes('\n')) {
    return false;
  }
  if (files.some((file) => file.name && file.name === trimmed)) {
    return true;
  }
  return LOCAL_FILE_PATH.test(trimmed);
};

/** What was on the clipboard, as a comparable string. */
export const pasteSignature = (files: File[]): string => files.map(fileKey).join('||');

/**
 * Two paste events this close together carrying the same files are one paste
 * that reached us twice, not a user attaching the same picture again.
 */
export const REPEAT_PASTE_WINDOW_MS = 700;

/** One paste record: what came in and when. */
export type PasteRecord = { signature: string; at: number };

/**
 * Second guard against duplicated attachments (the first is {@link fileKey}):
 * whatever layer fires the extra event — a native menu's paste role on top of
 * the page's own handling, a re-dispatched event — the same clipboard arriving
 * again within the window is ignored.
 */
export const isRepeatPaste = (
  signature: string,
  previous: PasteRecord | null,
  now: number,
): boolean =>
  Boolean(previous) && previous!.signature === signature && now - previous!.at < REPEAT_PASTE_WINDOW_MS;

/** http(s) only: local paths, `data:` and `blob:` say nothing about the page. */
const asWebUrl = (raw: string | null | undefined): string | null => {
  const text = (raw ?? '').trim();
  if (!text) {
    return null;
  }
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
};

const decodeHtmlAttribute = (value: string): string =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const readFlavour = (clipboard: DataTransfer, type: string): string => {
  try {
    return clipboard.getData?.(type) ?? '';
  } catch {
    // Some engines throw for flavours they do not expose to the page.
    return '';
  }
};

/**
 * The web address that came on the clipboard together with a picture, for the
 * «откуда скрин» caption. In order of trust: `text/uri-list` (first non-comment
 * line), the `SourceURL:` header / `<base href>` some apps put into
 * `text/html`, then the picture's own `src` (a browser-copied image) or the
 * first link in the fragment. Null when the clipboard brought none.
 */
export const pastedPageUrl = (clipboard: DataTransfer | null | undefined): string | null => {
  if (!clipboard) {
    return null;
  }

  const uriList = readFlavour(clipboard, 'text/uri-list');
  for (const line of uriList.split(/\r?\n/)) {
    if (line.trim().startsWith('#')) {
      continue;
    }
    const url = asWebUrl(line);
    if (url) {
      return url;
    }
  }

  const html = readFlavour(clipboard, 'text/html');
  if (!html) {
    return null;
  }
  const candidates = [
    html.match(/^SourceURL:(\S+)/m)?.[1],
    html.match(/<base\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i)?.[1],
    html.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)?.[1],
    html.match(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i)?.[1],
  ];
  for (const candidate of candidates) {
    const url = asWebUrl(candidate ? decodeHtmlAttribute(candidate) : null);
    if (url) {
      return url;
    }
  }
  return null;
};
