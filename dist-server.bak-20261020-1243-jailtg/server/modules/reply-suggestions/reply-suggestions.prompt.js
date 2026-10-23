import { clipText } from '../../shared/turn-ending.js';
/**
 * What the local model is asked for reply chips, and what of its answer is
 * kept. Pure: no I/O, so the prompt and the filter are tested and measured on
 * real endings of Dima's sessions (tests/fixtures/real-turns.json,
 * tests/eval-live.ts).
 */
export const MIN_SUGGESTIONS = 2;
export const MAX_SUGGESTIONS = 3;
export const MAX_SUGGESTION_CHARS = 60;
const ASSISTANT_TAIL_CHARS = 1500;
const USER_MESSAGE_CHARS = 300;
const QUESTION_CHARS = 400;
/**
 * Small local models (qwen3:8b) answered the question back: «Закоммитить и
 * запушить?», «Проверю кнопки, найду сбои» — the agent's words, not Dima's.
 * The prompt fixes the roles and shows the expected shape on examples.
 */
export const SYSTEM_PROMPT = [
    'Ты пишешь за Диму готовые ответы ИИ-агенту. Дима — заказчик: он решает и командует. Агент — исполнитель.',
    'Агент закончил ход вопросом или просьбой. Дай 3 коротких ответа, которые Дима отправит одним нажатием.',
    'Правила:',
    '- Это ответ, а не вопрос: без «?» в конце, не пересказывай вопрос агента.',
    '- Говорит Дима: по-русски, на «ты», разговорно, 2–6 слов.',
    '- Варианты разные по смыслу: согласие, отказ, третий путь (позже, по-другому, сначала показать).',
    '- Вопрос «да или нет» → «Да, <делай>», «Нет, не надо», третий путь.',
    '- Выбор из вариантов → сами варианты коротко: «Давай первый», «Без перерисовки», «Оба».',
    '- Просьба к Диме (пришли, открой, проверь, нажми) → «Сделал», «Не получается — <почему>», «Пришлю позже».',
    '- Несколько вопросов → ответ на все сразу, если выходит коротко («Армянский, вход чини сейчас»), иначе на последний.',
    '- Действия агента — в повелительном наклонении: «Да, переделай», а не «Да, переделаю». Дима не обещает работу агента от своего имени.',
    '- Бери конкретику из этого вопроса (что именно делать), а не общие слова; примеры ниже не копируй.',
    'Примеры:',
    'Агент: «Выкатить на прод сейчас или подождать до вечера?» → {"suggestions":["Выкатывай сейчас","Давай вечером","Сначала покажи превью"]}',
    'Агент: «Пришли скрин того, что видишь на странице.» → {"suggestions":["Сделал, смотри","Не получается — не грузится","Пришлю позже"]}',
    'Агент: «Правки не закоммичены. Закоммитить и запушить?» → {"suggestions":["Да, коммить и пушь","Пока не надо","Сначала покажи, что меняется"]}',
    'Верни только JSON: {"suggestions": ["…", "…", "…"]}',
].join('\n');
export function buildPrompt(turn) {
    const assistantTail = turn.assistant.length > ASSISTANT_TAIL_CHARS
        ? `…${turn.assistant.slice(-ASSISTANT_TAIL_CHARS)}`
        : turn.assistant;
    const user = turn.user.slice(0, USER_MESSAGE_CHARS);
    return [
        user ? `Дима писал до этого:\n${user}` : '',
        `Конец ответа агента:\n${assistantTail}`,
        `На это отвечает Дима:\n${turn.question.length > QUESTION_CHARS ? `…${turn.question.slice(-QUESTION_CHARS)}` : turn.question}`,
        'Три ответа Димы — JSON.',
    ].filter(Boolean).join('\n\n');
}
/**
 * Lowercase words that carry meaning. Whole words, not stems: an answer
 * changes the form («чини», «удаляй»), a restatement copies it («чинить»).
 */
function words(text) {
    return (text.toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}]+/gu) ?? [])
        .filter((word) => word.length >= 3);
}
/**
 * Words that make a line an answer even when the rest repeats the question:
 * «Да, запускай проверку» shares every content word with «Запускать
 * проверку?», and still is the answer.
 */
const ANSWER_OPENER = /^(?:да|нет|не|ок|окей|давай|конечно|лучше|сделал|сделала|согласен|пока|сначала|потом|оба|оставь|без)(?![\p{L}])/iu;
/**
 * How much a line repeats one sentence of the question: `copied` — share of
 * the line's words taken from that sentence, `covered` — share of the
 * sentence the line repeats. The sentence repeated the most wins.
 */
export function overlapWithQuestion(line, question) {
    const own = new Set(words(line));
    let best = { copied: 0, covered: 0 };
    if (own.size === 0) {
        return best;
    }
    for (const sentence of question.split(/\n+|(?<=[.!?…])\s+/u)) {
        const asked = new Set(words(sentence));
        if (asked.size === 0) {
            continue;
        }
        const shared = [...own].filter((word) => asked.has(word)).length;
        const candidate = { copied: shared / own.size, covered: shared / asked.size };
        if (candidate.copied + candidate.covered > best.copied + best.covered) {
            best = candidate;
        }
    }
    return best;
}
/**
 * The line restates the agent's question instead of answering it: almost all
 * of its words come from one question sentence and it repeats at least half
 * of that sentence («Выкатить на прод сейчас» for «Выкатить на прод сейчас
 * или подождать до вечера?»). A plain answer («Да, …», «Без …») never is.
 */
export function echoesQuestion(line, question) {
    if (ANSWER_OPENER.test(line) || words(line).length < 2) {
        return false;
    }
    const { copied, covered } = overlapWithQuestion(line, question);
    return copied >= 0.8 && covered >= 0.5;
}
/**
 * Model output → 2–3 distinct answers of ≤60 chars, or none at all. Dropped:
 * non-strings, blanks, duplicates, questions (a trailing «?») and lines that
 * repeat the agent's question.
 */
export function filterSuggestions(raw, question) {
    const list = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object' && Array.isArray(raw.suggestions)
            ? raw.suggestions
            : [];
    const seen = new Set();
    const result = [];
    for (const item of list) {
        if (typeof item !== 'string') {
            continue;
        }
        const unquoted = item.trim().replace(/^["«'„“]+|["»'“”]+$/g, '').trim();
        if (!unquoted || /\?\s*$/.test(unquoted) || echoesQuestion(unquoted, question)) {
            continue;
        }
        const line = clipText(unquoted.replace(/\.\s*$/, ''), MAX_SUGGESTION_CHARS);
        const key = line.toLowerCase();
        if (!line || seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(line);
        if (result.length === MAX_SUGGESTIONS) {
            break;
        }
    }
    // Decision 17: 2–3 chips. One lonely chip reads as a button, not a choice.
    return result.length >= MIN_SUGGESTIONS ? result : [];
}
//# sourceMappingURL=reply-suggestions.prompt.js.map