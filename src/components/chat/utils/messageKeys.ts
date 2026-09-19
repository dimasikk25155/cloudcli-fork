import type { ChatMessage } from '../types/types';

const toMessageKeyPart = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

/**
 * Grok history without stampGrokHistoryMessages mints a new grok_<uuid> (and
 * the same `now()` clock) on every parse. Using those as React keys remounted
 * follow-up bubbles on each refresh and made them look deleted.
 */
const isUnstableGrokHistoryId = (value: unknown): boolean => (
  typeof value === 'string' && /^grok_[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)
);

export const getIntrinsicMessageKey = (message: ChatMessage): string | null => {
  // User turns: content is the stable identity across local echo → history.
  // Timestamp/id change on every Grok history reread, so they cannot be keys.
  if (message.type === 'user') {
    const contentPreview = typeof message.content === 'string' ? message.content.slice(0, 80) : '';
    const firstImage = Array.isArray(message.images) ? message.images[0] : null;
    const imageHint = firstImage
      ? toMessageKeyPart(firstImage.path || firstImage.name) || ''
      : '';
    if (contentPreview || imageHint) {
      return `message-user-${contentPreview}-${imageHint}`;
    }
  }

  const candidates = [
    message.id,
    message.messageId,
    message.toolId,
    message.toolCallId,
    message.blobId,
    message.rowid,
    message.sequence,
  ];

  for (const candidate of candidates) {
    if (isUnstableGrokHistoryId(candidate)) {
      continue;
    }
    const keyPart = toMessageKeyPart(candidate);
    if (keyPart) {
      return `message-${message.type}-${keyPart}`;
    }
  }

  const timestamp = new Date(message.timestamp).getTime();
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const contentPreview = typeof message.content === 'string' ? message.content.slice(0, 48) : '';
  const toolName = typeof message.toolName === 'string' ? message.toolName : '';
  return `message-${message.type}-${timestamp}-${toolName}-${contentPreview}`;
};
