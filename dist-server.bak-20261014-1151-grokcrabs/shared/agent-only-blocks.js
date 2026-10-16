/**
 * Parts of a user message meant for the agent only: the job brief behind a
 * catalog button (`<catalog_brief>`) and the «откуда скрин» captions of
 * attached pictures (`<screenshot_context>`). Bubbles, previews and session
 * titles show the message without them.
 */
const AGENT_ONLY_BLOCK = /\s*<(catalog_brief|screenshot_context)>[\s\S]*?<\/\1>\s*/g;
/** The message as the person typed it. */
export function stripAgentOnlyBlocks(text) {
    return String(text || '').replace(AGENT_ONLY_BLOCK, '\n\n').trim();
}
//# sourceMappingURL=agent-only-blocks.js.map