/**
 * «Откуда скрин» — the note the agent gets next to an attached picture.
 *
 * The caption travels inside a hidden block of the message: the agent reads
 * it, the person never sees it in the composer or in the chat bubble
 * (`visibleUserText` strips the block).
 */

import { detectSecrets } from '../../../../shared/secret-detect.js';

/** How the picture reached the composer. */
export type ScreenshotSource = 'paste' | 'file' | 'drop';

export type ScreenshotMeta = {
  fileName: string;
  source: ScreenshotSource;
  /** When it was attached. */
  attachedAt: Date | string | number;
  projectName?: string | null;
  /**
   * Chat the picture was attached in; empty for a chat not created yet. (The
   * composer lives only on the chat tab, so there is no tab to report.)
   */
  sessionName?: string | null;
  /** Page address the clipboard carried along with the picture, if any. */
  pageUrl?: string | null;
  /** The person drew on it in the markup editor. */
  edited?: boolean;
};

/** A picture the agent sees as an image (and the markup editor can open). */
export const isPictureFile = (file: Pick<File, 'name' | 'type'>): boolean =>
  (typeof file.type === 'string' && file.type.startsWith('image/')) ||
  /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name || '');

const SOURCE_LABELS: Record<ScreenshotSource, string> = {
  paste: 'вставлен из буфера',
  file: 'выбран файл',
  drop: 'перетащен в окно',
};

const pad = (value: number) => String(value).padStart(2, '0');

/** `12.10.2026 14:05` in local time; empty when the date is unusable. */
function formatLocalTime(value: ScreenshotMeta['attachedAt']): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const SCREENSHOT_CONTEXT_OPEN = '<screenshot_context>';
export const SCREENSHOT_CONTEXT_CLOSE = '</screenshot_context>';

/**
 * The message the agent receives: typed text first (session titles and
 * history previews are built from the start), then the captions in a block
 * `visibleUserText` removes from every bubble.
 */
export function withScreenshotContext(visible: string, captions: string[]): string {
  const lines = captions.map((caption) => caption.trim()).filter(Boolean);
  if (lines.length === 0) {
    return visible;
  }
  return `${visible}\n\n${SCREENSHOT_CONTEXT_OPEN}\n${lines.join('\n')}\n${SCREENSHOT_CONTEXT_CLOSE}`;
}

const MAX_URL_LENGTH = 500;

/**
 * The page address as it may be shown to the agent, or null. Only http(s);
 * login data is dropped, and a query or fragment carrying something that
 * looks like a key is cut off — the caption bypasses the composer's secret
 * guard, so it must never carry one itself.
 */
function safePageUrl(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  url.username = '';
  url.password = '';
  let candidate = url.toString();
  if (detectSecrets(candidate).length > 0) {
    url.search = '';
    url.hash = '';
    candidate = url.toString();
    if (detectSecrets(candidate).length > 0) {
      return null;
    }
  }
  return candidate.length > MAX_URL_LENGTH ? `${candidate.slice(0, MAX_URL_LENGTH)}…` : candidate;
}

export function buildScreenshotCaption(meta: ScreenshotMeta): string {
  const head = [`скриншот ${meta.fileName || 'без имени'}`, SOURCE_LABELS[meta.source] ?? SOURCE_LABELS.file];
  const time = formatLocalTime(meta.attachedAt);
  if (time) {
    head.push(time);
  }

  const where: string[] = [];
  const project = (meta.projectName ?? '').trim();
  if (project) {
    where.push(`проект ${project}`);
  }
  const session = (meta.sessionName ?? '').replace(/\s+/g, ' ').trim();
  if (session) {
    where.push(`чат «${session.length > 80 ? `${session.slice(0, 79)}…` : session}»`);
  } else if (project) {
    where.push('новый чат');
  }

  const parts = [head.join(', ')];
  if (where.length > 0) {
    parts.push(`прикреплён в Neo3: ${where.join(', ')}`);
  }
  const pageUrl = safePageUrl(meta.pageUrl);
  if (pageUrl) {
    parts.push(`адрес страницы: ${pageUrl}`);
  }
  if (meta.edited) {
    parts.push('на картинке пометки пользователя');
  }
  return parts.join('; ');
}
