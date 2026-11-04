import assert from 'node:assert/strict';
import test from 'node:test';

import { describeChange, profileKeyLabel, profileValueLabel } from './profileModel';

test('changes read as «name: was → will be» with words for switches', () => {
  assert.equal(describeChange({ key: 'showThinking', from: true, to: false }), 'Показывать размышления: включено → выключено');
  assert.equal(describeChange({ key: 'theme', from: null, to: 'glass' }), 'Тема: не задано → glass');
});

test('a mod key shows the title of its card and an unknown key stays as it is', () => {
  assert.equal(profileKeyLabel('modGroups'), 'Группы и закрепы');
  assert.equal(profileKeyLabel('somethingNew'), 'somethingNew');
  assert.equal(profileValueLabel(120), '120');
});
