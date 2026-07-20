import assert from 'node:assert/strict';
import test from 'node:test';

import jwt from 'jsonwebtoken';

// The auth middleware reads its signing secret at *module-load* time:
//   const JWT_SECRET = process.env.JWT_SECRET || appConfigDb.getOrCreateJwtSecret();
// Setting JWT_SECRET here (before the module is imported) short-circuits the
// `||`, so the module never touches the database. ESM static imports are hoisted
// and would run before this assignment, so the module is pulled in via a dynamic
// import *after* the env is in place.
const TEST_JWT_SECRET = 'test-secret-0123456789-abcdef-do-not-use-in-prod';
process.env.JWT_SECRET = TEST_JWT_SECRET;

const { generateToken, authenticateWebSocket, JWT_SECRET } = await import(
  '@/middleware/auth.js'
);

// Runs `fn` with console.error muted. The invalid-token paths log internally;
// muting keeps the intent (a rejected token) obvious in the test output.
function withSilentConsoleError(fn: () => void): void {
  const original = console.error;
  console.error = () => {};
  try {
    fn();
  } finally {
    console.error = original;
  }
}

// --- generateToken: the token is what identifies *which* user a request is for,
// so a single-user -> multi-user refactor must preserve this payload contract. ---

test('generateToken embeds userId + username and round-trips through jwt.verify', () => {
  const token = generateToken({ id: 42, username: 'alice' });

  const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
  assert.equal(decoded.userId, 42);
  assert.equal(decoded.username, 'alice');
});

test('generateToken tokens are signed with the module JWT_SECRET (env override honored)', () => {
  // The exported secret must equal the env override, not a random per-install one.
  assert.equal(JWT_SECRET, TEST_JWT_SECRET);

  const token = generateToken({ id: 1, username: 'bob' });
  // Verifiable with the module secret...
  assert.doesNotThrow(() => jwt.verify(token, JWT_SECRET));
  // ...and rejected under any other secret.
  assert.throws(() => jwt.verify(token, 'some-other-secret'), /invalid signature/);
});

test('generateToken issues a 7-day token (exp - iat === 7 days)', () => {
  const decoded = jwt.verify(
    generateToken({ id: 7, username: 'carol' }),
    JWT_SECRET,
  ) as jwt.JwtPayload;

  assert.ok(typeof decoded.iat === 'number' && typeof decoded.exp === 'number');
  assert.equal(decoded.exp! - decoded.iat!, 7 * 24 * 60 * 60);
});

test('generateToken produces per-user tokens carrying distinct identities', () => {
  const a = jwt.verify(generateToken({ id: 1, username: 'alice' }), JWT_SECRET) as jwt.JwtPayload;
  const b = jwt.verify(generateToken({ id: 2, username: 'bob' }), JWT_SECRET) as jwt.JwtPayload;

  assert.equal(a.userId, 1);
  assert.equal(b.userId, 2);
  assert.notEqual(a.userId, b.userId);
  // The multi-user guarantee: a token minted for one user never resolves to another.
  assert.notEqual(a.username, b.username);
});

// --- authenticateWebSocket: in OSS (non-platform) mode these inputs are rejected
// by jwt.verify *before* any user lookup, so they exercise pure, DB-free logic. ---

test('authenticateWebSocket returns null when no token is supplied', () => {
  assert.equal(authenticateWebSocket(null), null);
  assert.equal(authenticateWebSocket(undefined), null);
  assert.equal(authenticateWebSocket(''), null);
});

test('authenticateWebSocket returns null for a malformed token', () => {
  withSilentConsoleError(() => {
    assert.equal(authenticateWebSocket('not-a-real-jwt'), null);
  });
});

test('authenticateWebSocket returns null for a token signed with a foreign secret', () => {
  const foreign = jwt.sign({ userId: 1, username: 'mallory' }, 'a-different-secret');
  withSilentConsoleError(() => {
    assert.equal(authenticateWebSocket(foreign), null);
  });
});
