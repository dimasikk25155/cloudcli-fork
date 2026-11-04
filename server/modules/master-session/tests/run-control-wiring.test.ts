import assert from 'node:assert/strict';
import test from 'node:test';

import { setMasterSessionRunControl } from '@/modules/master-session/index.js';
import { createBtwService } from '@/modules/session-links/index.js';

test('master-session and btw accept an explicit run control', () => {
  const starts: unknown[] = [];
  const control = { start: (input: unknown) => (starts.push(input), true) };
  assert.doesNotThrow(() => setMasterSessionRunControl(control as never));
  const btw = createBtwService();
  assert.doesNotThrow(() => btw.setRunControl(control as never));
  assert.equal(typeof btw.start, 'function');
});

test('server/index.js wires both run controls explicitly', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../../../index.js', import.meta.url), 'utf8');
  assert.match(src, /btwService\.setRunControl\(createAutoRelayRunControl\(chatDependencies\)\)/);
  assert.match(src, /setMasterSessionRunControl\(createThreadRunControl\(chatDependencies\)\)/);
});
