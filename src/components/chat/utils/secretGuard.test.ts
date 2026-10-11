import assert from 'node:assert/strict';
import test from 'node:test';

import { runSecretGuard, type SecretGuardChoice, type SecretGuardPrompt } from './secretGuard.js';

// The one guard every send path goes through. The dialog and the HTTP call are
// injected, so these tests drive the real decision logic with fakes.
// All key values are fakes of the right shape.

const KEY = 'ghp_FakeFakeFakeFakeFakeFakeFake000001';

function deps(choice: SecretGuardChoice, opts: { isAdmin?: boolean; stashName?: (name: string) => string } = {}) {
  const asked: SecretGuardPrompt[] = [];
  const stashed: Array<{ name: string; value: string }> = [];
  return {
    asked,
    stashed,
    deps: {
      isAdmin: opts.isAdmin ?? true,
      ask: async (prompt: SecretGuardPrompt) => {
        asked.push(prompt);
        return choice;
      },
      stash: async (name: string, value: string) => {
        stashed.push({ name, value });
        return opts.stashName ? opts.stashName(name) : name;
      },
    },
  };
}

test('clean text is sent untouched without opening the dialog', async () => {
  const fake = deps({ action: 'cancel' });
  const outcome = await runSecretGuard('Запусти тесты', fake.deps);

  assert.deepEqual(outcome, { action: 'send', text: 'Запусти тесты' });
  assert.equal(fake.asked.length, 0);
});

test('cancel keeps the text in the composer; send-as-is sends it unchanged', async () => {
  const text = `вот токен ${KEY}`;
  assert.deepEqual(await runSecretGuard(text, deps({ action: 'cancel' }).deps), { action: 'cancel' });
  assert.deepEqual(await runSecretGuard(text, deps({ action: 'send-as-is' }).deps), { action: 'send', text });
});

test('admin stash saves each distinct value once and the message refers to the saved name', async () => {
  const text = `сначала ${KEY}, потом снова ${KEY}, пароль: Kx7!qz2m`;
  // The server reports the name it actually used — here a collision gave _2.
  const fake = deps(
    { action: 'stash', names: ['MY_GH', 'SITE_PASSWORD'] },
    { stashName: (name) => (name === 'MY_GH' ? 'MY_GH_2' : name) },
  );

  const outcome = await runSecretGuard(text, fake.deps);

  assert.equal(fake.asked.length, 1);
  assert.equal(fake.asked[0].canStash, true);
  assert.deepEqual(
    fake.asked[0].items.map((item) => [item.kind, item.suggestedName]),
    [['github', 'GITHUB_TOKEN'], ['password', 'PASSWORD']],
  );
  assert.deepEqual(fake.stashed, [
    { name: 'MY_GH', value: KEY },
    { name: 'SITE_PASSWORD', value: 'Kx7!qz2m' },
  ]);
  assert.deepEqual(outcome, {
    action: 'send',
    text:
      'сначала $MY_GH_2 (лежит в .secrets.env), потом снова $MY_GH_2 (лежит в .secrets.env), ' +
      'пароль: $SITE_PASSWORD (лежит в .secrets.env)',
  });
});

test('a non-admin can only cut the value out: [REDACTED:NAME], nothing is stashed', async () => {
  const text = `вот токен ${KEY}`;
  const redacting = deps({ action: 'redact', names: [''] }, { isAdmin: false });
  assert.deepEqual(await runSecretGuard(text, redacting.deps), { action: 'send', text: 'вот токен [REDACTED:GITHUB_TOKEN]' });
  assert.equal(redacting.asked[0].canStash, false);
  assert.equal(redacting.stashed.length, 0);

  const sneaky = deps({ action: 'stash', names: ['GITHUB_TOKEN'] }, { isAdmin: false });
  const outcome = await runSecretGuard(text, sneaky.deps);
  assert.equal(outcome.action, 'cancel');
  assert.equal(sneaky.stashed.length, 0);
});

test('an invalid name or a failed stash keeps the text and never leaks the value', async () => {
  const text = `вот токен ${KEY}`;
  const badName = await runSecretGuard(text, deps({ action: 'stash', names: ['my token'] }).deps);
  assert.equal(badName.action, 'cancel');

  const failing = deps({ action: 'stash', names: ['GITHUB_TOKEN'] });
  failing.deps.stash = async () => {
    throw new Error('Не удалось записать файл секретов');
  };
  const outcome = await runSecretGuard(text, failing.deps);
  assert.equal(outcome.action, 'cancel');
  assert.ok(outcome.action === 'cancel' && outcome.error && !outcome.error.includes(KEY));
});
