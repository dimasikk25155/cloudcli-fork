import { extractGrokUserTurn } from '@/modules/providers/list/grok/grok-sessions.provider.js';
import { extractFirstValidJsonlData, normalizeSessionName, readObjectRecord } from '@/shared/utils.js';

export const GROK_UNTITLED_SESSION_TITLE = 'Новый чат';
export const GROK_LEGACY_UNTITLED_SESSION_TITLE = 'Untitled Grok Session';

const MAX_TITLE_CHARS = 52;
const MAX_TITLE_WORDS = 8;

const CYRILLIC = /[А-Яа-яЁё]/;

export function isPlaceholderGrokSessionTitle(name: string | null | undefined): boolean {
  const trimmed = (name ?? '').trim();
  return !trimmed
    || trimmed === GROK_UNTITLED_SESSION_TITLE
    || trimmed === GROK_LEGACY_UNTITLED_SESSION_TITLE;
}

export function hasCyrillic(text: string): boolean {
  return CYRILLIC.test(text);
}

/**
 * Short sidebar title from the first words of what the user actually typed.
 *
 * Grok CLI auto-titles in English even when the prompt is Russian dictation.
 * Neo3 copies the start of the first user turn instead of guessing the
 * "meaning", so the sidebar matches the prompt the user remembers.
 */
export function composeGrokSessionTitle(
  rawText: string,
  fallback = GROK_UNTITLED_SESSION_TITLE,
): string {
  const turn = extractGrokUserTurn(rawText || '');
  const fromStart = firstWordsFromPrompt(turn.text);
  if (fromStart) {
    return fromStart;
  }
  if ((turn.images?.length ?? 0) > 0) {
    return 'Картинка';
  }
  return fallback;
}

/**
 * Picks the name the Grok indexer should persist.
 *
 * A UI rename (or a title we already wrote) always wins over the CLI's English
 * auto-title. A `/rename` inside Grok itself is `titleIsManual` and is kept.
 * Otherwise the first words of the first user turn become the sidebar name.
 */
export function resolveGrokSessionTitle(input: {
  existingName?: string | null;
  cliTitle?: string | null;
  firstUserText?: string | null;
  titleIsManual?: boolean;
}): string {
  const cliTitle = (input.cliTitle ?? '').trim();
  const existingName = (input.existingName ?? '').trim();

  if (input.titleIsManual) {
    return normalizeSessionName(cliTitle || existingName, GROK_UNTITLED_SESSION_TITLE);
  }

  if (!isPlaceholderGrokSessionTitle(existingName) && existingName !== cliTitle) {
    return existingName;
  }

  const fromUser = composeGrokSessionTitle(input.firstUserText ?? '', '');
  if (fromUser) {
    return fromUser;
  }

  if (cliTitle && hasCyrillic(cliTitle)) {
    return firstWordsFromPrompt(cliTitle) || GROK_UNTITLED_SESSION_TITLE;
  }

  return GROK_UNTITLED_SESSION_TITLE;
}

export async function readGrokFirstUserText(historyPath: string): Promise<string> {
  const found = await extractFirstValidJsonlData(historyPath, (raw) => {
    const text = textFromGrokHistoryRow(raw);
    return text || null;
  });
  return found ?? '';
}

function textFromGrokHistoryRow(raw: unknown): string {
  const record = readObjectRecord(raw);
  if (!record) {
    return '';
  }
  if (record.type !== 'user' && record.role !== 'user') {
    return '';
  }
  if (typeof record.synthetic_reason === 'string' && record.synthetic_reason.trim()) {
    return '';
  }

  const rawText = typeof record.content === 'string'
    ? record.content
    : Array.isArray(record.content)
      ? record.content
        .map((part) => {
          if (typeof part === 'string') {
            return part;
          }
          const block = readObjectRecord(part);
          return block && typeof block.text === 'string' ? block.text : '';
        })
        .filter(Boolean)
        .join('\n')
      : '';

  return extractGrokUserTurn(rawText).text.trim();
}

function firstWordsFromPrompt(raw: string): string {
  let text = raw.replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > MAX_TITLE_WORDS) {
    text = words.slice(0, MAX_TITLE_WORDS).join(' ');
  }

  if (text.length > MAX_TITLE_CHARS) {
    text = text.slice(0, MAX_TITLE_CHARS).replace(/\s+\S*$/, '');
  }

  text = text.replace(/[,:;–—-]+$/g, '').trim();
  if (!text) {
    return '';
  }

  return text.charAt(0).toUpperCase() + text.slice(1);
}
