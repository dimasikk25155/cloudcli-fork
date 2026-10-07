import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldStoreRefreshedToken } from './refreshedToken.js';

const NOW = 1_791_300_000;

const jwtWith = (claims: Record<string, number>): string =>
  `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;

const current = jwtWith({ iat: NOW - 60, exp: NOW - 60 + 7 * 86400 });

test('a live, newer refreshed token replaces the current one', () => {
  const fresh = jwtWith({ iat: NOW, exp: NOW + 7 * 86400 });
  assert.equal(shouldStoreRefreshedToken(fresh, current, NOW), true);
});

test('an expired token replayed from the HTTP cache is ignored', () => {
  const replayed = jwtWith({ iat: NOW - 8 * 86400, exp: NOW - 86400 });
  assert.equal(shouldStoreRefreshedToken(replayed, current, NOW), false);
});

test('a live but older token never overwrites a fresh login', () => {
  const older = jwtWith({ iat: NOW - 3600, exp: NOW + 86400 });
  assert.equal(shouldStoreRefreshedToken(older, current, NOW), false);
});

test('malformed headers and missing tokens are ignored', () => {
  assert.equal(shouldStoreRefreshedToken(null, current, NOW), false);
  assert.equal(shouldStoreRefreshedToken('not-a-jwt', current, NOW), false);
  assert.equal(shouldStoreRefreshedToken('a.%%%.c', current, NOW), false);
});

test('with no current token a live refreshed token is accepted', () => {
  const fresh = jwtWith({ iat: NOW, exp: NOW + 86400 });
  assert.equal(shouldStoreRefreshedToken(fresh, null, NOW), true);
});
