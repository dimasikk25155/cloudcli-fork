import assert from 'node:assert/strict';
import test from 'node:test';

import { expandChatPath, rememberChatPath, resetChatPathMemory } from './chatPathMemory.js';

const FULL = '/Users/dimasik/Antigravity Project/voice-messages/samples/master-shina/ru.ogg';

test('голое имя открывает файл, полный путь к которому уже звучал в этом чате', () => {
  resetChatPathMemory();
  rememberChatPath('chat-1', FULL);
  assert.equal(expandChatPath('chat-1', 'ru.ogg'), FULL);
  assert.equal(expandChatPath('chat-1', 'RU.ogg'), FULL);
});

test('другой чат не получает чужой файл с тем же именем', () => {
  resetChatPathMemory();
  rememberChatPath('chat-1', FULL);
  assert.equal(expandChatPath('chat-2', 'ru.ogg'), 'ru.ogg');
});

test('путь с папками и незнакомое имя не трогаются', () => {
  resetChatPathMemory();
  rememberChatPath('chat-1', FULL);
  assert.equal(expandChatPath('chat-1', 'docs/ru.ogg'), 'docs/ru.ogg');
  assert.equal(expandChatPath('chat-1', 'pl.ogg'), 'pl.ogg');
});

test('относительные пути не запоминаются, позднее упоминание побеждает', () => {
  resetChatPathMemory();
  rememberChatPath('chat-1', 'samples/ru.ogg');
  assert.equal(expandChatPath('chat-1', 'ru.ogg'), 'ru.ogg');
  rememberChatPath('chat-1', FULL);
  rememberChatPath('chat-1', '~/other/ru.ogg');
  assert.equal(expandChatPath('chat-1', 'ru.ogg'), '~/other/ru.ogg');
});

test('без чата в адресе работает общая область', () => {
  resetChatPathMemory();
  rememberChatPath(undefined, FULL);
  assert.equal(expandChatPath(null, 'ru.ogg'), FULL);
});
