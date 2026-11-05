import assert from 'node:assert/strict';
import test from 'node:test';

import { agentLabel } from './agentLabel.js';

test('чат агента помечается его именем; обычный чат и пустое имя — без метки', () => {
  assert.equal(agentLabel('Художник'), 'агент: Художник');
  assert.equal(agentLabel('  Критик '), 'агент: Критик');
  assert.equal(agentLabel(undefined), null);
  assert.equal(agentLabel('   '), null);
  assert.equal(agentLabel(42), null);
});
