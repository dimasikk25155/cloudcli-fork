import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { RunPhaseFrame } from '../../../../shared/run-phase';

import { activityPatchForPhase, isBetweenTurns, killedBackgroundLine, parseRunPhaseFrame, runPhaseLabel, type PhaseTranslate } from './runPhase.js';

const ru = JSON.parse(readFileSync(new URL('../../../i18n/locales/ru/chat.json', import.meta.url), 'utf8'));
const tRu: PhaseTranslate = (key, values, fallback) => {
  const raw = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], ru);
  const template = typeof raw === 'string' ? raw : `MISSING:${key}|${fallback}`;
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(values?.[name] ?? ''));
};

const frame = (over: Partial<RunPhaseFrame>): RunPhaseFrame => ({
  kind: 'run_phase', sessionId: 's1', provider: 'claude', phase: 'waiting_helpers',
  since: '2026-11-23T16:02:00.000Z', background: { agents: 2, shells: 0 }, ...over,
});
const NOW = Date.parse('2026-11-23T16:49:00.000Z');

test('waiting for helpers: names how many and since when (Moscow clock)', () => {
  assert.equal(runPhaseLabel(frame({}), NOW, tRu, 'Europe/Moscow'), 'ждёт помощников: 2 · с 19:02');
});

test('parked: the turn is over, the background will bring the agent back', () => {
  const parked = frame({ phase: 'parked', background: { agents: 0, shells: 1 } });
  assert.equal(runPhaseLabel(parked, NOW, tRu, 'Europe/Moscow'), 'ход закончен · фон: 1 — агент вернётся сам');
});

test('a running turn, a missing frame and an unknown phase keep the old indicator', () => {
  assert.equal(runPhaseLabel(frame({ phase: 'running' }), NOW, tRu), null);
  assert.equal(runPhaseLabel(null, NOW, tRu), null);
  assert.equal(runPhaseLabel(frame({ phase: 'weird' as never }), NOW, tRu), null);
});

test('a broken start time falls back to now instead of printing garbage', () => {
  assert.equal(runPhaseLabel(frame({ since: 'oops' }), NOW, tRu, 'Europe/Moscow'), 'ждёт помощников: 2 · с 19:49');
});

test('between turns = any non-running phase; no frame = a turn in progress', () => {
  assert.equal(isBetweenTurns(frame({ phase: 'waiting_helpers' })), true);
  assert.equal(isBetweenTurns(frame({ phase: 'parked' })), true);
  assert.equal(isBetweenTurns(frame({ phase: 'running' })), false);
  assert.equal(isBetweenTurns(undefined), false);
});

test('«Стоп» that killed background tasks says how many; zero says nothing', () => {
  assert.equal(killedBackgroundLine({ agents: 1, shells: 2 }, tRu), 'Остановлено: фоновых задач убито 3, сами не продолжат');
  assert.equal(killedBackgroundLine({ agents: 0, shells: 0 }, tRu), null);
  assert.equal(killedBackgroundLine(undefined, tRu), null);
  assert.equal(killedBackgroundLine({ agents: 'x' } as never, tRu), null);
});

test('parseRunPhaseFrame accepts a wire frame and rejects junk', () => {
  const wire = { kind: 'run_phase', sessionId: 's1', provider: 'claude', phase: 'parked', since: '2026-11-23T16:02:00.000Z', background: { agents: 0, shells: 2 }, holdUntil: '2026-11-23T18:02:00.000Z', seq: 9 };
  const parsed = parseRunPhaseFrame(wire);
  assert.equal(parsed?.phase, 'parked');
  assert.deepEqual(parsed?.background, { agents: 0, shells: 2 });
  assert.equal(parsed?.holdUntil, '2026-11-23T18:02:00.000Z');

  assert.equal(parseRunPhaseFrame({ ...wire, phase: 'weird' }), null);
  assert.equal(parseRunPhaseFrame({ ...wire, sessionId: '' }), null);
  assert.equal(parseRunPhaseFrame(null), null);
  // Missing counts are zero, not a crash.
  assert.deepEqual(parseRunPhaseFrame({ ...wire, background: undefined })?.background, { agents: 0, shells: 0 });
});

test('between turns the open step (a lost tool_result) is dropped; a running phase leaves steps alone', () => {
  const waiting = activityPatchForPhase(frame({ phase: 'waiting_helpers' }));
  assert.equal(waiting.resetSteps, true);
  assert.deepEqual({ ...waiting.patch, phase: undefined }, { phase: undefined, step: null, activityKind: null, toolName: null });

  const running = activityPatchForPhase(frame({ phase: 'running' }));
  assert.equal(running.resetSteps, false);
  assert.equal('step' in running.patch, false);
});
