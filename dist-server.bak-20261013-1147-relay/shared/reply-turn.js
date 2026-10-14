/**
 * Which reply do reply chips belong to? One rule for the client (it shows the
 * chips and sends the reply's fingerprint) and the server (it checks the
 * fingerprint and generates the chips). Both run it over the same normalized
 * transcript messages, raw content, so the fingerprints agree.
 */
/**
 * User-role text the user never typed: Stop-hook follow-ups (Grok CLI and our
 * own hook) and background-task notifications. They neither end the reply nor
 * count as the user's message — the chat does not paint them as Dima's either.
 */
export function isInjectedUserText(text) {
    const trimmed = text.trim();
    return /^Stop hook feedback:/i.test(trimmed)
        || /^This is an automatic follow-up from a session Stop hook/i.test(trimmed)
        || trimmed.startsWith('<task-notification>');
}
function textOf(message, role) {
    if (message.kind !== 'text' || message.role !== role || typeof message.content !== 'string') {
        return null;
    }
    const trimmed = message.content.trim();
    if (!trimmed || (role === 'user' && isInjectedUserText(trimmed))) {
        return null;
    }
    return trimmed;
}
/**
 * The last assistant text block and the user message that led to it — or
 * null once the user has written after it. Tool calls, thinking and earlier
 * text blocks of the same turn are skipped: the chips answer the final words.
 */
export function lastReplyTurn(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (textOf(messages[index], 'user') !== null) {
            return null;
        }
        const assistant = textOf(messages[index], 'assistant');
        if (assistant === null) {
            continue;
        }
        for (let back = index - 1; back >= 0; back -= 1) {
            const user = textOf(messages[back], 'user');
            if (user !== null) {
                return { assistant, user };
            }
        }
        return { assistant, user: '' };
    }
    return null;
}
//# sourceMappingURL=reply-turn.js.map