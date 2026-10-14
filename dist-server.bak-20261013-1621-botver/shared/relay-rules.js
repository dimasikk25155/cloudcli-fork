/**
 * Relay ("перенести в новый чат") — the pure rules: when the band shows,
 * how "not now" postpones it, and how the handoff path is read from the
 * agent's last reply. No React, no network. One module for both sides: the
 * relay band (client) and the auto-relay (server) decide by the same rule.
 */
const HOUR_MS = 60 * 60 * 1000;
/** Context is "full enough" at this share of the selected model's window… */
export const RELAY_CONTEXT_PERCENT = 50;
/** …or at this many occupied tokens, whatever the window. */
export const RELAY_CONTEXT_TOKENS = 400_000;
/** A chat this old is offered a relay regardless of its context. */
export const RELAY_AGE_HOURS = 12;
/** "Not now" hides the band until the context grows by this many points… */
export const RELAY_SNOOZE_PERCENT = 10;
/** …(or this many tokens when the window is unknown)… */
export const RELAY_SNOOZE_TOKENS = 100_000;
/** …or the chat ages this many more hours. */
export const RELAY_SNOOZE_HOURS = 6;
export const DEFAULT_RELAY_THRESHOLDS = Object.freeze({
    contextPercent: RELAY_CONTEXT_PERCENT,
    contextTokens: RELAY_CONTEXT_TOKENS,
    ageHours: RELAY_AGE_HOURS,
});
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
/**
 * Latest occupied context from a token-usage payload — the same `used` that
 * TokenUsageSummary divides by the model window. Cumulative billing counters
 * (inputTokens / outputTokens) and the runtime `total` are never used here.
 */
export function contextOccupancy(usage) {
    return finite(usage?.used);
}
/** Milliseconds since epoch for an ISO / SQLite ("YYYY-MM-DD HH:MM:SS", UTC) / numeric timestamp. */
export function parseSessionTime(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value !== 'string' || !value.trim()) {
        return null;
    }
    const trimmed = value.trim();
    const sqlite = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed);
    const parsed = Date.parse(sqlite ? `${trimmed.replace(' ', 'T')}Z` : trimmed);
    return Number.isFinite(parsed) ? parsed : null;
}
/** The numbers the rule compares; also what "Не сейчас" stores. */
export function relayMeasures(input) {
    const used = finite(input.usedTokens);
    const window = finite(input.contextWindow);
    const created = parseSessionTime(input.createdAt);
    return {
        usedTokens: used,
        contextPercent: used !== null && window !== null && window > 0 ? (used / window) * 100 : null,
        ageHours: created !== null ? Math.max(0, (input.now - created) / HOUR_MS) : null,
    };
}
function contextDue(measures, dismissed, thresholds) {
    const { usedTokens, contextPercent } = measures;
    const reached = (contextPercent !== null && contextPercent >= thresholds.contextPercent)
        || (usedTokens !== null && usedTokens >= thresholds.contextTokens);
    if (!reached || !dismissed) {
        return reached;
    }
    if (contextPercent !== null && dismissed.contextPercent !== null) {
        return contextPercent >= dismissed.contextPercent + RELAY_SNOOZE_PERCENT;
    }
    if (usedTokens !== null && dismissed.usedTokens !== null) {
        return usedTokens >= dismissed.usedTokens + RELAY_SNOOZE_TOKENS;
    }
    return true;
}
function ageDue(measures, dismissed, thresholds) {
    const { ageHours } = measures;
    if (ageHours === null || ageHours < thresholds.ageHours) {
        return false;
    }
    if (!dismissed || dismissed.ageHours === null) {
        return true;
    }
    return ageHours >= dismissed.ageHours + RELAY_SNOOZE_HOURS;
}
/**
 * Shows the band when the context is ≥50% of the model window or ≥400K
 * tokens, or the chat is ≥12 h old. After "Не сейчас" each criterion comes
 * back only past its own next step (+10 points / +6 h from the dismissal),
 * so dismissing for age never postpones the first context threshold.
 * `thresholds` replaces the defaults (the server's live-check hook only).
 */
export function relaySuggestion(input, thresholds = DEFAULT_RELAY_THRESHOLDS) {
    const measures = relayMeasures(input);
    if (contextDue(measures, input.dismissed, thresholds)) {
        return { show: true, reason: 'context' };
    }
    if (ageDue(measures, input.dismissed, thresholds)) {
        return { show: true, reason: 'age' };
    }
    return { show: false, reason: null };
}
const HANDOFF_LINE = /^[\s>*_`"']*HANDOFF_FILE[*_`]*\s*:[*_`]*\s*(.*)$/;
const DRESSING = /^[\s`"'*]+|[\s`"'*]+$/g;
/**
 * The path the agent printed as `HANDOFF_FILE: <path>` — the LAST such line
 * of the reply (a line, not a mention mid-sentence). Markdown dressing
 * (backticks, bold, quotes) around the line or the path is dropped; spaces
 * inside the path are kept. Null when there is no usable line.
 */
export function parseHandoffFile(reply) {
    if (typeof reply !== 'string' || !reply) {
        return null;
    }
    const lines = reply.split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const match = HANDOFF_LINE.exec(lines[index]);
        if (!match) {
            continue;
        }
        const value = match[1].replace(DRESSING, '');
        if (value) {
            return value;
        }
    }
    return null;
}
/** Tag that marks one relay request; the reply to it is recognised by it. */
export function relayRequestTag(nonce) {
    return `эстафета ${nonce}`;
}
const RELAY_REQUEST_MARK = /Переносим работу в новый чат \(эстафета [^)\s]+\)/;
/** True when a user message is a relay request (manual or automatic). */
export function isRelayRequestText(text) {
    return typeof text === 'string' && RELAY_REQUEST_MARK.test(text);
}
const messageText = (message) => (typeof message.content === 'string' ? message.content : '');
/**
 * User-role text nobody typed: hook follow-ups, background-task notices and
 * the CLI's own «continue» nudge. It is not a person's message.
 */
const INJECTED_USER_TEXT = [
    /^Stop hook feedback:/i,
    /^This is an automatic follow-up from a session Stop hook/i,
    /^<task-notification>/,
    /^\[Your previous response had no visible output/i,
];
/** A message a person (not a hook or the CLI) wrote into the chat. */
export function isHumanUserMessage(message) {
    if (message.role !== 'user' || (message.kind && message.kind !== 'text')) {
        return false;
    }
    const text = messageText(message).trim();
    return Boolean(text) && !INJECTED_USER_TEXT.some((pattern) => pattern.test(text));
}
function requestIndexOf(messages, tag) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role === 'user' && messageText(message).includes(tag)) {
            return index;
        }
    }
    return -1;
}
/** True when a person wrote into the chat after the relay request with `tag`. */
export function hasHumanMessageAfterRequest(messages, tag) {
    const requestIndex = requestIndexOf(messages, tag);
    return requestIndex >= 0 && messages.slice(requestIndex + 1).some(isHumanUserMessage);
}
/**
 * The note path from the answer to one relay request: the last
 * `HANDOFF_FILE:` line among the assistant texts after the user message that
 * carries `tag`. It counts only when no other person's message stands between
 * the request and that answer — otherwise the line answers something else.
 * Null when the request is not in the transcript or no answer names a note.
 */
export function findHandoffAfterRequest(messages, tag) {
    const requestIndex = requestIndexOf(messages, tag);
    if (requestIndex < 0) {
        return null;
    }
    for (let index = messages.length - 1; index > requestIndex; index -= 1) {
        const message = messages[index];
        if (message.role !== 'assistant' || (message.kind && message.kind !== 'text')) {
            continue;
        }
        const found = parseHandoffFile(messageText(message));
        if (found) {
            return messages.slice(requestIndex + 1, index).some(isHumanUserMessage) ? null : found;
        }
    }
    return null;
}
/**
 * The plain-text request (no slash command — Claude, Codex and Grok all take
 * it the same way) sent to the current chat by «Перенести».
 */
export function buildRelayRequest(nonce, projectRoot) {
    const root = typeof projectRoot === 'string' && projectRoot.trim() ? projectRoot.trim().replace(/[\\/]+$/, '') : null;
    return [
        `Переносим работу в новый чат (${relayRequestTag(nonce)}).`,
        'Собери эстафету навыком handoff и запиши записку в файл docs/handoff/<дата>-<коротко-о-задаче>.md в корне этого проекта. Папку docs/handoff/ создай, если её нет, даже когда в проекте нет docs/ (запасной .handoff/ здесь не нужен). Не коммить и ни о чём не спрашивай.',
        ...(root ? [
            `Корень проекта: ${root}. Полный путь папки для записки: ${root}/docs/handoff/ — клади записку именно туда.`,
            'Папка уже создана: запиши записку инструментом Write, без команд терминала.',
        ] : []),
        'Последней строкой ответа выведи путь к записке в формате «HANDOFF_FILE: <путь>» — без кавычек и другого текста в этой строке.',
    ].join('\n');
}
/** First message of the continuation chat. */
export function buildRelayFirstMessage(handoffPath) {
    return `Прочитай ${handoffPath} и продолжай работу с того места`;
}
//# sourceMappingURL=relay-rules.js.map