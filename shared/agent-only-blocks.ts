/**
 * Parts of a user message meant for the agent only: the job brief behind a
 * catalog button (`<catalog_brief>`), the «откуда скрин» captions of
 * attached pictures (`<screenshot_context>`), the quote + parent reply of
 * a side question (`<btw_context>`) and the role of a Neo3 agent
 * (`<agent_brief>`, shared/agent-brief.ts). Bubbles, previews and session
 * titles show the message without them.
 */

const AGENT_ONLY_BLOCK = /\s*<(catalog_brief|screenshot_context|btw_context|agent_brief)>[\s\S]*?<\/\1>\s*/g;

/** The message as the person typed it. */
export function stripAgentOnlyBlocks(text: string): string {
  return String(text || '').replace(AGENT_ONLY_BLOCK, '\n\n').trim();
}
