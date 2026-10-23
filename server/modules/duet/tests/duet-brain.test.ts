import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBriefPrompt,
  guessProject,
  parseBriefReply,
  parseIdeasReply,
  parseOutcome,
} from '@/modules/duet/duet-brain.js';

test('parseBriefReply: JSON в ``` , чужие id и повторы отброшены', () => {
  const text = 'Вот:\n```json\n{"brief":"Всё **хорошо**","proposals":[{"serviceId":"a1","choice":"restart","why":"разовый сбой"},{"serviceId":"zz","choice":"fix"},{"serviceId":"a1","choice":"mute"},{"serviceId":"b2","choice":"delete"}]}\n```';
  const reply = parseBriefReply(text, new Set(['a1', 'b2']));
  assert.equal(reply.brief, 'Всё **хорошо**');
  assert.deepEqual(reply.proposals, [{ serviceId: 'a1', choice: 'restart', why: 'разовый сбой' }]);
});

test('parseBriefReply: не JSON — текст становится брифом, предложений нет', () => {
  const reply = parseBriefReply('Сегодня всё спокойно.', new Set());
  assert.equal(reply.brief, 'Сегодня всё спокойно.');
  assert.deepEqual(reply.proposals, []);
});

test('parseIdeasReply: максимум 3, без повторов старых, effort по умолчанию M', () => {
  const ideas = parseIdeasReply(JSON.stringify({
    ideas: [
      { title: 'Старая', why: 'x' },
      { title: 'Кнопка «повторить»', why: 'Чтобы не писать заново', effort: 'S' },
      { title: 'Без why' },
      { title: 'Пульс в панель', why: 'Видно, что жив', effort: 'XL' },
      { title: 'Три', why: 'a' },
      { title: 'Четыре', why: 'b' },
    ],
  }), ['старая']);
  assert.deepEqual(ideas.map((idea) => idea.title), ['Кнопка «повторить»', 'Пульс в панель', 'Три']);
  assert.equal(ideas[0].effort, 'S');
  assert.equal(ideas[1].effort, 'M');
});

test('parseOutcome: строка ИТОГ решает успех', () => {
  assert.deepEqual(parseOutcome('ИТОГ: ГОТОВО — перезапустил\nподробности'), { ok: true, summary: 'ГОТОВО — перезапустил' });
  assert.equal(parseOutcome('**ИТОГ: НЕ ВЫШЛО — нужен токен**').ok, false);
  assert.equal(parseOutcome('ИТОГ: НЕ НАДО — выключен намеренно').ok, true);
  assert.equal(parseOutcome('').ok, false);
});

test('guessProject: строго по имени юнита или первому слову подписи', () => {
  const projects = ['/p/Antigravity Project/insta-comments', '/p/Antigravity Project/Tyres', '/p/Antigravity Project/Tyres-7su', '/p/Antigravity Project/neo3-hub'];
  assert.equal(guessProject({ target: 'insta-comments-api.service', label: 'insta' }, projects), projects[0]);
  assert.equal(guessProject({ target: 'ru.neo3.tyres-wa-bot', label: 'tyres WA — прод' }, projects), projects[1]);
  assert.equal(guessProject({ target: 'neo3.service', label: 'neo3 — платформа' }, projects), null);
  assert.equal(guessProject({ target: 'xray.service', label: 'xray — VPN' }, projects), null);
});

test('buildBriefPrompt: только реальные id и отметка «не следим»', () => {
  const prompt = buildBriefPrompt({
    kind: 'morning',
    now: new Date('2026-10-23T05:30:00Z'),
    snapshot: {
      checkedAt: '2026-10-23T05:30:00Z',
      services: [
        { id: 'a1', machine: 'vps-nl', method: 'systemd', target: 'pulse-bot.service', crit: true, label: 'pulse-bot', status: 'down', since: '2026-10-22T05:30:00Z' },
      ],
    },
    muted: ['a1'],
    details: { a1: 'Main PID exited' },
    events: [],
    pending: [],
    ideas: [],
  });
  assert.match(prompt, /\[a1\]/);
  assert.match(prompt, /не следим/);
  assert.match(prompt, /Ответь ТОЛЬКО JSON/);
});
