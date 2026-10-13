import assert from 'node:assert/strict';
import test from 'node:test';

import { contextOccupancy, findHandoffAfterRequest, hasHumanMessageAfterRequest, isRelayRequestText, parseHandoffFile, relaySuggestion } from './relayRules.js';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const ago = (hours: number) => new Date(NOW - hours * HOUR).toISOString();

test('a young chat with little context shows no band', () => {
  const verdict = relaySuggestion({ usedTokens: 100_000, contextWindow: 1_000_000, createdAt: ago(1), now: NOW });
  assert.deepEqual(verdict, { show: false, reason: null });
});

test('half of the model window shows the band for context', () => {
  const at49 = relaySuggestion({ usedTokens: 98_000, contextWindow: 200_000, createdAt: ago(1), now: NOW });
  assert.equal(at49.show, false);
  const at50 = relaySuggestion({ usedTokens: 100_000, contextWindow: 200_000, createdAt: ago(1), now: NOW });
  assert.deepEqual(at50, { show: true, reason: 'context' });
});

test('400K tokens show the band even below half of a 1M window', () => {
  const below = relaySuggestion({ usedTokens: 399_999, contextWindow: 1_000_000, createdAt: ago(1), now: NOW });
  assert.equal(below.show, false);
  const at = relaySuggestion({ usedTokens: 400_000, contextWindow: 1_000_000, createdAt: ago(1), now: NOW });
  assert.deepEqual(at, { show: true, reason: 'context' });
});

test('400K tokens count even when the model window is unknown', () => {
  const verdict = relaySuggestion({ usedTokens: 450_000, contextWindow: null, createdAt: ago(1), now: NOW });
  assert.deepEqual(verdict, { show: true, reason: 'context' });
});

test('a chat older than 12 hours shows the band for age', () => {
  const young = relaySuggestion({ usedTokens: 0, contextWindow: 1_000_000, createdAt: ago(11.9), now: NOW });
  assert.equal(young.show, false);
  const old = relaySuggestion({ usedTokens: 0, contextWindow: 1_000_000, createdAt: ago(12), now: NOW });
  assert.deepEqual(old, { show: true, reason: 'age' });
});

test('unknown usage and age never show the band', () => {
  const verdict = relaySuggestion({ usedTokens: null, contextWindow: null, createdAt: null, now: NOW });
  assert.deepEqual(verdict, { show: false, reason: null });
});

test('"not now" at 55% hides the band until 65%', () => {
  const dismissed = { contextPercent: 55, usedTokens: 110_000, ageHours: 1 };
  const at64 = relaySuggestion({ usedTokens: 128_000, contextWindow: 200_000, createdAt: ago(2), now: NOW, dismissed });
  assert.equal(at64.show, false);
  const at65 = relaySuggestion({ usedTokens: 130_000, contextWindow: 200_000, createdAt: ago(2), now: NOW, dismissed });
  assert.deepEqual(at65, { show: true, reason: 'context' });
});

test('"not now" at 13 hours hides the band until 19 hours', () => {
  const dismissed = { contextPercent: 5, usedTokens: 10_000, ageHours: 13 };
  const at18 = relaySuggestion({ usedTokens: 10_000, contextWindow: 200_000, createdAt: ago(18.9), now: NOW, dismissed });
  assert.equal(at18.show, false);
  const at19 = relaySuggestion({ usedTokens: 10_000, contextWindow: 200_000, createdAt: ago(19), now: NOW, dismissed });
  assert.deepEqual(at19, { show: true, reason: 'age' });
});

test('dismissing for age does not postpone the first context threshold', () => {
  const dismissed = { contextPercent: 10, usedTokens: 20_000, ageHours: 13 };
  const verdict = relaySuggestion({ usedTokens: 100_000, contextWindow: 200_000, createdAt: ago(14), now: NOW, dismissed });
  assert.deepEqual(verdict, { show: true, reason: 'context' });
});

test('dismissing for context does not postpone the first age threshold', () => {
  const dismissed = { contextPercent: 60, usedTokens: 120_000, ageHours: 2 };
  const verdict = relaySuggestion({ usedTokens: 120_000, contextWindow: 200_000, createdAt: ago(12), now: NOW, dismissed });
  assert.deepEqual(verdict, { show: true, reason: 'age' });
});

test('the handoff path is read from the HANDOFF_FILE line', () => {
  const reply = 'Записка готова.\nНовая сессия → выполни её.\nHANDOFF_FILE: docs/handoff/2026-10-12-1200-relay.md';
  assert.equal(parseHandoffFile(reply), 'docs/handoff/2026-10-12-1200-relay.md');
});

test('no HANDOFF_FILE line means no path', () => {
  assert.equal(parseHandoffFile('Записка готова: docs/handoff/x.md'), null);
  assert.equal(parseHandoffFile('HANDOFF_FILE:   '), null);
  assert.equal(parseHandoffFile(''), null);
});

test('several HANDOFF_FILE lines — the last one wins', () => {
  const reply = [
    'Пример формата: HANDOFF_FILE: <путь>',
    'HANDOFF_FILE: docs/handoff/old.md',
    'Переписал записку.',
    'HANDOFF_FILE: docs/handoff/new.md',
  ].join('\n');
  assert.equal(parseHandoffFile(reply), 'docs/handoff/new.md');
});

test('a path with spaces is kept whole', () => {
  const reply = 'HANDOFF_FILE: /Users/dimasik/Antigravity Project/claude agent/docs/handoff/2026-10-12 relay.md';
  assert.equal(parseHandoffFile(reply), '/Users/dimasik/Antigravity Project/claude agent/docs/handoff/2026-10-12 relay.md');
});

test('markdown dressing around the line or the path is dropped', () => {
  assert.equal(parseHandoffFile('`HANDOFF_FILE: docs/handoff/a b.md`'), 'docs/handoff/a b.md');
  assert.equal(parseHandoffFile('**HANDOFF_FILE:** `docs/handoff/c.md`'), 'docs/handoff/c.md');
  assert.equal(parseHandoffFile('HANDOFF_FILE: "docs/handoff/d.md"\r\n'), 'docs/handoff/d.md');
});

test('the band reads the latest context occupancy, not the spend so far', () => {
  // A long chat: 900K tokens billed in total, but only 120K sit in the 1M window now.
  const usage = { used: 120_000, total: 1_000_000, inputTokens: 850_000, outputTokens: 50_000 };
  const verdict = relaySuggestion({ usedTokens: contextOccupancy(usage), contextWindow: 1_000_000, createdAt: ago(1), now: NOW });
  assert.deepEqual(verdict, { show: false, reason: null });
});

test('the denominator is the model window, not a smaller runtime limit', () => {
  // 300K of a 1M model is 30%, even if the runtime reports a 400K session limit.
  const usage = { used: 300_000, total: 400_000 };
  const verdict = relaySuggestion({ usedTokens: contextOccupancy(usage), contextWindow: 1_000_000, createdAt: ago(1), now: NOW });
  assert.equal(verdict.show, false);
});

test('unknown occupancy is not mistaken for zero or for the spend', () => {
  assert.equal(contextOccupancy({ inputTokens: 500_000, outputTokens: 10_000 }), null);
  assert.equal(contextOccupancy(null), null);
  assert.equal(contextOccupancy({ used: 450_000 }), 450_000);
});

test('custom thresholds replace only what they name (the server live-check hook)', () => {
  const thresholds = { contextPercent: 50, contextTokens: 3000, ageHours: 12 };
  assert.deepEqual(relaySuggestion({ usedTokens: 3000, contextWindow: 1_000_000, createdAt: ago(1), now: NOW }, thresholds), { show: true, reason: 'context' });
  assert.equal(relaySuggestion({ usedTokens: 2999, contextWindow: 1_000_000, createdAt: ago(1), now: NOW }, thresholds).show, false);
});

test('a relay request is recognised by its tagged first line, a mention is not', () => {
  assert.equal(isRelayRequestText('Переносим работу в новый чат (эстафета x1y2).\nСобери…'), true);
  assert.equal(isRelayRequestText('Давай потом перенесём работу в новый чат'), false);
  assert.equal(isRelayRequestText(undefined), false);
});

test('the note is taken from the answer after the tagged request only', () => {
  const messages = [
    { kind: 'text', role: 'assistant', content: 'HANDOFF_FILE: docs/handoff/old.md' },
    { kind: 'text', role: 'user', content: 'Переносим работу в новый чат (эстафета ab12).' },
    { kind: 'tool_use', role: 'assistant', content: 'HANDOFF_FILE: docs/handoff/tool.md' },
    { kind: 'text', role: 'assistant', content: 'Готово.\nHANDOFF_FILE: docs/handoff/new.md' },
    { kind: 'text', role: 'assistant', content: 'Если что — спрашивай.' },
  ];
  assert.equal(findHandoffAfterRequest(messages, 'эстафета ab12'), 'docs/handoff/new.md');
  assert.equal(findHandoffAfterRequest(messages, 'эстафета zz99'), null);
  assert.equal(findHandoffAfterRequest(messages.slice(0, 3), 'эстафета ab12'), null);
});

test('a note line counts only when no person wrote between the request and it', () => {
  const request = { kind: 'text', role: 'user', content: 'Переносим работу в новый чат (эстафета ab12).' };
  const note = { kind: 'text', role: 'assistant', content: 'HANDOFF_FILE: docs/handoff/new.md' };
  assert.equal(findHandoffAfterRequest([request, note], 'эстафета ab12'), 'docs/handoff/new.md');
  assert.equal(findHandoffAfterRequest([request, { kind: 'text', role: 'user', content: 'Стоп, а цены?' }, note], 'эстафета ab12'), null);
  // The CLI's own nudge and hook follow-ups are not a person.
  const nudge = { kind: 'text', role: 'user', content: '[Your previous response had no visible output. Please continue.]' };
  const hook = { kind: 'text', role: 'user', content: 'Stop hook feedback: keep going' };
  assert.equal(findHandoffAfterRequest([request, nudge, hook, note], 'эстафета ab12'), 'docs/handoff/new.md');
  assert.equal(hasHumanMessageAfterRequest([request, nudge, note], 'эстафета ab12'), false);
  assert.equal(hasHumanMessageAfterRequest([request, note, { kind: 'text', role: 'user', content: 'ещё' }], 'эстафета ab12'), true);
});
