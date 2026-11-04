import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyDrafts,
  buildSendItems,
  resultLabel,
  reviewRows,
  setAnswer,
  type MasterAnswers,
  type MasterQuestion,
} from './masterSessionModel';

// Экран мастер-сессии (истории 31–32): ответы по вопросам, черновики модели,
// проверка «чат → текст ответа», пачка на отправку и подписи итогов.

const ASK: MasterQuestion = {
  sessionId: 'ask',
  projectId: 'p1',
  projectName: 'Сайт',
  provider: 'claude',
  title: 'Цвета',
  reason: 'ask',
  updatedAt: 't1',
  question: 'Какой цвет?',
  excerpt: null,
  mode: 'choice',
  choices: [{ id: 'opt1', label: 'Синий' }, { id: 'opt2', label: 'Красный' }],
};
const TEXT: MasterQuestion = {
  ...ASK,
  sessionId: 'text',
  projectName: 'Бот',
  title: null,
  provider: 'codex',
  reason: 'manual_ask',
  updatedAt: 't2',
  question: 'Пришли ключ',
  mode: 'text',
  choices: [],
};

test('an answer remembers the question state it was written for', () => {
  let answers: MasterAnswers = {};
  answers = setAnswer(answers, ASK, { choice: 'opt2' });
  answers = setAnswer(answers, TEXT, { text: 'Ключ в файле' });
  // The list refreshed and the text question changed meanwhile.
  const refreshed = [ASK, { ...TEXT, updatedAt: 't3' }];
  assert.deepEqual(buildSendItems(refreshed, answers), [
    { sessionId: 'ask', expectedUpdatedAt: 't1', answer: { choice: 'opt2' } },
    { sessionId: 'text', expectedUpdatedAt: 't2', answer: { text: 'Ключ в файле' } },
  ]);
});

test('unanswered questions and blank texts are not sent; a typed text wins over a choice', () => {
  let answers: MasterAnswers = {};
  answers = setAnswer(answers, TEXT, { text: '   ' });
  answers = setAnswer(answers, ASK, { choice: 'opt1' });
  answers = setAnswer(answers, ASK, { text: 'Зелёный' });
  assert.deepEqual(buildSendItems([ASK, TEXT], answers), [
    { sessionId: 'ask', expectedUpdatedAt: 't1', answer: { text: 'Зелёный' } },
  ]);
});

test('drafts fill only untouched questions and stay editable', () => {
  let answers: MasterAnswers = setAnswer({}, TEXT, { text: 'Моё' });
  answers = applyDrafts(answers, [ASK, TEXT], [
    { sessionId: 'ask', text: '', choice: 'opt1', updatedAt: 't1' },
    { sessionId: 'text', text: 'Черновик', updatedAt: 't2' },
  ]);
  assert.deepEqual(answers.ask, { choice: 'opt1', text: '', preparedFor: 't1', fromDraft: true });
  assert.equal(answers.text.text, 'Моё');
  answers = setAnswer(answers, ASK, { text: 'Правка' });
  assert.equal(answers.ask.text, 'Правка');
  assert.equal(answers.ask.preparedFor, 't1');
});

test('a draft for a question that changed since is not applied', () => {
  const answers = applyDrafts({}, [{ ...ASK, updatedAt: 't9' }], [{ sessionId: 'ask', text: 'старое', updatedAt: 't1' }]);
  assert.deepEqual(answers, {});
});

test('review shows who gets what: project · chat → answer text or option label', () => {
  let answers: MasterAnswers = setAnswer({}, ASK, { choice: 'opt2' });
  answers = setAnswer(answers, TEXT, { text: 'Ключ в файле' });
  assert.deepEqual(reviewRows([ASK, TEXT], answers), [
    { sessionId: 'ask', target: 'Сайт · Цвета', answer: 'Красный', changed: false },
    { sessionId: 'text', target: 'Бот · без названия', answer: 'Ключ в файле', changed: false },
  ]);
  assert.equal(reviewRows([{ ...ASK, updatedAt: 't5' }], answers)[0].changed, true);
});

test('result captions', () => {
  assert.equal(resultLabel({ sessionId: 'a', status: 'sent' }), 'Отправлено');
  assert.equal(resultLabel({ sessionId: 'a', status: 'stale' }), 'Вопрос изменился — не отправлено');
  assert.equal(resultLabel({ sessionId: 'a', status: 'failed', reason: 'not_started' }), 'Не отправлено: в чате идёт работа или движок недоступен');
  assert.equal(resultLabel({ sessionId: 'a', status: 'failed', reason: 'forbidden' }), 'Не отправлено: нет доступа к этому чату');
  assert.equal(resultLabel({ sessionId: 'a', status: 'failed', reason: 'что-то новое' }), 'Не отправлено');
});
