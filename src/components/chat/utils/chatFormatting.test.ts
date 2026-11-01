import assert from 'node:assert/strict';
import test from 'node:test';

import { isStopHookFeedbackText, stripAttachmentDisplayTags, normalizeAssistantSignature } from './chatFormatting.js';

test('assistant signature is a separate final paragraph even with text after it', () => {
  const stamp = '🕐 2026-11-01 23:23 МСК · ✉️ #9';
  assert.equal(normalizeAssistantSignature(`Ответ. ${stamp}\n\nЕщё пояснение.`), `Ответ. \n\nЕщё пояснение.\n\n${stamp}`);
  assert.equal(normalizeAssistantSignature(`Ответ.\n\n${stamp}`), `Ответ.\n\n${stamp}`);
  assert.equal(normalizeAssistantSignature(`Пример: \`${stamp}\`\n\n\`\`\`\n${stamp}\n\`\`\``), `Пример: \`${stamp}\`\n\n\`\`\`\n${stamp}\n\`\`\``);
  assert.equal(normalizeAssistantSignature('Без подписи.'), 'Без подписи.');
  assert.equal(normalizeAssistantSignature(`Ответ. ${stamp}`, '2026-11-01T20:29:00Z'), 'Ответ.\n\n🕐 2026-11-01 23:29 МСК · ✉️ #9');
  assert.equal(normalizeAssistantSignature('Ответ.', '2026-11-01T20:29:00Z', 10), 'Ответ.\n\n🕐 2026-11-01 23:29 МСК · ✉️ #10');
});

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
