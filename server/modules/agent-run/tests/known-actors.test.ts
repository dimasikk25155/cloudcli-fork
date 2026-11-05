import assert from 'node:assert/strict';
import test from 'node:test';

import { KNOWN_ACTORS } from '@/modules/agent-run/index.js';

// «Конвейер» runs its items as `queue`: the audit feed must not fold them into `system`.
test('the queue is a known actor of unattended runs, next to schedules and the duet', () => {
  for (const actor of ['queue', 'schedule', 'duet', 'system']) {
    assert.ok(KNOWN_ACTORS.has(actor), actor);
  }
});
