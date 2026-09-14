import assert from 'node:assert/strict';
import test from 'node:test';

import { isStopHookFeedbackText, stripAttachmentDisplayTags } from './chatFormatting.js';

test('stripAttachmentDisplayTags removes the visible-image path block from a user bubble', () => {
  const content = [
    'ты что на приколе? ты сам себя прерываешь',
    '',
    '<images_input>',
    'The user attached 1 image(s) to this message; you can already see them, so there is no need to read the files to know their contents.',
    '1. /home/agents/.cloudcli/assets/shot.png (original name: image.png)',
    '</images_input>',
  ].join('\n');

  assert.equal(stripAttachmentDisplayTags(content), 'ты что на приколе? ты сам себя прерываешь');
});

test('stripAttachmentDisplayTags leaves ordinary user text alone', () => {
  assert.equal(stripAttachmentDisplayTags('просто текст'), 'просто текст');
});

test('isStopHookFeedbackText hides native Grok Stop-hook rows', () => {
  assert.equal(
    isStopHookFeedbackText('Stop hook feedback:\n- Перед завершением сессии примени навык obsidian-memory.'),
    true,
  );
  assert.equal(
    isStopHookFeedbackText('This is an automatic follow-up from a session Stop hook, not a user message.'),
    true,
  );
  assert.equal(isStopHookFeedbackText('все верно я для вотсап вставил?'), false);
});
