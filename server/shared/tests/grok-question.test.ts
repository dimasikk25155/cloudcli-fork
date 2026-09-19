import assert from 'node:assert/strict';
import test from 'node:test';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  fromGrokAskUserQuestionTool,
  isGrokAskUserQuestionTool,
  isGrokHeadlessQuestionStub,
  parseGrokNumberedQuestion,
  rewriteGrokHeadlessQuestionStub,
  resetGrokQuestionsForTests,
  serializeGrokQuestionAnswers,
  takeGrokQuestion,
  takeGrokQuestionsForAppSession,
  toAskUserQuestionInput,
  registerGrokQuestion,
  registerGrokPlanExit,
  takeGrokPlanExit,
  listGrokQuestionsForAppSession,
} from '@/shared/grok-question.js';

test.afterEach(() => {
  resetGrokQuestionsForTests();
});

test('parseGrokNumberedQuestion accepts a real fork with em-dashes', () => {
  const parsed = parseGrokNumberedQuestion([
    'На каком домене вешаем сайт?',
    '',
    '1 — клиентский домен',
    '2 — временный vercel.app',
  ].join('\n'));

  assert.deepEqual(parsed, {
    question: 'На каком домене вешаем сайт?',
    options: ['клиентский домен', 'временный vercel.app'],
  });
});

test('parseGrokNumberedQuestion accepts 1. / 2. lists and a closer line', () => {
  const parsed = parseGrokNumberedQuestion([
    'Какую тему ставим в кабинете?',
    '1. Тёмная',
    '2. Светлая',
    '3. Как у сайта',
    'Выбери вариант.',
  ].join('\n'));

  assert.equal(parsed?.options.length, 3);
  assert.equal(parsed?.options[2], 'Как у сайта');
  assert.match(parsed!.question, /тему/);
});

test('parseGrokNumberedQuestion ignores a report numbered list without a question', () => {
  const parsed = parseGrokNumberedQuestion([
    'Что сделал',
    '1. Stop-хук на Grok',
    '2. Картинки через prompt-json',
    '3. Кнопки из нумерованного вопроса',
  ].join('\n'));

  assert.equal(parsed, null);
});

test('parseGrokNumberedQuestion ignores options that are not the end of the turn', () => {
  const parsed = parseGrokNumberedQuestion([
    'Какой путь берём?',
    '1. Быстрый фикс',
    '2. Переписать модуль',
    '',
    'Дальше я ещё поправлю тесты и соберу клиент.',
    'Это уже не вопрос, это отчёт.',
  ].join('\n'));

  assert.equal(parsed, null);
});

test('parseGrokNumberedQuestion ignores a single option and overlong labels', () => {
  assert.equal(parseGrokNumberedQuestion('Что делаем?\n1. Только один вариант'), null);

  const long = 'x'.repeat(81);
  assert.equal(
    parseGrokNumberedQuestion(`Какой вариант?\n1. ${long}\n2. короткий`),
    null,
  );
});

test('isGrokAskUserQuestionTool accepts both live and Claude names', () => {
  assert.equal(isGrokAskUserQuestionTool('ask_user_question'), true);
  assert.equal(isGrokAskUserQuestionTool('AskUserQuestion'), true);
  assert.equal(isGrokAskUserQuestionTool('read_file'), false);
});

test('fromGrokAskUserQuestionTool maps the live tool payload onto the panel', () => {
  const input = fromGrokAskUserQuestionTool({
    questions: [{
      question: 'Is this a wiring test?',
      options: [
        { label: 'Yes', description: 'Yes' },
        { label: 'No', description: 'No' },
      ],
    }],
  });
  assert.deepEqual(input, {
    questions: [{
      question: 'Is this a wiring test?',
      options: [
        { label: 'Yes', description: 'Yes' },
        { label: 'No', description: 'No' },
      ],
    }],
  });

  const multi = fromGrokAskUserQuestionTool({
    questions: [{
      question: 'What to ship?',
      multi_select: true,
      options: ['A', 'B', 'C'],
    }],
  });
  assert.equal(multi?.questions[0].multiSelect, true);
  assert.deepEqual(multi?.questions[0].options.map((option) => option.label), ['A', 'B', 'C']);

  assert.equal(fromGrokAskUserQuestionTool({ questions: [{ question: 'Solo?', options: ['only'] }] }), null);
  assert.equal(fromGrokAskUserQuestionTool({}), null);
});

test('isGrokHeadlessQuestionStub catches the headless auto-answer', () => {
  assert.equal(
    isGrokHeadlessQuestionStub('No user is available to answer questions in this non-interactive session. Continue with your best judgment; do not wait for clarification.'),
    true,
  );
  assert.equal(isGrokHeadlessQuestionStub('2. тёмная тема'), false);
});

test('rewriteGrokHeadlessQuestionStub replaces the last stub in chat_history', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-askq-'));
  const cwd = '/tmp/project';
  const sessionUuid = '11111111-2222-3333-4444-555555555555';
  const historyDir = path.join(root, 'sessions', encodeURIComponent(cwd), sessionUuid);
  fs.mkdirSync(historyDir, { recursive: true });
  const historyPath = path.join(historyDir, 'chat_history.jsonl');
  fs.writeFileSync(historyPath, [
    JSON.stringify({ type: 'assistant', content: 'asking' }),
    JSON.stringify({
      type: 'tool_result',
      tool_call_id: 'call-1',
      content: 'No user is available to answer questions in this non-interactive session. Continue with your best judgment; do not wait for clarification.',
    }),
    JSON.stringify({ type: 'assistant', content: 'later' }),
  ].join('\n') + '\n');

  const previousHome = process.env.GROK_HOME;
  process.env.GROK_HOME = root;
  try {
    assert.equal(rewriteGrokHeadlessQuestionStub({
      workingDir: cwd,
      sessionUuid,
      answersText: '2. Проверка + чинить, если криво',
    }), true);
    const rewritten = fs.readFileSync(historyPath, 'utf8');
    assert.match(rewritten, /Проверка \+ чинить/);
    assert.doesNotMatch(rewritten, /No user is available/);
  } finally {
    if (previousHome === undefined) {
      delete process.env.GROK_HOME;
    } else {
      process.env.GROK_HOME = previousHome;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('toAskUserQuestionInput matches the panel shape', () => {
  const input = toAskUserQuestionInput({
    question: 'Какой цвет?',
    options: ['красный', 'синий'],
  });
  assert.deepEqual(input, {
    questions: [{
      question: 'Какой цвет?',
      header: 'Question',
      options: [{ label: 'красный' }, { label: 'синий' }],
    }],
  });
});

test('serializeGrokQuestionAnswers prefers N. label and Skip on empty', () => {
  const input = toAskUserQuestionInput({
    question: 'Какой цвет?',
    options: ['красный', 'синий'],
  });

  assert.equal(
    serializeGrokQuestionAnswers({ ...input, answers: { 'Какой цвет?': 'синий' } }),
    '2. синий',
  );
  assert.equal(serializeGrokQuestionAnswers({ ...input, answers: {} }), 'Skip');
  assert.equal(serializeGrokQuestionAnswers({ answers: { 'Какой цвет?': 'свой текст' } }, input), 'свой текст');
});

test('pending question registry is keyed by request and session', () => {
  const input = toAskUserQuestionInput({ question: 'A?', options: ['x', 'y'] });
  registerGrokQuestion({ requestId: 'r1', appSessionId: 's1', input });
  registerGrokQuestion({ requestId: 'r2', appSessionId: 's1', input });
  registerGrokQuestion({ requestId: 'r3', appSessionId: 's2', input });

  assert.equal(listGrokQuestionsForAppSession('s1').length, 2);
  assert.equal(takeGrokQuestion('r1')?.appSessionId, 's1');
  assert.equal(takeGrokQuestion('r1'), null);
  assert.equal(takeGrokQuestionsForAppSession('s1').length, 1);
  assert.equal(listGrokQuestionsForAppSession('s1').length, 0);
  assert.equal(listGrokQuestionsForAppSession('s2').length, 1);
});

test('plan-exit registry is one-shot and separate from questions', () => {
  registerGrokPlanExit({ requestId: 'p1', appSessionId: 's1', plan: 'do the thing' });
  assert.equal(takeGrokPlanExit('missing'), null);
  const taken = takeGrokPlanExit('p1');
  assert.equal(taken?.plan, 'do the thing');
  assert.equal(takeGrokPlanExit('p1'), null);
});
