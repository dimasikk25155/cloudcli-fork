/**
 * Classifies how an agent turn ended, from the final assistant text alone.
 *
 * Used by the session-attention module to tell "the agent is waiting for you"
 * apart from "the agent finished": a turn that ends with a direct question or
 * with a request to do something by hand ("открой…и пришли", "нажми
 * Обновить") leaves the session waiting even though no question panel is up.
 *
 * Regular expressions rather than a model: the status must be instant and must
 * not depend on the Windows box being reachable.
 */

export type TurnEndingKind = 'question' | 'manual_ask' | 'none';

export type TurnEnding = {
  kind: TurnEndingKind;
  /** Last paragraph of the reply (whitespace collapsed, ≤200 chars); '' for `none`. */
  excerpt: string;
};

const EXCERPT_MAX = 200;

/**
 * Russian imperative verbs addressed to the user (singular and polite plural).
 * Past-tense reports ("открыл", "сделал") and first-person plans ("открою")
 * never match these stems because the whole word is compared.
 */
const RU_IMPERATIVES = [
  'открой', 'нажми', 'пришли', 'скопируй', 'сделай', 'проверь', 'отправь', 'скинь',
  'вставь', 'запусти', 'зайди', 'перезагрузи', 'перезапусти', 'обнови', 'введи',
  'выполни', 'подтверди', 'установи', 'скачай', 'загрузи', 'кликни', 'тапни', 'смахни',
  'разреши', 'залогинься', 'авторизуйся',
];

const RU_IMPERATIVE_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${RU_IMPERATIVES.join('|')})(?:те)?(?![\\p{L}\\p{N}])`,
  'iu',
);

/** English requests: either "please <verb>" anywhere or a bare imperative opening the sentence. */
const EN_VERBS = 'open|click|press|tap|send|copy|paste|run|check|restart|reload|refresh|install|download|log in|sign in|confirm';
const EN_PLEASE_PATTERN = new RegExp(`\\bplease\\s+(?:${EN_VERBS})\\b`, 'i');
const EN_LEADING_IMPERATIVE_PATTERN = new RegExp(`^(?:now\\s+|then\\s+|next,?\\s+)?(?:${EN_VERBS})\\b`, 'i');

/** Conditional offers ("Если хочешь, могу…", "If you want…") are not requests. */
const CONDITIONAL_SENTENCE_PATTERN = /^(?:если|if)(?![\p{L}])/iu;

/** A question mark that ends a clause — not the one inside a URL query (`/?ref=`). */
const QUESTION_MARK_PATTERN = /\?(?=$|[\s"'»)\]*_.!…])/u;

function stripCodeBlocks(text: string): string {
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, '\n\n')
    .replace(/`[^`\n]*`/g, ' ');
}

function lastParagraph(text: string): string {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  return paragraphs.length > 0 ? paragraphs[paragraphs.length - 1] : '';
}

/** Sentences and list items of one paragraph, each trimmed of list markers. */
function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(/\n+|(?<=[.!?…])\s+/u)
    .map((sentence) => sentence.replace(/^\s*(?:[-*•]|\d+[.)])\s*/u, '').trim())
    .filter((sentence) => sentence.length > 0);
}

function isManualAsk(sentence: string): boolean {
  if (CONDITIONAL_SENTENCE_PATTERN.test(sentence)) {
    return false;
  }
  return (
    RU_IMPERATIVE_PATTERN.test(sentence)
    || EN_PLEASE_PATTERN.test(sentence)
    || EN_LEADING_IMPERATIVE_PATTERN.test(sentence)
  );
}

/**
 * Collapses whitespace and cuts the text to at most `max` characters
 * (ellipsis included). Shared with session-attention for every short text it
 * stores (errors, questions, plan excerpts).
 */
export function clipText(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

/**
 * Pure classifier: looks only at the last paragraph of the reply (code blocks
 * removed). A request to act by hand wins over a question in the same
 * paragraph — the user has to do something either way, and the request is
 * the more specific signal.
 */
export function classifyTurnEnding(text: string): TurnEnding {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { kind: 'none', excerpt: '' };
  }

  const paragraph = lastParagraph(stripCodeBlocks(text));
  if (!paragraph) {
    return { kind: 'none', excerpt: '' };
  }

  const sentences = splitSentences(paragraph);
  if (sentences.some(isManualAsk)) {
    return { kind: 'manual_ask', excerpt: clipText(paragraph, EXCERPT_MAX) };
  }

  if (QUESTION_MARK_PATTERN.test(paragraph)) {
    return { kind: 'question', excerpt: clipText(paragraph, EXCERPT_MAX) };
  }

  return { kind: 'none', excerpt: '' };
}
