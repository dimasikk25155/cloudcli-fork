import assert from 'node:assert/strict';
import test from 'node:test';

import { autoRelayBandMode, readAutoRelayStatus, shouldFollowMove, type AutoRelayStatus } from './autoRelayModel.js';

const base: AutoRelayStatus = { sessionId: 'a', enabled: true, state: null, childSessionId: null, childTitle: null, error: null };

test('the band reflects the server status of the auto-relay', () => {
  assert.equal(autoRelayBandMode(null), 'off');
  assert.equal(autoRelayBandMode({ ...base, enabled: false }), 'off');
  assert.equal(autoRelayBandMode(base), 'armed');
  assert.equal(autoRelayBandMode({ ...base, state: 'collecting' }), 'moving');
  assert.equal(autoRelayBandMode({ ...base, state: 'creating' }), 'moving');
  assert.equal(autoRelayBandMode({ ...base, state: 'done', childSessionId: 'b' }), 'moved');
  assert.equal(autoRelayBandMode({ ...base, enabled: false, state: 'failed', error: 'нет записки' }), 'failed');
});

test('the open tab follows only a move it watched finish', () => {
  const moving = { ...base, state: 'collecting' as const };
  const done = { ...base, state: 'done' as const, childSessionId: 'b' };
  assert.equal(shouldFollowMove(moving, done, 'a'), 'b');
  assert.equal(shouldFollowMove({ ...base, state: 'creating' }, done, 'a'), 'b');
  assert.equal(shouldFollowMove(moving, done, 'other'), null, 'another chat is open');
  assert.equal(shouldFollowMove(undefined, done, 'a'), null, 'opened after the move');
  assert.equal(shouldFollowMove(done, done, 'a'), null, 'already moved before');
  assert.equal(shouldFollowMove(moving, { ...base, state: 'failed', enabled: false }, 'a'), null);
});

test('only well-formed status bodies are read', () => {
  assert.equal(readAutoRelayStatus(null), null);
  assert.equal(readAutoRelayStatus({ enabled: true }), null);
  assert.deepEqual(readAutoRelayStatus({ sessionId: 'a', enabled: true, state: 'weird', childSessionId: '' }), base);
});
