import assert from 'node:assert/strict';
import test from 'node:test';

import { planDownscale, MAX_IMAGE_EDGE } from './imageDownscale.js';

test('a phone camera shot is shrunk to the long-edge limit', () => {
  // The exact file that kept arriving truncated: 4096x3072, ~4 MB.
  const plan = planDownscale({ type: 'image/jpeg', size: 4_000_000 }, 4096, 3072);
  assert.equal(plan.downscale, true);
  assert.ok(plan.downscale && Math.max(plan.width, plan.height) === MAX_IMAGE_EDGE);
  assert.ok(plan.downscale && plan.height === Math.round(3072 * (MAX_IMAGE_EDGE / 4096)));
});

test('a small screenshot is left alone', () => {
  assert.deepEqual(planDownscale({ type: 'image/png', size: 120_000 }, 1200, 800), { downscale: false });
});

test('a big-but-small-enough picture is still re-encoded when heavy', () => {
  const plan = planDownscale({ type: 'image/jpeg', size: 3_000_000 }, 1000, 800);
  // Under the edge limit, so dimensions stay — but the re-encode drops weight.
  assert.deepEqual(plan, { downscale: true, width: 1000, height: 800, type: 'image/jpeg' });
});

test('PNG keeps its type so transparency survives', () => {
  const plan = planDownscale({ type: 'image/png', size: 5_000_000 }, 3000, 2000);
  assert.ok(plan.downscale && plan.type === 'image/png');
});

test('non-re-encodable attachments are never touched', () => {
  assert.deepEqual(planDownscale({ type: 'image/gif', size: 9_000_000 }, 4000, 4000), { downscale: false });
  assert.deepEqual(planDownscale({ type: 'application/pdf', size: 9_000_000 }, 0, 0), { downscale: false });
});
