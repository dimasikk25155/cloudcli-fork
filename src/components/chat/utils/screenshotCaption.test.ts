import assert from 'node:assert/strict';
import test from 'node:test';

import { visibleUserText } from './catalogBrief.js';
import { buildScreenshotCaption, withScreenshotContext } from './screenshotCaption.js';

// Local wall-clock time, so the expectation holds in any test-runner timezone.
const at = new Date(2026, 9, 12, 14, 5);

test('caption of a pasted screenshot names the file, origin, time, project and chat', () => {
  const caption = buildScreenshotCaption({
    fileName: 'image.png',
    source: 'paste',
    attachedAt: at,
    projectName: 'Tyres',
    sessionName: 'Галерея шин',
  });
  assert.equal(
    caption,
    'скриншот image.png, вставлен из буфера, 12.10.2026 14:05; прикреплён в Neo3: проект Tyres, чат «Галерея шин»',
  );
});

test('a picture attached before the chat exists says it is a new chat', () => {
  const caption = buildScreenshotCaption({
    fileName: 'image.png',
    source: 'paste',
    attachedAt: at,
    projectName: 'Tyres',
    sessionName: null,
  });
  assert.equal(
    caption,
    'скриншот image.png, вставлен из буфера, 12.10.2026 14:05; прикреплён в Neo3: проект Tyres, новый чат',
  );
});

test('a chosen file with a page address and markup says so', () => {
  const caption = buildScreenshotCaption({
    fileName: 'checkout.jpg',
    source: 'file',
    attachedAt: at,
    projectName: 'Forel',
    sessionName: 'Корзина',
    pageUrl: 'https://forel.example/cart?step=2',
    edited: true,
  });
  assert.equal(
    caption,
    'скриншот checkout.jpg, выбран файл, 12.10.2026 14:05; прикреплён в Neo3: проект Forel, чат «Корзина»; '
      + 'адрес страницы: https://forel.example/cart?step=2; на картинке пометки пользователя',
  );
});

test('a secret in the page address never reaches the caption', () => {
  const token = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
  const caption = buildScreenshotCaption({
    fileName: 'a.png',
    source: 'paste',
    attachedAt: at,
    pageUrl: `https://site.example/admin?token=${token}#x`,
  });
  assert.ok(!caption.includes(token), caption);
  assert.ok(caption.includes('адрес страницы: https://site.example/admin'), caption);
});

test('only web addresses are quoted as the page', () => {
  const caption = buildScreenshotCaption({
    fileName: 'a.png',
    source: 'paste',
    attachedAt: at,
    pageUrl: 'javascript:alert(1)',
  });
  assert.ok(!caption.includes('адрес страницы'), caption);
});

test('missing project and time leave no empty fragments', () => {
  assert.equal(
    buildScreenshotCaption({ fileName: 'x.png', source: 'drop', attachedAt: 'not a date' }),
    'скриншот x.png, перетащен в окно',
  );
});

test('captions ride along for the agent but the bubble shows only what was typed', () => {
  const captions = ['скриншот a.png, вставлен из буфера', 'скриншот b.png, выбран файл'];
  const sent = withScreenshotContext('почини кнопку', captions);
  for (const caption of captions) {
    assert.ok(sent.includes(caption), sent);
  }
  assert.ok(sent.startsWith('почини кнопку'), 'typed text stays first, so titles come from it');
  assert.equal(visibleUserText(sent), 'почини кнопку');
});

test('no captions leave the message untouched', () => {
  assert.equal(withScreenshotContext('привет', []), 'привет');
});
