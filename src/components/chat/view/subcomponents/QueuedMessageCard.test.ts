import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import QueuedMessageCard from './QueuedMessageCard';

const render = (props: Partial<Parameters<typeof QueuedMessageCard>[0]>) =>
  renderToStaticMarkup(React.createElement(QueuedMessageCard, { content: 'Привет', onEdit: () => {}, onDelete: () => {}, onSendNow: () => {}, canSendNow: true, ...props }));

test('a held message shows why it is held instead of «will send when this finishes»', () => {
  const html = render({ holdLabel: 'Агент ждёт твоего ответа' });
  assert.match(html, /Агент ждёт твоего ответа/);
  assert.doesNotMatch(html, /Will send when this finishes/);
  assert.match(html, /aria-label="Send"/);
});

test('a message that goes out by itself keeps the old line and the old button', () => {
  const html = render({ holdLabel: null });
  assert.match(html, /Will send when this finishes/);
  assert.match(html, /Stop and send now/);
});
