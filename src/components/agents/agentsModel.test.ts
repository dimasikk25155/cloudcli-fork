import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canStartChat,
  effortChoices,
  emptyForm,
  fieldOfErrorCode,
  filesFromText,
  formFromAgent,
  historyLine,
  modelChoices,
  roleSummary,
  ruleOrigin,
  toPayload,
  validateForm,
  versionLabel,
  type AgentItem,
} from './agentsModel';

const catalog = {
  DEFAULT: 'opus[1m]',
  OPTIONS: [
    { value: 'opus[1m]', label: 'Opus', effort: { default: 'high', values: [{ value: 'low' }, { value: 'high' }] } },
    { value: 'sonnet[1m]', label: 'Sonnet' },
    { value: 'claude-haiku-4', label: 'Haiku' },
    { value: 'fable', label: 'Fable', hidden: true },
  ],
};

const agent: AgentItem = {
  id: 'a1', name: 'Художник', role: 'Перерисовываешь карточки.\nВторая строка', checks: 'Сверь размер',
  provider: 'grok', model: 'grok-4.7', effort: null, projectPath: '/p/tyres',
  files: ['/p/tyres/docs/style.md', '/p/tyres/labels.md'], rulesVersion: 2, createdAt: '', updatedAt: '',
};

describe('панель «Агенты»: модель', () => {
  it('модели берутся только из политики выбора: чужие и скрытые не предлагаются', () => {
    assert.deepEqual(modelChoices('claude', catalog).map((item) => item.value), ['opus[1m]', 'sonnet[1m]']);
  });

  it('нет каталога — одна модель по умолчанию из политики', () => {
    assert.deepEqual(modelChoices('grok', null).map((item) => item.value), ['grok-4.7']);
    assert.deepEqual(modelChoices('codex', undefined).map((item) => item.value), ['gpt-6-sol']);
  });

  it('effort — уровни выбранной модели; у модели без уровней список пуст', () => {
    assert.deepEqual(effortChoices('claude', 'opus[1m]', catalog), ['low', 'high']);
    assert.deepEqual(effortChoices('claude', 'sonnet[1m]', catalog), []);
    assert.deepEqual(effortChoices('claude', 'opus[1m]', null), []);
  });

  it('файлы-знания: по строке, пустые и повторы выкидываются', () => {
    assert.deepEqual(filesFromText(' docs/a.md \n\n docs/a.md\nb.md  \n'), ['docs/a.md', 'b.md']);
  });

  it('форма агента: туда и обратно, пустой effort уходит как null', () => {
    const form = formFromAgent(agent);
    assert.equal(form.filesText, '/p/tyres/docs/style.md\n/p/tyres/labels.md');
    assert.deepEqual(toPayload(form), {
      name: 'Художник', role: agent.role, checks: 'Сверь размер', provider: 'grok', model: 'grok-4.7',
      effort: null, projectPath: '/p/tyres', files: agent.files,
    });
  });

  it('новая форма: движок по умолчанию claude с моделью из политики, папка — первая из проектов', () => {
    const form = emptyForm('/p/first');
    assert.equal(form.provider, 'claude');
    assert.equal(form.model, 'opus[1m]');
    assert.equal(form.projectPath, '/p/first');
  });

  it('проверка формы: имя, роль, папка и длина — по-русски, у своего поля', () => {
    const errors = validateForm({ ...emptyForm(''), name: ' ', role: '' });
    assert.match(errors.name ?? '', /имя/i);
    assert.match(errors.role ?? '', /роль/i);
    assert.match(errors.projectPath ?? '', /папк/i);
    assert.equal(validateForm({ ...emptyForm('/p'), name: 'х'.repeat(41), role: 'р' }).name?.includes('40'), true);
    assert.equal(validateForm({ ...emptyForm('/p'), name: 'Критик', role: 'р', checks: 'ч'.repeat(2001) }).checks?.includes('2000'), true);
    assert.deepEqual(validateForm({ ...emptyForm('/p'), name: 'Критик', role: 'р' }), {});
  });

  it('код ошибки сервера → поле формы', () => {
    assert.equal(fieldOfErrorCode('AGENT_NAME_TAKEN'), 'name');
    assert.equal(fieldOfErrorCode('FILE_OUTSIDE_PROJECT'), 'files');
    assert.equal(fieldOfErrorCode('MODEL_NOT_ALLOWED'), 'model');
    assert.equal(fieldOfErrorCode('PROJECT_NOT_FOUND'), 'projectPath');
    assert.equal(fieldOfErrorCode('RUN_NOT_STARTED'), null);
    assert.equal(fieldOfErrorCode(undefined), null);
  });

  it('память: версия, автор правила и строки истории', () => {
    assert.equal(versionLabel(0), 'пусто');
    assert.equal(versionLabel(3), 'V3');
    assert.equal(ruleOrigin('agent'), 'добавил агент');
    assert.equal(ruleOrigin('user'), 'добавил ты');
    assert.equal(historyLine({ version: 2, added: 'до 4 переделок', by: 'agent' }), 'V2 · добавлено (агентом): до 4 переделок');
    assert.equal(historyLine({ version: 3, removed: 'не писать CDEK' }), 'V3 · убрано: не писать CDEK');
    assert.equal(historyLine({ version: 1, added: 'раз', by: 'user' }), 'V1 · добавлено: раз');
  });

  it('«Новый чат» только с непустой задачей; в списке — первая строка роли', () => {
    assert.equal(canStartChat('  '), false);
    assert.equal(canStartChat('Перерисуй карточку 205/55'), true);
    assert.equal(roleSummary(agent.role), 'Перерисовываешь карточки.');
    assert.equal(roleSummary('x'.repeat(200)).length, 100);
  });
});
