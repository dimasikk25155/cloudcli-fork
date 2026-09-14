/**
 * Grok's native `ask_user_question` exists in the live toolset (CLI 1.0.5),
 * but headless `-p` auto-answers it with "No user is available… continue with
 * your best judgment". Neo3 intercepts the tool_use, draws the same
 * AskUserQuestion panel Claude uses, kills the turn so the model cannot
 * keep going, and turns a click into the next `--resume` user message.
 *
 * The auto-answer is already on disk by the time we kill the process. A click
 * rewrites that stub in chat_history.jsonl so the resumed model sees the
 * real answers instead of "no user, decide yourself".
 *
 * Numbered-text parsing stays as a fallback for when the model still writes
 * options in chat. Conservative on purpose: a false panel on a report list
 * is worse than missing a real question. The user can still type "2".
 */

import fs from 'node:fs';
import path from 'node:path';

import { getGrokHome } from '@/shared/utils.js';

export type GrokQuestionOption = {
  label: string;
  description?: string;
};

export type GrokQuestion = {
  question: string;
  header?: string;
  options: GrokQuestionOption[];
  multiSelect?: boolean;
};

export type GrokQuestionInput = {
  questions: GrokQuestion[];
};

export type GrokPendingQuestion = {
  requestId: string;
  appSessionId: string;
  input: GrokQuestionInput;
  providerSessionId?: string;
  resumeOptions?: Record<string, unknown>;
};

const HEADLESS_QUESTION_STUB =
  /No user is available to answer questions in this non-interactive session/i;

export function isGrokHeadlessQuestionStub(content: unknown): boolean {
  if (typeof content === 'string') {
    return HEADLESS_QUESTION_STUB.test(content);
  }
  try {
    return HEADLESS_QUESTION_STUB.test(JSON.stringify(content ?? ''));
  } catch {
    return false;
  }
}

function grokChatHistoryPath(workingDir: string, sessionUuid: string): string {
  return path.join(
    getGrokHome(),
    'sessions',
    encodeURIComponent(workingDir),
    sessionUuid,
    'chat_history.jsonl',
  );
}

/**
 * Replace the last headless "no user" ask_user_question stub with the real
 * answers so `--resume` does not tell the model to decide by itself.
 * Returns true when a stub line was rewritten.
 */
export function rewriteGrokHeadlessQuestionStub(options: {
  workingDir?: unknown;
  sessionUuid?: unknown;
  answersText: string;
}): boolean {
  const workingDir = typeof options.workingDir === 'string' ? options.workingDir.trim() : '';
  const sessionUuid = typeof options.sessionUuid === 'string' ? options.sessionUuid.trim() : '';
  const answersText = String(options.answersText || '').trim() || 'Skip';
  if (!workingDir || !sessionUuid) {
    return false;
  }

  const historyPath = grokChatHistoryPath(workingDir, sessionUuid);
  let raw: string;
  try {
    raw = fs.readFileSync(historyPath, 'utf8');
  } catch {
    return false;
  }
  if (!raw.includes('No user is available to answer questions')) {
    return false;
  }

  const lines = raw.split('\n');
  let rewritten = false;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.trim() || !HEADLESS_QUESTION_STUB.test(line)) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!replaceHeadlessQuestionStub(parsed, answersText)) {
      continue;
    }
    lines[index] = JSON.stringify(parsed);
    rewritten = true;
    break;
  }

  if (!rewritten) {
    return false;
  }

  try {
    fs.writeFileSync(historyPath, lines.join('\n'));
    return true;
  } catch {
    return false;
  }
}

function replaceHeadlessQuestionStub(value: unknown, answersText: string): boolean {
  if (typeof value === 'string') {
    return false;
  }
  if (Array.isArray(value)) {
    let changed = false;
    for (let index = 0; index < value.length; index += 1) {
      const entry = value[index];
      if (typeof entry === 'string' && HEADLESS_QUESTION_STUB.test(entry)) {
        value[index] = answersText;
        changed = true;
      } else if (replaceHeadlessQuestionStub(entry, answersText)) {
        changed = true;
      }
    }
    return changed;
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  let changed = false;
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === 'string' && HEADLESS_QUESTION_STUB.test(entry)) {
      record[key] = answersText;
      changed = true;
    } else if (replaceHeadlessQuestionStub(entry, answersText)) {
      changed = true;
    }
  }
  return changed;
}

const MAX_LABEL_CHARS = 80;
const MAX_OPTIONS = 8;
const MIN_OPTIONS = 2;
const MAX_QUESTION_CHARS = 240;
const MAX_CLOSER_CHARS = 80;

const OPTION_LINE_PATTERN = /^\s*(\d{1,2})(?:[.)]|[ \t]*[—–-])\s+(\S.*?)\s*$/;

const QUESTION_SIGNAL_PATTERN = /[?？]|выбер[еиу]|выбор\b|какой\b|какую\b|какие\b|какое\b|что (ставим|делаем|выберешь|выбираем)|which\b|choose\b|\bpick\b|or should/i;

const pendingGrokQuestions = new Map<string, GrokPendingQuestion>();

function parseOptionLine(line: string): { n: number; label: string } | null {
  const match = OPTION_LINE_PATTERN.exec(line);
  if (!match) {
    return null;
  }
  const label = match[2].trim();
  if (!label || label.length > MAX_LABEL_CHARS) {
    return null;
  }
  return { n: Number(match[1]), label };
}

function isConsecutiveFromOne(items: Array<{ n: number }>): boolean {
  return items.every((item, index) => item.n === index + 1);
}

function lastNonEmptyParagraph(text: string): string {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  return blocks.length > 0 ? blocks[blocks.length - 1] : '';
}

/**
 * Returns a question+options payload when the last assistant bubble is a real
 * fork, or null when the numbered lines look like a report / todo list.
 */
export function parseGrokNumberedQuestion(text: string): { question: string; options: string[] } | null {
  if (typeof text !== 'string' || !text.trim()) {
    return null;
  }

  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const parsedLines = lines.map((line, index) => ({ index, option: parseOptionLine(line) }));

  const runs: Array<Array<{ index: number; n: number; label: string }>> = [];
  let current: Array<{ index: number; n: number; label: string }> = [];
  for (const row of parsedLines) {
    if (!row.option) {
      if (current.length > 0) {
        runs.push(current);
        current = [];
      }
      continue;
    }
    current.push({ index: row.index, n: row.option.n, label: row.option.label });
  }
  if (current.length > 0) {
    runs.push(current);
  }

  const run = [...runs].reverse().find(
    (candidate) => (
      candidate.length >= MIN_OPTIONS
      && candidate.length <= MAX_OPTIONS
      && isConsecutiveFromOne(candidate)
    ),
  );
  if (!run) {
    return null;
  }

  const lastOptionIndex = run[run.length - 1].index;
  const trailing = lines.slice(lastOptionIndex + 1).map((line) => line.trim()).filter(Boolean);
  if (trailing.length > 1) {
    return null;
  }
  const closer = trailing[0] || '';
  if (closer && (closer.length > MAX_CLOSER_CHARS || parseOptionLine(closer))) {
    return null;
  }

  const prefix = lines.slice(0, run[0].index).join('\n').trim();
  const signalSource = `${prefix}\n${closer}`;
  if (!QUESTION_SIGNAL_PATTERN.test(signalSource)) {
    return null;
  }

  let question = lastNonEmptyParagraph(prefix) || closer || 'Выбери вариант';
  if (question.length > MAX_QUESTION_CHARS) {
    question = `${question.slice(0, MAX_QUESTION_CHARS).trim()}…`;
  }

  return {
    question,
    options: run.map((item) => item.label),
  };
}

export function isGrokAskUserQuestionTool(name: unknown): boolean {
  const value = String(name || '').trim();
  return value === 'ask_user_question' || value === 'AskUserQuestion';
}

/**
 * Native grok `ask_user_question` input → the panel shape AskUserQuestionPanel
 * already renders (label / description / multiSelect).
 */
export function fromGrokAskUserQuestionTool(raw: unknown): GrokQuestionInput | null {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const source = Array.isArray(record.questions) ? record.questions : [];
  const questions: GrokQuestion[] = [];

  for (const entry of source) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const item = entry as Record<string, unknown>;
    const question = typeof item.question === 'string' ? item.question.trim() : '';
    const optionsRaw = Array.isArray(item.options) ? item.options : [];
    const options: GrokQuestionOption[] = [];
    for (const option of optionsRaw) {
      if (typeof option === 'string' && option.trim()) {
        options.push({ label: option.trim().slice(0, MAX_LABEL_CHARS) });
        continue;
      }
      if (!option || typeof option !== 'object') {
        continue;
      }
      const optionRecord = option as Record<string, unknown>;
      const label = typeof optionRecord.label === 'string' ? optionRecord.label.trim() : '';
      if (!label) {
        continue;
      }
      const mapped: GrokQuestionOption = { label: label.slice(0, MAX_LABEL_CHARS) };
      if (typeof optionRecord.description === 'string' && optionRecord.description.trim()) {
        mapped.description = optionRecord.description.trim();
      }
      options.push(mapped);
    }
    if (!question || options.length < MIN_OPTIONS) {
      continue;
    }
    const mappedQuestion: GrokQuestion = {
      question: question.length > MAX_QUESTION_CHARS
        ? `${question.slice(0, MAX_QUESTION_CHARS).trim()}…`
        : question,
      options: options.slice(0, MAX_OPTIONS),
    };
    if (typeof item.header === 'string' && item.header.trim()) {
      mappedQuestion.header = item.header.trim();
    }
    if (item.multiSelect === true || item.multi_select === true) {
      mappedQuestion.multiSelect = true;
    }
    questions.push(mappedQuestion);
  }

  return questions.length > 0 ? { questions } : null;
}

export function toAskUserQuestionInput(parsed: { question: string; options: string[] }): GrokQuestionInput {
  return {
    questions: [{
      question: parsed.question,
      header: 'Question',
      options: parsed.options.map((label) => ({ label })),
    }],
  };
}

/**
 * Panel click → the next user turn. Prefers "N. label" when the label matches
 * an option so typing "2" and clicking "2" land on the same text.
 */
export function serializeGrokQuestionAnswers(
  updatedInput: unknown,
  fallbackInput?: GrokQuestionInput,
): string {
  const record = updatedInput && typeof updatedInput === 'object'
    ? updatedInput as Record<string, unknown>
    : {};
  const answers = record.answers && typeof record.answers === 'object' && !Array.isArray(record.answers)
    ? record.answers as Record<string, unknown>
    : {};
  const questions = Array.isArray(record.questions)
    ? record.questions
    : (fallbackInput?.questions ?? []);

  const lines: string[] = [];
  for (const [asked, raw] of Object.entries(answers)) {
    if (typeof raw !== 'string' || !raw.trim()) {
      continue;
    }
    const question = questions.find((entry) => (
      entry && typeof entry === 'object' && (entry as GrokQuestion).question === asked
    )) as GrokQuestion | undefined;
    const labels = raw.split(',').map((part) => part.trim()).filter(Boolean);
    const rendered = labels.map((label) => {
      const index = question?.options?.findIndex((option) => option.label === label) ?? -1;
      return index >= 0 ? `${index + 1}. ${label}` : label;
    });
    lines.push(rendered.join(', '));
  }

  return lines.length > 0 ? lines.join('\n') : 'Skip';
}


export type GrokPendingPlanExit = {
  requestId: string;
  appSessionId: string;
  plan: string;
  resumeOptions?: Record<string, unknown>;
};

const pendingGrokPlanExits = new Map<string, GrokPendingPlanExit>();

export function registerGrokPlanExit(record: GrokPendingPlanExit): void {
  pendingGrokPlanExits.set(record.requestId, record);
}

export function takeGrokPlanExit(requestId: string): GrokPendingPlanExit | null {
  const record = pendingGrokPlanExits.get(requestId) || null;
  if (record) {
    pendingGrokPlanExits.delete(requestId);
  }
  return record;
}

export function registerGrokQuestion(record: GrokPendingQuestion): void {
  pendingGrokQuestions.set(record.requestId, record);
}

export function takeGrokQuestion(requestId: string): GrokPendingQuestion | null {
  const record = pendingGrokQuestions.get(requestId) || null;
  if (record) {
    pendingGrokQuestions.delete(requestId);
  }
  return record;
}

export function listGrokQuestionsForAppSession(appSessionId: string): GrokPendingQuestion[] {
  return [...pendingGrokQuestions.values()].filter((record) => record.appSessionId === appSessionId);
}

export function takeGrokQuestionsForAppSession(appSessionId: string): GrokPendingQuestion[] {
  const records = listGrokQuestionsForAppSession(appSessionId);
  for (const record of records) {
    pendingGrokQuestions.delete(record.requestId);
  }
  return records;
}

/** Test-only: the registry is process-global. */
export function resetGrokQuestionsForTests(): void {
  pendingGrokQuestions.clear();
  pendingGrokPlanExits.clear();
}
