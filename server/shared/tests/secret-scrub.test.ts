import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEnvDenylist, containsSecret, scrubSecrets } from '@/shared/secret-scrub.js';

// Written against the shapes actually found on disk: a scan of 25 recent
// session transcripts turned up 11 GitHub tokens in plain text and 30
// `token|secret|password = <value>` assignments.

test('an empty or non-string input is safe', () => {
  assert.equal(scrubSecrets(null).text, '');
  assert.equal(scrubSecrets(undefined).text, '');
  assert.equal(scrubSecrets('').text, '');
  assert.deepEqual(scrubSecrets(null).hits, []);
});

test('ordinary text passes through untouched', () => {
  const input = 'Запусти тесты и покажи, что упало.';
  const result = scrubSecrets(input);

  assert.equal(result.text, input);
  assert.equal(result.hits.length, 0);
});

const SAMPLES: Array<{ kind: string; text: string; secret: string }> = [
  {
    kind: 'anthropic',
    secret: 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
    text: 'export ANTHROPIC_KEY=sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
  },
  {
    kind: 'github',
    secret: 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
    text: 'git remote set-url origin https://ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789@github.com/x/y',
  },
  {
    kind: 'aws',
    secret: 'AKIAIOSFODNN7EXAMPLE',
    text: 'AWS_ACCESS_KEY_ID вот такой: AKIAIOSFODNN7EXAMPLE',
  },
  {
    kind: 'slack',
    secret: 'xoxb-123456789012-abcdefghijkl',
    text: 'slack bot token xoxb-123456789012-abcdefghijkl',
  },
  {
    kind: 'telegram',
    secret: '123456789:AAHrandomlookingtokenvaluewithlength',
    text: 'curl https://api.telegram.org/bot123456789:AAHrandomlookingtokenvaluewithlength/getMe',
  },
];

for (const sample of SAMPLES) {
  test(`${sample.kind} credentials are removed`, () => {
    const result = scrubSecrets(sample.text);

    assert.ok(!result.text.includes(sample.secret), `secret survived: ${result.text}`);
    assert.ok(result.text.includes('REDACTED'), 'a placeholder should mark the removal');
    assert.ok(result.hits.length > 0);
  });
}

test('a private key block is removed whole', () => {
  const text = [
    'ключ ниже:',
    '-----BEGIN RSA PRIVATE KEY-----',
    'MIIEowIBAAKCAQEA1234567890abcdef',
    'abcdefghijklmnopqrstuvwxyz012345',
    '-----END RSA PRIVATE KEY-----',
    'конец',
  ].join('\n');

  const result = scrubSecrets(text);

  assert.ok(!result.text.includes('MIIEowIBAAKCAQEA'));
  assert.ok(result.text.includes('конец'), 'surrounding text survives');
});

test('credentials in a URL lose the password but keep the host', () => {
  const result = scrubSecrets('postgres://admin:sUpErSeCrEtValue@db.internal:5432/app');

  assert.ok(!result.text.includes('sUpErSeCrEtValue'));
  assert.ok(result.text.includes('db.internal'), 'the host is diagnostic, not secret');
});

test('an assignment keeps the key name and drops the value', () => {
  const result = scrubSecrets('DOLPHIN_TOKEN = "abcdefghijklmnopqrst"');

  assert.ok(result.text.includes('DOLPHIN_TOKEN'), 'knowing which key leaked is useful');
  assert.ok(!result.text.includes('abcdefghijklmnopqrst'));
});

test('short assignments are left alone', () => {
  // Otherwise `PORT=3001` and `password: no` get mangled and the text becomes
  // unreadable for no safety gain.
  const result = scrubSecrets('PORT=3001 и password: no');

  assert.ok(result.text.includes('3001'));
});

test('the same secret always produces the same placeholder', () => {
  const secret = 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
  const result = scrubSecrets(`сначала ${secret}, потом снова ${secret}`);

  const placeholders = result.text.match(/«REDACTED:[^»]+»/g) ?? [];
  assert.equal(placeholders.length, 2);
  assert.equal(placeholders[0], placeholders[1], 'a reader must be able to tell "the same token"');
});

test('containsSecret answers the yes/no question', () => {
  assert.equal(containsSecret('всё чисто'), false);
  assert.equal(containsSecret('ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'), true);
});

test('the env denylist only picks credential-looking names with long values', () => {
  const denylist = buildEnvDenylist({
    NODE_ENV: 'production',
    PORT: '3001',
    SOME_API_KEY: 'value-long-enough-to-matter',
    SHORT_TOKEN: 'abc',
    PATH: '/usr/bin:/bin',
  } as NodeJS.ProcessEnv);

  assert.deepEqual(denylist, ['value-long-enough-to-matter']);
});
