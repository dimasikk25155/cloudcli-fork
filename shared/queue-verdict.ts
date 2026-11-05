/**
 * «ВЕРДИКТ»: the self-check line every queue answer ends with
 * (`ВЕРДИКТ: OK` or `ВЕРДИКТ: FAIL — причина`). No line = FAIL «нет вердикта»;
 * FAIL with an empty reason = «причина не указана» — брак always says why.
 * No database here.
 */

export type QueueVerdict = { verdict: 'ok' | 'fail'; reason: string };

/** Appended to every queue task. */
export const VERDICT_INSTRUCTION = '\n\nПеред ответом проверь результат. Последней строкой ответа напиши ровно '
  + '«ВЕРДИКТ: OK», если всё сделано и проверено, или «ВЕРДИКТ: FAIL — причина», если нет.';

const NO_VERDICT = 'нет вердикта';
/** Reason of a FAIL the agent left empty. */
export const NO_FAIL_REASON = 'причина не указана';

// «ВЕРДИКТ: FAIL — причина»; VERDICT in Latin, OK in Cyrillic, «-», «–», «—» or «:» before the reason.
const VERDICT_LINE = /^(?:ВЕРДИКТ|VERDICT)\s*[:：]?\s*(OK|ОК|FAIL)(?![\p{L}\p{N}])\s*(?:[—–\-:]\s*)?(.*)$/iu;

/** Markdown a model likes to wrap the line in: `**…**`, `> …`, backticks. */
function bare(line: string): string {
  return line.trim().replace(/^[>*_`\s]+/, '').replace(/[*_`\s]+$/, '');
}

/** The last verdict line of the answer decides. */
export function parseVerdict(text: string): QueueVerdict {
  const lines = String(text ?? '').split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = VERDICT_LINE.exec(bare(lines[index]));
    if (!match) continue;
    const verdict = match[1].toUpperCase() === 'FAIL' ? 'fail' : 'ok';
    const reason = bare(match[2] ?? '');
    return { verdict, reason: verdict === 'fail' && !reason ? NO_FAIL_REASON : reason };
  }
  return { verdict: 'fail', reason: NO_VERDICT };
}
