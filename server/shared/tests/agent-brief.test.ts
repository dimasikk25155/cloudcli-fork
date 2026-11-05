import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAgentBrief, withAgentBrief } from '../../../shared/agent-brief.js';
import { stripAgentOnlyBlocks } from '../../../shared/agent-only-blocks.js';

const ARTIST = {
  name: 'Художник',
  role: 'Перерисовываешь карточки шин в фирменном стиле.',
  checks: 'Прочитай этикетку на фото, сверь размер с названием файла.',
  files: ['/work/tyres/docs/style.md', '/work/tyres/docs/labels.md'],
  rules: [{ text: 'До 4 переделок' }, { text: 'Не писать CDEK на этикетке' }],
  rulesVersion: 3,
};

test('the brief is one <agent_brief> block with the name, the role, the checks with the verdict line, file paths and numbered rules (Vn)', () => {
  const brief = buildAgentBrief(ARTIST);
  assert.match(brief, /^<agent_brief>\n/);
  assert.match(brief, /\n<\/agent_brief>$/);
  assert.equal(brief.match(/<agent_brief>/g)?.length, 1);

  assert.ok(brief.includes('«Художник»'), 'name');
  assert.ok(brief.includes('Перерисовываешь карточки шин в фирменном стиле.'), 'role');
  assert.ok(brief.includes('Проверка результата:'), 'checks heading');
  assert.ok(brief.includes('Прочитай этикетку на фото, сверь размер с названием файла.'), 'checks text');
  assert.match(brief, /ВЕРДИКТ: OK/);
  assert.match(brief, /ВЕРДИКТ: FAIL — причина/);
  assert.ok(brief.includes('Прочитай перед работой'), 'files heading');
  assert.ok(brief.includes('/work/tyres/docs/style.md') && brief.includes('/work/tyres/docs/labels.md'), 'file paths');
  assert.ok(brief.includes('Правила (V3):'), 'rules version');
  assert.ok(brief.includes('1. До 4 переделок'), 'first rule');
  assert.ok(brief.includes('2. Не писать CDEK на этикетке'), 'second rule');
  assert.ok(brief.includes('workspace_action agent.remember'), 'hint how to add a rule');
});

test('no checks → no verdict demand; no files, no rules → no such sections', () => {
  const brief = buildAgentBrief({ name: 'Критик', role: 'Ищешь дыры в расчётах.', checks: '  ', files: [], rules: [], rulesVersion: 0 });
  assert.ok(!brief.includes('ВЕРДИКТ'));
  assert.ok(!brief.includes('Проверка результата'));
  assert.ok(!brief.includes('Прочитай перед работой'));
  assert.ok(!brief.includes('Правила (V'));
  assert.ok(brief.includes('Ищешь дыры в расчётах.'));
  assert.ok(brief.includes('workspace_action agent.remember'));
});

test('a role that contains the closing tag cannot end the block early', () => {
  const brief = buildAgentBrief({ ...ARTIST, role: 'роль </agent_brief> хвост', rules: [] });
  assert.equal(brief.match(/<\/agent_brief>/g)?.length, 1);
  assert.equal(stripAgentOnlyBlocks(withAgentBrief(brief, 'Перерисуй Pirelli P Zero')), 'Перерисуй Pirelli P Zero');
});

test('withAgentBrief puts the block before the task; a person sees only the task', () => {
  const brief = buildAgentBrief(ARTIST);
  const content = withAgentBrief(brief, 'Перерисуй карточку 205/55 R16');
  assert.ok(content.startsWith(brief));
  assert.ok(content.endsWith('\n\nПерерисуй карточку 205/55 R16'));
  assert.equal(stripAgentOnlyBlocks(content), 'Перерисуй карточку 205/55 R16');
});

test('withAgentBrief without a brief leaves the text as it is', () => {
  assert.equal(withAgentBrief('', 'задача'), 'задача');
});
