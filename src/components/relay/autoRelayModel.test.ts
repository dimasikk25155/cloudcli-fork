import assert from 'node:assert/strict';
import test from 'node:test';

import {
  autoRelayBandMode,
  createAutoRelayStatusStore,
  createMoveFollower,
  readAutoRelayStatus,
  shouldFollowMove,
  type AutoRelayStatus,
} from './autoRelayModel.js';

const base: AutoRelayStatus = { sessionId: 'a', enabled: true, state: null, childSessionId: null, childTitle: null, error: null, manual: false };

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

// R06: «Перенести» from the limits card. Two subscribers share the status store
// (the relay band with the real onMoved, the card that ignores it); whichever
// gets the frame first, the band still follows the chat to its continuation.
for (const order of [['band', 'card'], ['card', 'band']] as const) {
  test(`two subscribers: the band follows the move when the ${order[0]} gets frames first`, () => {
    const store = createAutoRelayStatusStore();
    const followers = { band: createMoveFollower(store), card: createMoveFollower(store) };
    const moved: Record<string, string[]> = { band: [], card: [] };

    // Both loaded the armed status on mount; the card pressed «Перенести».
    followers.band.note(base);
    followers.card.note(base);
    followers.card.note({ ...base, state: 'collecting', manual: true });

    const frames: AutoRelayStatus[] = [
      { ...base, state: 'collecting', manual: true },
      { ...base, state: 'creating', manual: true },
      { ...base, state: 'done', childSessionId: 'b', manual: true },
    ];
    for (const frame of frames) {
      for (const who of order) {
        const child = followers[who].frame(frame, 'a');
        if (child) moved[who].push(child);
      }
    }

    assert.deepEqual(moved.band, ['b']);
    assert.equal(store.get('a')?.state, 'done');
  });
}

test('a subscriber that only saw the finished move does not follow it', () => {
  const store = createAutoRelayStatusStore();
  const late = createMoveFollower(store);
  late.note({ ...base, state: 'done', childSessionId: 'b' });
  assert.equal(late.frame({ ...base, state: 'done', childSessionId: 'b' }, 'a'), null);
});
