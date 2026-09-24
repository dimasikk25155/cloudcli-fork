import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGrokArgs,
  buildGrokRules,
  consumeGrokPlanBypassAwaitingAnswers,
  embedGrokFollowupPrompt,
  embedGrokRulesInPrompt,
  grokHangReason,
  grokHangUserMessage,
  grokPromptFitsArgv,
  GROK_FIRST_BYTE_MS,
  GROK_IDLE_SILENCE_MS,
  markGrokPlanBypassAwaitingAnswers,
  MAX_GROK_PROMPT_ARGV_CHARS,
  parseStopHookDecision,
  resetGrokPlanBypassStateForTests,
  resolveGrokEffort,
  resolveGrokPermissionMode,
  resolveGrokPlanBypassPhase,
  SESSION_FOLLOWUP_CLOSE_TAG,
  SESSION_FOLLOWUP_OPEN_TAG,
} from './grok-cli.js';
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
  assert.equal(resolveGrokPermissionMode('plan'), 'bypassPermissions');
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

  assert.equal(args[args.indexOf('--output-format') + 1], 'streaming-messages-json');
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'auto');
  assert.equal(args[args.indexOf('-s') + 1], '11111111-2222-3333-4444-555555555555');
  assert.equal(args[args.indexOf('-m') + 1], 'grok-4.6');
  // Raw model id still gets an identity rule so the agent does not self-report
  // as "Grok 4.6 Build" from xAI's hardcoded system line alone.
  assert.match(args[args.indexOf('-p') + 1], /MODEL IDENTITY/);
  assert.match(args[args.indexOf('-p') + 1], /hello$/);
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
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'bypassPermissions');
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
  // xhigh exists on 4.6 and newer; on 4.5 it is an argv error, not a downgrade.
  assert.equal(resolveGrokEffort('grok-4.7', 'xhigh'), 'xhigh');
  assert.equal(resolveGrokEffort('grok-4.6', 'xhigh'), 'xhigh');
  assert.equal(resolveGrokEffort('grok-4.5', 'xhigh'), undefined);
  assert.equal(resolveGrokEffort('grok-4.5', 'high'), 'high');
  // No model selected means the catalog default (grok-4.7), which takes xhigh.
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
  const idle = buildGrokRules({ workMode: 'autopilot', permissionMode: 'default' });
  assert.match(idle, /ask_user_question/);
  assert.doesNotMatch(idle, /WORK MODE:/);

  const planned = buildGrokRules({ workMode: 'autopilot', permissionMode: 'planBypass' });
  assert.match(planned, /QUESTIONS FIRST/);
  assert.doesNotMatch(planned, /HAS ANSWERED/);

  const running = buildGrokRules({ workMode: 'autopilot', permissionMode: 'planBypass', planBypassPhase: 'run' });
  assert.match(running, /HAS ANSWERED/);
  assert.doesNotMatch(running, /QUESTIONS FIRST/);

  const briefed = buildGrokRules({ workMode: 'checkpoints', permissionMode: 'default' });
  assert.match(briefed, /WORK MODE: STAGED BRIEFINGS/);
  assert.doesNotMatch(briefed, /QUESTIONS FIRST/);

  const both = buildGrokRules({ workMode: 'checkpoints', permissionMode: 'planBypass' });
  assert.match(both, /QUESTIONS FIRST/);
  assert.match(both, /WORK MODE: STAGED BRIEFINGS/);

  const plainPlan = buildGrokRules({ workMode: 'autopilot', permissionMode: 'plan' });
  assert.match(plainPlan, /PLAN MODE/);
  assert.doesNotMatch(plainPlan, /QUESTIONS FIRST/);
  assert.doesNotMatch(plainPlan, /HAS ANSWERED/);
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
  assert.match(args[args.indexOf('--rules') + 1], /QUESTIONS FIRST/);
  assert.equal(args[args.indexOf('--disallowed-tools') + 1], 'search_replace,write');

  const plain = buildGrokArgs({
    prompt: 'go',
    sessionId: null,
    resolvedSessionId: 'aaaaaaaa-0000-1111-2222-333333333333',
    model: 'grok-4.6',
    permissionMode: 'default',
    workMode: 'autopilot',
  });
  // Autopilot alone adds no work-mode text, but a selected model always gets
  // an identity rule (xAI's system line always claims "Grok 4.6").
  assert.match(plain[plain.indexOf('--rules') + 1], /MODEL IDENTITY/);
  assert.doesNotMatch(plain[plain.indexOf('--rules') + 1], /WORK MODE/);
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

test('the catalog offers the real models and keeps the mode presets wired', () => {
  const visible = GROK_FALLBACK_MODELS.OPTIONS.filter((option) => !option.hidden);
  assert.deepEqual(visible.map((option) => option.value), [
    'grok-4.7',
    'grok-4.7-build-fast',
  ]);
  assert.equal(visible[0].label, 'Grok 4.7');
  assert.equal(GROK_FALLBACK_MODELS.DEFAULT, 'grok-4.7');
  // Старые чаты на спрятанных режимах должны продолжать работать.
  const hidden = GROK_FALLBACK_MODELS.OPTIONS.filter((option) => option.hidden).map((o) => o.value);
  assert.deepEqual(hidden, [
    'grok-4.6',
    'grok-4.5',
    'grok-mode-build',
    'grok-mode-fast',
    'grok-mode-auto',
    'grok-mode-expert',
    'grok-mode-heavy',
  ]);
  assert.equal(GROK_MODE_PRESETS['grok-mode-build'].model, 'grok-4.7');
  assert.equal(GROK_MODE_PRESETS['grok-mode-fast'].model, 'grok-4.7');
});

test('a real model rides the composer effort chip straight into --reasoning-effort', () => {
  // Главная претензия 22.09: месяц на high без возможности выбрать xhigh.
  const xhigh = argsForModel('grok-4.7', { effort: 'xhigh' });
  assert.equal(xhigh[xhigh.indexOf('-m') + 1], 'grok-4.7');
  assert.equal(xhigh[xhigh.indexOf('--reasoning-effort') + 1], 'xhigh');

  // Чип не тронут — CLI сам берёт свой дефолт (high), флаг не передаём.
  const untouched = argsForModel('grok-4.7', { effort: 'default' });
  assert.ok(!untouched.includes('--reasoning-effort'));
});

test('a preset owns its level — the effort chip cannot override it', () => {
  // Уровень, унаследованный из чата на Claude, не должен ни подменять режим,
  // ни убивать прогон (xhigh на 4.5 — ошибка argv, а не понижение).
  const fast = argsForModel('grok-mode-fast', { effort: 'xhigh' });
  assert.equal(fast[fast.indexOf('-m') + 1], 'grok-4.7');
  assert.equal(fast[fast.indexOf('--reasoning-effort') + 1], 'low');

  const auto = argsForModel('grok-mode-auto', { effort: 'high' });
  assert.ok(!auto.includes('--reasoning-effort'));
});

test('every visible mode ships an identity rule; heavy also ships the panel rule', () => {
  const heavy = argsForModel('grok-mode-heavy', { workMode: 'autopilot' });
  assert.match(heavy[heavy.indexOf('--rules') + 1], /HEAVY MODE/);
  assert.match(heavy[heavy.indexOf('--rules') + 1], /MODEL IDENTITY/);

  const expert = argsForModel('grok-mode-expert', { workMode: 'autopilot' });
  assert.match(expert[expert.indexOf('--rules') + 1], /MODEL IDENTITY/);
  assert.match(expert[expert.indexOf('--rules') + 1], /Grok 4\.5/);

  const fast = argsForModel('grok-mode-fast', { workMode: 'autopilot' });
  assert.match(fast[fast.indexOf('--rules') + 1], /Grok Fast/);

  const build = argsForModel('grok-mode-build', { workMode: 'autopilot' });
  assert.match(build[build.indexOf('--rules') + 1], /Grok 4\.7 Build/);

  // Правило режима и режим работы едут вместе, не вытесняя друг друга.
  const both = buildGrokRules({ workMode: 'checkpoints', permissionMode: 'planBypass', model: 'grok-mode-heavy' });
  assert.match(both, /QUESTIONS FIRST/);
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

test('interactive Grok rules tell the model to call ask_user_question', () => {
  const checkpoints = buildGrokRules({ workMode: 'checkpoints', permissionMode: 'default' });
  assert.match(checkpoints, /ask_user_question/);
  assert.doesNotMatch(checkpoints, /AskUserQuestion/);

  const askPhase = buildGrokRules({
    workMode: 'autopilot',
    permissionMode: 'planBypass',
    planBypassPhase: 'ask',
  });
  assert.match(askPhase, /ask_user_question/);

  const silent = buildGrokRules({ workMode: 'autopilot', permissionMode: 'bypassPermissions' });
  assert.equal(silent, null);
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
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'bypassPermissions');
  const i = args.indexOf('--disallowed-tools');
  assert.notEqual(i, -1, 'plan run must disallow file-writing tools');
  assert.match(args[i + 1], /search_replace/);
  assert.match(args[i + 1], /write/);
  assert.match(args[args.indexOf('--rules') + 1], /PLAN MODE/);
});

test('non-plan modes do not strip tools', () => {
  for (const permissionMode of ['default', 'bypassPermissions', 'acceptEdits']) {
    const args = buildGrokArgs({
      prompt: 'x',
      resolvedSessionId: '00000000-0000-4000-8000-000000000000',
      model: 'grok-mode-fast',
      permissionMode,
    });
    assert.equal(args.includes('--disallowed-tools'), false, `${permissionMode} must keep all tools`);
  }
});

test('planBypass ask phase is read-only; the answer turn gets the tools back', () => {
  const ask = buildGrokArgs({
    prompt: 'привет',
    resolvedSessionId: '00000000-0000-4000-8000-000000000000',
    model: 'grok-mode-fast',
    permissionMode: 'planBypass',
    planBypassPhase: 'ask',
  });
  assert.equal(ask[ask.indexOf('--permission-mode') + 1], 'bypassPermissions');
  assert.equal(ask[ask.indexOf('--disallowed-tools') + 1], 'search_replace,write');
  assert.match(ask[ask.indexOf('--rules') + 1], /QUESTIONS FIRST/);

  const run = buildGrokArgs({
    prompt: '1',
    resolvedSessionId: '00000000-0000-4000-8000-000000000000',
    model: 'grok-mode-fast',
    permissionMode: 'planBypass',
    planBypassPhase: 'run',
  });
  assert.equal(run[run.indexOf('--permission-mode') + 1], 'bypassPermissions');
  assert.equal(run.includes('--disallowed-tools'), false);
  assert.match(run[run.indexOf('--rules') + 1], /HAS ANSWERED/);
});

test('planBypass awaiting-answers latch flips ask to run once', () => {
  resetGrokPlanBypassStateForTests();
  assert.equal(consumeGrokPlanBypassAwaitingAnswers('sess-1'), false);
  markGrokPlanBypassAwaitingAnswers('sess-1');
  assert.equal(consumeGrokPlanBypassAwaitingAnswers('sess-1'), true);
  assert.equal(consumeGrokPlanBypassAwaitingAnswers('sess-1'), false);
  resetGrokPlanBypassStateForTests();
});

test('after the chip snaps to bypass, the latch still runs the answer turn', () => {
  resetGrokPlanBypassStateForTests();
  consumeGrokPlanBypassAwaitingAnswers('sess-idle');
  assert.equal(resolveGrokPlanBypassPhase('planBypass', 'sess-idle'), 'ask');
  markGrokPlanBypassAwaitingAnswers('sess-idle');
  assert.equal(resolveGrokPlanBypassPhase('bypassPermissions', 'sess-idle'), 'run');
  assert.equal(resolveGrokPlanBypassPhase('bypassPermissions', 'sess-idle'), null);
  resetGrokPlanBypassStateForTests();
});

test('buildGrokRules still emits the run instruction when the chip is already idle', () => {
  const running = buildGrokRules({
    workMode: 'autopilot',
    permissionMode: 'bypassPermissions',
    planBypassPhase: 'run',
  });
  assert.match(running, /HAS ANSWERED/);
  assert.doesNotMatch(running, /QUESTIONS FIRST/);
});

test('buildGrokArgs uses --prompt-file instead of stuffing a huge payload onto argv', () => {
  assert.equal(grokPromptFitsArgv('x'.repeat(MAX_GROK_PROMPT_ARGV_CHARS)), true);
  assert.equal(grokPromptFitsArgv('x'.repeat(MAX_GROK_PROMPT_ARGV_CHARS + 1)), false);

  const args = buildGrokArgs({
    prompt: 'смотри фото',
    promptFile: '/tmp/grok-prompt-test/prompt.txt',
    resolvedSessionId: '00000000-0000-4000-8000-000000000000',
    model: 'grok-mode-fast',
    permissionMode: 'default',
  });
  assert.equal(args[args.indexOf('--prompt-file') + 1], '/tmp/grok-prompt-test/prompt.txt');
  assert.equal(args.includes('-p'), false);
  assert.equal(args.includes('--prompt-json'), false);
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

test('a plain Fast run embeds only the identity rule into the prompt', () => {
  const args = buildGrokArgs({
    prompt: 'просто вопрос',
    resolvedSessionId: '00000000-0000-4000-8000-000000000000',
    model: 'grok-mode-fast',
    permissionMode: 'default',
  });
  const prompt = args[args.indexOf('-p') + 1];
  assert.match(prompt, /^<work_mode_rules>\n/);
  assert.match(prompt, /Grok Fast/);
  assert.match(prompt, /<\/work_mode_rules>\n\nпросто вопрос$/);
  assert.notEqual(args.indexOf('--rules'), -1);
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

test('parseStopHookDecision only wakes on decision:block with a reason', () => {
  assert.equal(
    parseStopHookDecision('{"decision":"block","reason":"Перед завершением сессии примени навык obsidian-memory."}'),
    'Перед завершением сессии примени навык obsidian-memory.',
  );
  assert.equal(parseStopHookDecision('{"decision":"approve"}'), '');
  assert.equal(parseStopHookDecision('not json'), '');
  assert.equal(parseStopHookDecision(''), '');
});

test('embedGrokFollowupPrompt wraps the Stop reason in a strippable tag', () => {
  const wrapped = embedGrokFollowupPrompt('запиши в вольт');
  assert.match(wrapped, new RegExp(`^${SESSION_FOLLOWUP_OPEN_TAG}\\n`));
  assert.match(wrapped, /запиши в вольт/);
  assert.match(wrapped, new RegExp(`${SESSION_FOLLOWUP_CLOSE_TAG}$`));
});

test('buildGrokArgs switches -p to --prompt-json and never sends both', () => {
  const withImages = buildGrokArgs({
    prompt: 'какой цвет',
    promptJson: JSON.stringify([{ type: 'text', text: 'какой цвет' }, { type: 'image', mimeType: 'image/png', data: 'aa' }]),
    resolvedSessionId: '00000000-0000-4000-8000-000000000000',
    model: 'grok-mode-fast',
    permissionMode: 'default',
  });
  assert.ok(withImages.includes('--prompt-json'));
  assert.equal(withImages.includes('-p'), false);
  const payload = JSON.parse(withImages[withImages.indexOf('--prompt-json') + 1]);
  assert.equal(payload[1].type, 'image');
  assert.equal(payload[1].mimeType, 'image/png');

  const textOnly = buildGrokArgs({
    prompt: 'привет',
    resolvedSessionId: '00000000-0000-4000-8000-000000000000',
    model: 'grok-mode-fast',
    permissionMode: 'default',
  });
  assert.ok(textOnly.includes('-p'));
  assert.equal(textOnly.includes('--prompt-json'), false);
});

test('hang watchdog trips when Grok never prints a first byte', () => {
  const spawnedAt = 1_000_000;
  assert.equal(grokHangReason({
    spawnedAt, firstByteAt: null, lastStdoutAt: null, now: spawnedAt + GROK_FIRST_BYTE_MS - 1, hasChildren: false,
  }), null);
  assert.equal(grokHangReason({
    spawnedAt, firstByteAt: null, lastStdoutAt: null, now: spawnedAt + GROK_FIRST_BYTE_MS, hasChildren: false,
  }), 'first_byte');
  // A long tool call that has not streamed yet still counts as first-byte hang
  // if the CLI itself printed nothing — children do not excuse a silent spawn.
  assert.equal(grokHangReason({
    spawnedAt, firstByteAt: null, lastStdoutAt: null, now: spawnedAt + GROK_FIRST_BYTE_MS, hasChildren: true,
  }), 'first_byte');
});

test('hang watchdog ignores long tool calls that have children, trips idle silence without them', () => {
  const spawnedAt = 1_000_000;
  const firstByteAt = spawnedAt + 1_000;
  assert.equal(grokHangReason({
    spawnedAt, firstByteAt, lastStdoutAt: firstByteAt, now: firstByteAt + GROK_IDLE_SILENCE_MS, hasChildren: true,
  }), null);
  assert.equal(grokHangReason({
    spawnedAt, firstByteAt, lastStdoutAt: firstByteAt, now: firstByteAt + GROK_IDLE_SILENCE_MS - 1, hasChildren: false,
  }), null);
  assert.equal(grokHangReason({
    spawnedAt, firstByteAt, lastStdoutAt: firstByteAt, now: firstByteAt + GROK_IDLE_SILENCE_MS, hasChildren: false,
  }), 'idle_silence');
});

test('hang watchdog user copy names the hole and tells Dima not to resume', () => {
  assert.match(grokHangUserMessage('first_byte'), /завис на старте/);
  assert.match(grokHangUserMessage('first_byte'), /новый/);
  assert.match(grokHangUserMessage('idle_silence'), /8 минут/);
});
