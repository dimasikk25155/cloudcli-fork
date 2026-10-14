import assert from 'node:assert/strict';
import test from 'node:test';

import { attentionCountShown, attentionStatusesNeeded } from './attentionMods.js';

// «Ждут тебя» off hides what the person sees; the session statuses still load
// while «Треды» or «Таймер кэша» read them (spec, история 16).

test('«(N)» in the tab and the icon badge show the count only while «Ждут тебя» is on', () => {
  assert.equal(attentionCountShown(3, true), 3);
  assert.equal(attentionCountShown(3, false), 0);
  assert.equal(attentionCountShown(0, true), 0);
});

test('statuses keep loading for threads or the cache timer and stop only when nobody reads them', () => {
  assert.equal(attentionStatusesNeeded({ attention: true, threads: false, cacheTimer: false }), true);
  assert.equal(attentionStatusesNeeded({ attention: false, threads: true, cacheTimer: false }), true);
  assert.equal(attentionStatusesNeeded({ attention: false, threads: false, cacheTimer: true }), true);
  assert.equal(attentionStatusesNeeded({ attention: false, threads: false, cacheTimer: false }), false);
});
