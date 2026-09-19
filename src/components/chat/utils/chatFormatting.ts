export function decodeHtmlEntities(text: string) {
  if (!text) return text;
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export function normalizeInlineCodeFences(text: string) {
  if (!text || typeof text !== 'string') return text;
  try {
    return text.replace(/```[ \t]*([^\n\r]+?)[ \t]*```/g, '`$1`');
  } catch {
    return text;
  }
}

export function unescapeWithMathProtection(text: string) {
  if (!text || typeof text !== 'string') return text;

  const mathBlocks: string[] = [];
  const placeholderPrefix = '__MATH_BLOCK_';
  const placeholderSuffix = '__';

  let processedText = text.replace(/\$\$([\s\S]*?)\$\$|\$([^\$\n]+?)\$/g, (match) => {
    const index = mathBlocks.length;
    mathBlocks.push(match);
    return `${placeholderPrefix}${index}${placeholderSuffix}`;
  });

  processedText = processedText.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');

  processedText = processedText.replace(
    new RegExp(`${placeholderPrefix}(\\d+)${placeholderSuffix}`, 'g'),
    (match, index) => {
      return mathBlocks[parseInt(index, 10)];
    },
  );

  return processedText;
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatUsageLimitText(text: string) {
  try {
    if (typeof text !== 'string') return text;
    return text.replace(/Claude AI usage limit reached\|(\d{10,13})/g, (match, ts) => {
      let timestampMs = parseInt(ts, 10);
      if (!Number.isFinite(timestampMs)) return match;
      if (timestampMs < 1e12) timestampMs *= 1000;
      const reset = new Date(timestampMs);

      const timeStr = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(reset);

      const offsetMinutesLocal = -reset.getTimezoneOffset();
      const sign = offsetMinutesLocal >= 0 ? '+' : '-';
      const abs = Math.abs(offsetMinutesLocal);
      const offH = Math.floor(abs / 60);
      const offM = abs % 60;
      const gmt = `GMT${sign}${offH}${offM ? ':' + String(offM).padStart(2, '0') : ''}`;
      const tzId = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const cityRaw = tzId.split('/').pop() || '';
      const city = cityRaw
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, (char) => char.toUpperCase());
      const tzHuman = city ? `${gmt} (${city})` : gmt;

      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const dateReadable = `${reset.getDate()} ${months[reset.getMonth()]} ${reset.getFullYear()}`;

      return `Claude usage limit reached. Your limit will reset at **${timeStr} ${tzHuman}** - ${dateReadable}`;
    });
  } catch {
    return text;
  }
}

const DISPLAY_ATTACHMENT_TAG_PATTERN = /\s*<(images_input|attached_files)>[\s\S]*?<\/\1>\s*/gi;

/**
 * Drops the gateway's attachment-reference blocks from text shown in a user
 * bubble. The model still sees the tag in the prompt; this is display-only,
 * so a leak from any provider history parser cannot paint the machinery.
 */
export function stripAttachmentDisplayTags(text: string): string {
  if (typeof text !== 'string' || text.length === 0) {
    return text;
  }
  if (!text.includes('<images_input>') && !text.includes('<attached_files>')) {
    return text;
  }
  return text.replace(DISPLAY_ATTACHMENT_TAG_PATTERN, '\n').trim();
}

/**
 * Grok CLI 1.0.13+ (and our Stop-hook follow-up) injects a fake user turn so
 * the model keeps working. The chat must never paint it as if Dima typed it.
 */
export function isStopHookFeedbackText(text: string): boolean {
  const trimmed = (text || '').trim();
  return /^Stop hook feedback:/i.test(trimmed)
    || /^This is an automatic follow-up from a session Stop hook/i.test(trimmed);
}

/** Display-only: keep provider provenance on disk, outside the chat/copy/TTS. */
export function stripMemoryCitations(text: string): string {
  const opening = '<oai-mem-citation>';
  // Protect literal examples in fenced and inline code. An open citation hides
  // everything until its close (or stream end), so metadata never flashes.
  return text.replace(
    /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)|<oai-mem-citation>[\s\S]*?(?:<\/oai-mem-citation>|$)|<oai-[a-z-]*>?$/gi,
    (match, code: string | undefined) => {
      if (code) return code;
      return match.toLowerCase().startsWith(opening) || opening.startsWith(match.toLowerCase()) ? '' : match;
    },
  ).trimEnd();
}
