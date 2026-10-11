import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { AttentionItem } from '../types';

import AttentionHubView from './AttentionHubView';
import AttentionStatusDot from './AttentionStatusDot';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');

function item(overrides: Partial<AttentionItem>): AttentionItem {
  return {
    sessionId: 's',
    projectId: 'p1',
    projectName: 'neo3',
    provider: 'claude',
    title: null,
    state: 'done',
    reason: null,
    detail: null,
    updatedAt: '2026-10-12T11:50:00.000Z',
    unread: false,
    ...overrides,
  };
}

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

function classOf(html: string): string {
  return /class="([^"]*)"/.exec(html)?.[1] ?? '';
}

test('sidebar dot: «ждёт» and «готово» differ in colour and caption (R09)', () => {
  const waiting = render(React.createElement(AttentionStatusDot, { item: item({ state: 'waiting', reason: 'ask' }) }));
  const done = render(React.createElement(AttentionStatusDot, { item: item({ state: 'done', unread: true }) }));

  assert.match(waiting, /aria-label="Ждёт ответа: вопрос"/);
  assert.match(waiting, /title="Ждёт ответа: вопрос"/);
  assert.match(done, /aria-label="Готово"/);
  assert.notEqual(classOf(waiting), classOf(done));
});

test('hub: groups with project, engine, title, wait time and the question (R13, R13.1)', () => {
  const html = render(React.createElement(AttentionHubView, {
    items: [
      item({
        sessionId: 'w',
        state: 'waiting',
        reason: 'ask',
        projectName: 'tyres',
        provider: 'grok',
        title: 'Деплой каталога',
        updatedAt: '2026-10-12T11:47:00.000Z',
        detail: { question: 'Какой вариант деплоя выбрать?' },
      }),
      item({ sessionId: 'd', state: 'done', unread: true, title: 'Чистка логов' }),
    ],
    nowMs: NOW,
    onOpenSession: () => {},
    onMarkAllSeen: () => {},
    // The app passes the sidebar's i18n label lookup; here a stand-in source.
    getProviderLabel: (provider: string) => ({ grok: 'Grok (xAI)' } as Record<string, string>)[provider] ?? provider,
  }));

  assert.ok(html.indexOf('Ждут ответа') < html.indexOf('Готово'));
  assert.match(html, /tyres/);
  assert.match(html, /Grok \(xAI\)/);
  assert.match(html, /Деплой каталога/);
  assert.match(html, /ждёт 13 мин/);
  assert.match(html, /Какой вариант деплоя выбрать\?/);
  assert.match(html, /Всё просмотрено/);
  assert.doesNotMatch(html, /Никто тебя не ждёт/);
});

test('hub: empty state says «Никто тебя не ждёт» and hides «Всё просмотрено» (R13.2)', () => {
  const html = render(React.createElement(AttentionHubView, {
    items: [item({ state: 'done', unread: false })],
    nowMs: NOW,
    onOpenSession: () => {},
    onMarkAllSeen: () => {},
  }));
  assert.match(html, /Никто тебя не ждёт/);
  assert.doesNotMatch(html, /Всё просмотрено/);
});

test('hub: extra sections slot renders after the status groups (place for «Заметки в вольт»)', () => {
  const html = render(React.createElement(AttentionHubView, {
    items: [item({ sessionId: 'w', state: 'waiting', reason: 'plan' })],
    nowMs: NOW,
    onOpenSession: () => {},
    onMarkAllSeen: () => {},
    extraSections: [{ id: 'vault-notes', title: 'Заметки в вольт', render: () => React.createElement('p', null, 'черновик заметки') }],
  }));
  assert.ok(html.indexOf('Ждут ответа') < html.indexOf('Заметки в вольт'));
  assert.match(html, /черновик заметки/);
});
