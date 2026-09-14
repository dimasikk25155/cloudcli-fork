import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_WORK_MODE,
  WORK_MODES,
  normalizeWorkMode,
  normalizeWorkModeDialect,
  workModeInstruction,
} from '@/shared/work-mode.js';

test('unknown, missing and malformed modes fall back to the default', () => {
  for (const value of [undefined, null, '', 'plan', 'AUTOPILOT', 42, {}]) {
    assert.equal(normalizeWorkMode(value), DEFAULT_WORK_MODE);
  }
});

test('every known mode survives normalization', () => {
  for (const mode of WORK_MODES) {
    assert.equal(normalizeWorkMode(mode), mode);
  }
});

test('autopilot appends nothing — it is the runtime default behaviour', () => {
  assert.equal(workModeInstruction('autopilot'), null);
  // An unknown value must be as quiet as autopilot, never accidentally
  // switching a run into a mode the user did not pick.
  assert.equal(workModeInstruction('nonsense'), null);
});

test('the interactive modes carry an instruction that names the asking tool', () => {
  for (const mode of ['checkpoints', 'interrogate']) {
    const instruction = workModeInstruction(mode);
    assert.ok(instruction && instruction.length > 0, `${mode} should produce an instruction`);
    assert.match(instruction!, /AskUserQuestion/);
  }
});

test('the build mode hands the message to the autopilot skill', () => {
  const instruction = workModeInstruction('build');
  assert.match(instruction!, /Skill tool with skill "autopilot"/);
  // Верхний слой не должен пересказывать процесс своими словами: весь он
  // живёт в скилле, и дублирование разошлось бы с ним на первом обновлении.
  assert.doesNotMatch(instruction!, /AskUserQuestion/);
});

test('bypassing permissions is what buys the silent run', () => {
  // «Планирование плюс обход» — это заявка на полный автомат.
  for (const permissionMode of ['bypassPermissions', 'planBypass']) {
    assert.match(workModeInstruction('build', permissionMode)!, /`full` mode/);
  }
  // Везде остальном вопросы на развилках остаются.
  for (const permissionMode of [undefined, 'default', 'plan', 'acceptEdits']) {
    assert.match(workModeInstruction('build', permissionMode)!, /`semi` mode/);
  }
});

test('the dial reaches only the build mode', () => {
  // Права прогона не должны менять текст остальных режимов.
  assert.equal(workModeInstruction('autopilot', 'bypassPermissions'), null);
  assert.equal(
    workModeInstruction('checkpoints', 'bypassPermissions'),
    workModeInstruction('checkpoints'),
  );
});

test('an unknown dialect speaks Claude, and Claude is what callers get by default', () => {
  for (const value of [undefined, null, '', 'gpt', 42, {}]) {
    assert.equal(normalizeWorkModeDialect(value), 'claude');
  }
  for (const mode of WORK_MODES) {
    assert.equal(workModeInstruction(mode), workModeInstruction(mode, undefined, 'claude'));
    assert.equal(workModeInstruction(mode), workModeInstruction(mode, undefined, 'nonsense'));
  }
});

test('the Claude wording is unchanged where the dialect was spliced in', () => {
  // Движок, который работает, не должен пострадать от появления второго
  // диалекта: проверяются оба стыка, где текст теперь склеивается из кусков.
  //
  // «Брифы» переписаны 23.08: бриф — нарратив, агент продолжает сам, вопрос
  // только на настоящей развилке. Дословный якорь ниже держит именно это,
  // чтобы регресс к «спроси continue/adjust после каждой стадии» не прополз
  // обратно незамеченным — Дима прокликал пять таких кнопок подряд.
  assert.match(
    workModeInstruction('checkpoints')!,
    /Then continue into the next stage YOURSELF, immediately\. Never ask permission to continue/,
  );
  assert.match(
    workModeInstruction('checkpoints')!,
    /Stop and ask ONLY at a genuine fork: .* There, ask with AskUserQuestion, and make the options the actual variants at stake/,
  );
  assert.match(
    workModeInstruction('interrogate')!,
    /inside it — ask the user clarifying questions with AskUserQuestion, offering concrete options rather than open prose\. State the assumption/,
  );
  assert.match(
    workModeInstruction('build')!,
    /ordinary chat turn\. Invoke the Skill tool with skill "autopilot" and hand it that message verbatim as the brief\. Do not scope/,
  );
});

test('the grok dialect never names a tool Grok Build does not have', () => {
  // Claude's AskUserQuestion / Skill tool names must not appear: Grok's live
  // tool is `ask_user_question`, and skills are discovered by name, not Skill.
  for (const mode of WORK_MODES) {
    const instruction = workModeInstruction(mode, 'default', 'grok');
    if (!instruction) {
      continue;
    }
    assert.doesNotMatch(instruction, /AskUserQuestion/);
    assert.doesNotMatch(instruction, /Skill tool/);
  }
});

test('the grok dialect tells the agent how to ask and how to reach the skill', () => {
  for (const mode of ['checkpoints', 'interrogate']) {
    const instruction = workModeInstruction(mode, 'default', 'grok')!;
    assert.match(instruction, /ask_user_question/);
    assert.match(instruction, /Do not write the options as numbered chat text/);
  }

  const build = workModeInstruction('build', 'bypassPermissions', 'grok')!;
  assert.match(build, /`autopilot` skill/);
  assert.match(build, /~\/\.claude\/skills\/autopilot\/SKILL\.md/);
  // Ручка «сколько спрашивать» одинаковая на обоих движках.
  assert.match(build, /`full` mode/);
});

test('the dialect changes only the wording, never which mode is silent', () => {
  assert.equal(workModeInstruction('autopilot', 'default', 'grok'), null);
  for (const mode of ['checkpoints', 'interrogate', 'build']) {
    assert.notEqual(workModeInstruction(mode, 'default', 'grok'), null);
    assert.notEqual(
      workModeInstruction(mode, 'default', 'grok'),
      workModeInstruction(mode, 'default', 'claude'),
    );
  }
});
