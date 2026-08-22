import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGrokArgs, buildGrokRules, embedGrokRulesInPrompt, resolveGrokEffort, resolveGrokPermissionMode } from './grok-cli.js';
import {
  GROK_FALLBACK_MODELS,
  GROK_MODE_PRESETS,
} from './modules/providers/list/grok/grok-models.provider.js';

/**
 * Permission mapping. Measured against grok 1.0.5 on a live box: a headless
 * run that hits a permission gate ends as error_during_execution/cancelled
 * with no answer text, so `default` and `dontAsk` are unusable and `auto` is
 * the mode the UI default has to land on.
 */
test('resolveGrokPermissionMode maps the UI modes onto usable CLI modes', () => {
  assert.equal(resolveGrokPermissionMode('bypassPermissions'), 'bypassPermissions');
  assert.equal(resolveGrokPermissionMode('plan'), 'plan');
  assert.equal(resolveGrokPermissionMode('acceptEdits'), 'acceptEdits');
  assert.equal(resolveGrokPermissionMode('default'), 'auto');
  assert.equal(resolveGrokPermissionMode(undefined), 'auto');
  // planBypass DOES reach this runner on purpose since 21.08.2026: Grok has no
  // permission prompt for the client to approve, so the pairing is emulated
  // here (permissions granted + a "plan first" system rule). Asserted in its
  // own test below; an unknown mode still must not hand over the machine.
  assert.equal(resolveGrokPermissionMode('somethingElse'), 'auto');
});

test('buildGrokArgs names a new session and always requests the wire format', () => {
  const args = buildGrokArgs({
    prompt: '  hello  ',
    sessionId: null,
    resolvedSessionId: '11111111-2222-3333-4444-555555555555',
    model: 'grok-4.6',
    permissionMode: 'default',
  });

  assert.deepEqual(args, [
    '-p', 'hello',
    '--output-format', 'streaming-messages-json',
    '--permission-mode', 'auto',
    '-s', '11111111-2222-3333-4444-555555555555',
    '-m', 'grok-4.6',
  ]);
});

test('buildGrokArgs resumes an existing session instead of naming a new one', () => {
  const args = buildGrokArgs({
    prompt: 'continue',
    sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    resolvedSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    model: 'grok-4.5',
    permissionMode: 'bypassPermissions',
  });

  assert.ok(args.includes('--resume'));
  assert.equal(args[args.indexOf('--resume') + 1], 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.ok(!args.includes('-s'), 'a resumed run must not also name a new session');
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'bypassPermissions');
  assert.equal(args[args.indexOf('-m') + 1], 'grok-4.5');
});

test('buildGrokArgs omits optional flags when nothing is selected', () => {
  const args = buildGrokArgs({
    prompt: 'hi',
    sessionId: null,
    resolvedSessionId: 'ffffffff-0000-1111-2222-333333333333',
    model: null,
    permissionMode: 'plan',
  });

  assert.ok(!args.includes('-m'));
  assert.ok(!args.includes('--reasoning-effort'));
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'plan');
});

/**
 * Effort mapping. The CLI validates `--reasoning-effort` at argv parse time,
 * so a level the selected model does not accept kills the whole run before it
 * reaches xAI ("unknown effort level 'default'" — the bug from 21.08.2026).
 */
test('resolveGrokEffort drops levels the selected model does not accept', () => {
  // The composer's sentinel: every provider sends it when no level is picked.
  assert.equal(resolveGrokEffort('grok-4.6', 'default'), undefined);
  assert.equal(resolveGrokEffort('grok-4.6', undefined), undefined);
  // xhigh exists on 4.6 only; on 4.5 it is an argv error, not a downgrade.
  assert.equal(resolveGrokEffort('grok-4.6', 'xhigh'), 'xhigh');
  assert.equal(resolveGrokEffort('grok-4.5', 'xhigh'), undefined);
  assert.equal(resolveGrokEffort('grok-4.5', 'high'), 'high');
  // No model selected means the CLI runs its own default (grok-4.6).
  assert.equal(resolveGrokEffort(null, 'xhigh'), 'xhigh');
  assert.equal(resolveGrokEffort('grok-4.6', 'bogus'), undefined);
});

test('buildGrokArgs never passes an effort level the model would reject', () => {
  const sentinel = buildGrokArgs({
    prompt: 'hi',
    sessionId: null,
    resolvedSessionId: '11111111-2222-3333-4444-555555555555',
    model: 'grok-4.6',
    permissionMode: 'default',
    effort: 'default',
  });
  assert.ok(!sentinel.includes('--reasoning-effort'));

  const tooHigh = buildGrokArgs({
    prompt: 'hi',
    sessionId: null,
    resolvedSessionId: '11111111-2222-3333-4444-555555555555',
    model: 'grok-4.5',
    permissionMode: 'default',
    effort: 'xhigh',
  });
  assert.ok(!tooHigh.includes('--reasoning-effort'));

  const accepted = buildGrokArgs({
    prompt: 'hi',
    sessionId: null,
    resolvedSessionId: '11111111-2222-3333-4444-555555555555',
    model: 'grok-4.6',
    permissionMode: 'default',
    effort: 'high',
  });
  assert.equal(accepted[accepted.indexOf('--reasoning-effort') + 1], 'high');
});

/**
 * Work mode + "plan then run" ride on `--rules` (Grok's system-prompt append),
 * because Grok has no permission prompt to answer and a headless `plan` run
 * dies at the first tool call instead of pausing.
 */
test('resolveGrokPermissionMode runs planBypass with permissions granted', () => {
  assert.equal(resolveGrokPermissionMode('planBypass'), 'bypassPermissions');
});

test('buildGrokRules carries the work mode and the plan instruction', () => {
  assert.equal(buildGrokRules({ workMode: 'autopilot', permissionMode: 'default' }), null);

  const planned = buildGrokRules({ workMode: 'autopilot', permissionMode: 'planBypass' });
  assert.match(planned, /PLAN FIRST/);

  const briefed = buildGrokRules({ workMode: 'checkpoints', permissionMode: 'default' });
  assert.match(briefed, /WORK MODE: STAGED BRIEFINGS/);
  assert.doesNotMatch(briefed, /PLAN FIRST/);

  const both = buildGrokRules({ workMode: 'checkpoints', permissionMode: 'planBypass' });
  assert.match(both, /PLAN FIRST/);
  assert.match(both, /WORK MODE: STAGED BRIEFINGS/);
});

test('buildGrokArgs passes the rules and never leaves planBypass on the wire', () => {
  const args = buildGrokArgs({
    prompt: 'go',
    sessionId: null,
    resolvedSessionId: 'aaaaaaaa-0000-1111-2222-333333333333',
    model: 'grok-4.6',
    permissionMode: 'planBypass',
    workMode: 'checkpoints',
  });

  // The CLI would reject `planBypass` — it is ours, not xAI's.
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'bypassPermissions');
  assert.match(args[args.indexOf('--rules') + 1], /PLAN FIRST/);

  const plain = buildGrokArgs({
    prompt: 'go',
    sessionId: null,
    resolvedSessionId: 'aaaaaaaa-0000-1111-2222-333333333333',
    model: 'grok-4.6',
    permissionMode: 'default',
    workMode: 'autopilot',
  });
  assert.ok(!plain.includes('--rules'), 'autopilot in a normal run adds no system rules');
});

/**
 * Mode presets (22.08.2026). The composer now lists grok.com-style modes
 * instead of raw model ids; a preset id reaching the CLI would be answered with
 * `unknown model id` and the run would die before it ever contacted xAI.
 */
const argsForModel = (model, extra = {}) => buildGrokArgs({
  prompt: 'go',
  sessionId: null,
  resolvedSessionId: 'aaaaaaaa-0000-1111-2222-333333333333',
  model,
  permissionMode: 'default',
  ...extra,
});

test('every mode preset expands into flags the CLI actually accepts', () => {
  const catalogModels = new Map(
    GROK_FALLBACK_MODELS.OPTIONS
      .filter((option) => option.effort)
      .map((option) => [option.value, option.effort.values.map((level) => level.value)]),
  );

  for (const [presetId, preset] of Object.entries(GROK_MODE_PRESETS)) {
    const args = argsForModel(presetId);
    const model = args[args.indexOf('-m') + 1];

    assert.ok(!args.includes(presetId), `${presetId} must never reach argv`);
    assert.equal(model, preset.model);
    assert.ok(catalogModels.has(model), `${presetId} points at a model the catalog does not list`);

    if (preset.effort === null) {
      assert.ok(!args.includes('--reasoning-effort'), `${presetId} must leave the CLI on its own level`);
    } else {
      assert.equal(args[args.indexOf('--reasoning-effort') + 1], preset.effort);
      assert.ok(
        catalogModels.get(model).includes(preset.effort),
        `${presetId} asks ${model} for a level it rejects at argv parse time`,
      );
    }
  }
});

test('the catalog offers Build and Fast and keeps the other modes wired', () => {
  const visible = GROK_FALLBACK_MODELS.OPTIONS.filter((option) => !option.hidden);
  assert.deepEqual(visible.map((option) => option.value), ['grok-mode-build', 'grok-mode-fast']);
  visible.forEach((option) => assert.match(option.label, /Grok 4\.\d/));
  // Старые чаты на спрятанных режимах и сырых моделях должны продолжать работать.
  const hidden = GROK_FALLBACK_MODELS.OPTIONS.filter((option) => option.hidden).map((o) => o.value);
  assert.deepEqual(hidden, [
    'grok-mode-auto',
    'grok-mode-expert',
    'grok-mode-heavy',
    'grok-4.6',
    'grok-4.5',
  ]);
  assert.ok(GROK_MODE_PRESETS[GROK_FALLBACK_MODELS.DEFAULT], 'the default must be one of the modes');
});

test('a preset owns its level — the effort chip cannot override it', () => {
  // Уровень, унаследованный из чата на Claude, не должен ни подменять режим,
  // ни убивать прогон (xhigh на 4.5 — ошибка argv, а не понижение).
  const fast = argsForModel('grok-mode-fast', { effort: 'xhigh' });
  assert.equal(fast[fast.indexOf('-m') + 1], 'grok-4.5');
  assert.equal(fast[fast.indexOf('--reasoning-effort') + 1], 'low');

  const auto = argsForModel('grok-mode-auto', { effort: 'high' });
  assert.ok(!auto.includes('--reasoning-effort'));
});

test('the heavy mode ships its panel rule, the others do not', () => {
  const heavy = argsForModel('grok-mode-heavy', { workMode: 'autopilot' });
  assert.match(heavy[heavy.indexOf('--rules') + 1], /HEAVY MODE/);

  const expert = argsForModel('grok-mode-expert', { workMode: 'autopilot' });
  assert.ok(!expert.includes('--rules'));

  // Правило режима и режим работы едут вместе, не вытесняя друг друга.
  const both = buildGrokRules({ workMode: 'checkpoints', permissionMode: 'planBypass', model: 'grok-mode-heavy' });
  assert.match(both, /PLAN FIRST/);
  assert.match(both, /HEAVY MODE/);
  assert.match(both, /WORK MODE: STAGED BRIEFINGS/);
});

test('rules sent to Grok never name a tool it does not have', () => {
  for (const workMode of ['checkpoints', 'interrogate', 'build']) {
    const rules = buildGrokRules({ workMode, permissionMode: 'bypassPermissions' });
    assert.doesNotMatch(rules, /AskUserQuestion/);
    assert.doesNotMatch(rules, /Skill tool/);
  }
});

test('raw model ids still work for sessions and localStorage that hold them', () => {
  const raw = argsForModel('grok-4.5', { effort: 'high' });
  assert.equal(raw[raw.indexOf('-m') + 1], 'grok-4.5');
  assert.equal(raw[raw.indexOf('--reasoning-effort') + 1], 'high');
});

test('plan mode strips the file-writing tool so it is actually read-only', () => {
  const args = buildGrokArgs({
    prompt: 'plan something',
    resolvedSessionId: '00000000-0000-4000-8000-000000000000',
    model: 'grok-mode-fast',
    permissionMode: 'plan',
  });
  const i = args.indexOf('--disallowed-tools');
  assert.notEqual(i, -1, 'plan run must disallow search_replace');
  assert.match(args[i + 1], /search_replace/);
});

test('non-plan modes do not strip tools', () => {
  for (const permissionMode of ['default', 'bypassPermissions', 'planBypass', 'acceptEdits']) {
    const args = buildGrokArgs({
      prompt: 'x',
      resolvedSessionId: '00000000-0000-4000-8000-000000000000',
      model: 'grok-mode-fast',
      permissionMode,
    });
    assert.equal(args.includes('--disallowed-tools'), false, `${permissionMode} must keep all tools`);
  }
});

test('work-mode rules ride inside the prompt because --rules never reaches the model', () => {
  const args = buildGrokArgs({
    prompt: 'сделай дело',
    resolvedSessionId: '00000000-0000-4000-8000-000000000000',
    model: 'grok-mode-fast',
    permissionMode: 'bypassPermissions',
    workMode: 'checkpoints',
  });
  const prompt = args[args.indexOf('-p') + 1];
  assert.match(prompt, /^<work_mode_rules>\n/);
  assert.match(prompt, /STAGED BRIEFINGS/);
  assert.match(prompt, /<\/work_mode_rules>\n\nсделай дело$/);
  // The designed flag stays as a second channel for future CLI versions.
  assert.notEqual(args.indexOf('--rules'), -1);
});

test('a plain run embeds no rules tag into the prompt', () => {
  const args = buildGrokArgs({
    prompt: 'просто вопрос',
    resolvedSessionId: '00000000-0000-4000-8000-000000000000',
    model: 'grok-mode-fast',
    permissionMode: 'default',
  });
  assert.equal(args[args.indexOf('-p') + 1], 'просто вопрос');
  assert.equal(args.includes('--rules'), false);
});

test('hook context rides in a session_context block before the rules', () => {
  const prompt = embedGrokRulesInPrompt('вопрос', 'RULE X', 'ВНЕШНЯЯ ПАМЯТЬ: вольт 1190 заметок');
  assert.match(prompt, /^<session_context>\nВНЕШНЯЯ ПАМЯТЬ: вольт 1190 заметок\n<\/session_context>\n<work_mode_rules>\n/);
  assert.match(prompt, /<\/work_mode_rules>\n\nвопрос$/);
});

test('hook context embeds even when no work-mode rules exist', () => {
  const prompt = embedGrokRulesInPrompt('вопрос', null, 'РЕАЛЬНОЕ ВРЕМЯ СЕЙЧАС: 2026-08-22');
  assert.match(prompt, /^<session_context>\n/);
  assert.match(prompt, /<\/session_context>\n\nвопрос$/);
  assert.equal(prompt.includes('<work_mode_rules>'), false);
});
