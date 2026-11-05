import assert from 'node:assert/strict';
import test from 'node:test';

import { parseVerdict, VERDICT_INSTRUCTION } from '../../../shared/queue-verdict.js';

test('«ВЕРДИКТ: OK» on the last line → ok', () => {
  assert.deepEqual(parseVerdict('Карточка готова, размер сверен.\n\nВЕРДИКТ: OK'), { verdict: 'ok', reason: '' });
  assert.deepEqual(parseVerdict('Готово\nВЕРДИКТ: OK\n\n'), { verdict: 'ok', reason: '' });
});

test('FAIL with a reason after «—», «-» or «:»', () => {
  assert.deepEqual(parseVerdict('…\nВЕРДИКТ: FAIL — размер на этикетке 205/60, а не 205/55'), {
    verdict: 'fail',
    reason: 'размер на этикетке 205/60, а не 205/55',
  });
  assert.deepEqual(parseVerdict('ВЕРДИКТ: FAIL - нет фото'), { verdict: 'fail', reason: 'нет фото' });
  assert.deepEqual(parseVerdict('ВЕРДИКТ: FAIL: этикетка нечитаема'), { verdict: 'fail', reason: 'этикетка нечитаема' });
});

test('case does not matter, the Latin VERDICT works too, markdown around the line is ignored', () => {
  assert.equal(parseVerdict('вердикт: ok').verdict, 'ok');
  assert.deepEqual(parseVerdict('VERDICT: FAIL — wrong size'), { verdict: 'fail', reason: 'wrong size' });
  assert.equal(parseVerdict('**ВЕРДИКТ: OK**').verdict, 'ok');
});

test('no verdict line → fail «нет вердикта»', () => {
  assert.deepEqual(parseVerdict('Сделал всё, что мог.'), { verdict: 'fail', reason: 'нет вердикта' });
  assert.deepEqual(parseVerdict(''), { verdict: 'fail', reason: 'нет вердикта' });
  assert.deepEqual(parseVerdict('Вердикт вынесу позже'), { verdict: 'fail', reason: 'нет вердикта' });
});

test('the last verdict line decides', () => {
  assert.equal(parseVerdict('ВЕРДИКТ: FAIL — первая попытка\nпеределал\nВЕРДИКТ: OK').verdict, 'ok');
});

test('the instruction names both verdict lines', () => {
  assert.match(VERDICT_INSTRUCTION, /ВЕРДИКТ: OK/);
  assert.match(VERDICT_INSTRUCTION, /ВЕРДИКТ: FAIL — причина/);
});
