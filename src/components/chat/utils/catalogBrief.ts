import { stripAgentOnlyBlocks } from '../../../../shared/agent-only-blocks.js';

/** Hidden job brief wrapped around a short user-visible label. */
export const CATALOG_BRIEF_OPEN = '<catalog_brief>';
export const CATALOG_BRIEF_CLOSE = '</catalog_brief>';

export function wrapCatalogBrief(brief: string, visible: string): string {
  const trimmed = brief.trim();
  if (!trimmed) return visible;
  return `${CATALOG_BRIEF_OPEN}\n${trimmed}\n${CATALOG_BRIEF_CLOSE}\n\n${visible}`;
}

/**
 * What a person should see in the bubble — never the agent-only instructions
 * or the «откуда скрин» captions.
 */
export function visibleUserText(content: string): string {
  return stripAgentOnlyBlocks(content);
}
