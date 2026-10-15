import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildPrompt, echoesQuestion, filterSuggestions, } from '../../../modules/reply-suggestions/reply-suggestions.prompt.js';
import { classifyTurnEnding, finalParagraph } from '../../../shared/turn-ending.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const TURNS = JSON.parse(readFileSync(path.join(here, 'fixtures/real-turns.json'), 'utf8'));
const turn = (id) => TURNS.find((item) => item.id === id);
const questionOf = (id) => finalParagraph(turn(id).assistant);
test('every real ending of the set gets chips: the time stamp under the question no longer hides it', () => {
    assert.equal(TURNS.length, 15);
    for (const item of TURNS) {
        assert.notEqual(classifyTurnEnding(item.assistant).kind, 'none', item.id);
    }
});
test('a line ending with a question mark is dropped: Dima answers, he does not ask back', () => {
    // qwen3:8b on r06, r07 and r13 with the old prompt.
    assert.deepEqual(filterSuggestions({ suggestions: ['Да, запускай тесты.', 'Пока не надо', 'Закоммитить и запушить?'] }, questionOf('r06')), ['Да, запускай тесты', 'Пока не надо']);
    assert.deepEqual(filterSuggestions({ suggestions: ['Да, удаляй DNS-записи.', 'Нет, оставь на время.', 'Можно уточнить, почему?'] }, questionOf('r07')), ['Да, удаляй DNS-записи', 'Нет, оставь на время']);
    assert.deepEqual(filterSuggestions({ suggestions: ['Хорошо, проверю.', 'Можно уточнить, как это работает?'] }, questionOf('r13')), [], 'one line left is not a choice');
});
test('a line that restates the question is dropped, an answer with the same words is kept', () => {
    const deploy = 'Лендинг собран.\n\nВыкатить на прод сейчас или подождать до вечера?';
    assert.equal(echoesQuestion('Выкатить на прод сейчас', finalParagraph(deploy)), true);
    assert.equal(echoesQuestion('Закоммитить и запушить', questionOf('r06')), true);
    assert.equal(echoesQuestion('Заменить этот кадр на 1926 и выкатить', questionOf('r10')), true);
    // Answers that reuse the question's words: an opener or a changed form.
    assert.equal(echoesQuestion('Да, запускай проверку', questionOf('r03')), false);
    assert.equal(echoesQuestion('Без перерисовки', questionOf('r08')), false);
    assert.equal(echoesQuestion('Армянский, вход чини сейчас', questionOf('r11')), false);
    assert.equal(echoesQuestion('Выкатывай сейчас', finalParagraph(deploy)), false);
    assert.deepEqual(filterSuggestions({ suggestions: ['Выкатить на прод сейчас', 'Выкатывай сейчас', 'Давай вечером'] }, finalParagraph(deploy)), ['Выкатывай сейчас', 'Давай вечером']);
});
test('the chips the new prompt gave on the set pass the filter untouched', () => {
    // qwen3:8b, new prompt (see .autopilot/neo3-mods-wave2/shots/q2-chips-quality.md).
    const kept = [
        ['r02', ['Да, коммить и пушь', 'Пока не надо', 'Сначала покажи, что меняется']],
        ['r05', ['Сделал, смотри', 'Не получается — не грузится', 'Пришлю позже']],
        ['r08', ['Да, перерисовывай', 'Нет, без перерисовки', 'Сначала покажи пример']],
        ['r11', ['Армянский, вход чини сейчас', 'Европейский, позже', 'Армянский, код пришлю']],
        ['r14', ['Первое, срочно', 'Второе, позже', 'Оба, сразу']],
    ];
    for (const [id, lines] of kept) {
        assert.deepEqual(filterSuggestions({ suggestions: lines }, questionOf(id)), lines, id);
    }
});
test('quotes and a final period are trimmed, duplicates and non-strings dropped, at most three', () => {
    assert.deepEqual(filterSuggestions(['«Да, чисти.»', 'да, чисти', 42, '  ', 'Нет, не надо', 'Сначала проверь', 'Лишний'], questionOf('r13')), ['Да, чисти', 'Нет, не надо', 'Сначала проверь']);
    assert.deepEqual(filterSuggestions(null, questionOf('r13')), []);
});
test('the prompt names what Dima answers: the whole last paragraph, not a cut excerpt', () => {
    const question = questionOf('r15');
    // classifyTurnEnding's excerpt is cut at 200 chars and loses the 4th question.
    assert.ok(!classifyTurnEnding(turn('r15').assistant).excerpt.includes('Начинаю этап 1'));
    assert.ok(question.endsWith('Начинаю этап 1 сейчас, не дожидаясь ответа поддержки?'));
    const prompt = buildPrompt({ ...turn('r15'), question });
    const asked = prompt.split('На это отвечает Дима:\n')[1];
    assert.ok(asked.includes('Начинаю этап 1 сейчас'));
    assert.ok(asked.trimEnd().endsWith('Три ответа Димы — JSON.'));
    assert.ok(!asked.includes('МСК'), 'the time stamp is not part of the question');
});
//# sourceMappingURL=reply-suggestions.prompt.test.js.map