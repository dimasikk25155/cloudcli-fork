import assert from 'node:assert/strict';
import test from 'node:test';

// A browser tab, minimally: an event target as `window` and an in-memory localStorage.
const memory = new Map<string, string>();
const browserWindow = new EventTarget();
Object.assign(globalThis, {
  window: browserWindow,
  localStorage: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, String(value)); },
    removeItem: (key: string) => { memory.delete(key); },
  },
});

const { modEnabledSource } = await import('./useModEnabled.js');
const { refreshUiPreferences } = await import('./uiPreferencesStore.js');

function countChanges() {
  let changes = 0;
  const unsubscribe = modEnabledSource.subscribe(() => { changes += 1; });
  return { get changes() { return changes; }, unsubscribe };
}

test('every mod reads as on while nothing is stored', () => {
  memory.clear();
  for (const key of ['modAttention', 'modAnswerButtons', 'modRelay', 'modCacheTimer', 'subagentCrabs'] as const) {
    assert.equal(modEnabledSource.read(key), true, key);
  }
});

test('a switch flipped in another tab of this browser reaches the screen', (t) => {
  memory.clear();
  const watcher = countChanges();
  t.after(watcher.unsubscribe);

  // The other tab wrote the shared preferences blob; the browser fires `storage` here.
  memory.set('uiPreferences', JSON.stringify({ modReplyChips: false }));
  browserWindow.dispatchEvent(new Event('storage'));

  assert.ok(watcher.changes > 0);
  assert.equal(modEnabledSource.read('modReplyChips'), false);
  assert.equal(modEnabledSource.read('modRelay'), true);
});

test('on «ui_preferences_changed» the settings are re-read from the server and the screen follows', async (t) => {
  memory.clear();
  const watcher = countChanges();
  t.after(watcher.unsubscribe);
  const requests: string[] = [];
  const fetchImpl = async (url: string) => {
    requests.push(url);
    return new Response(JSON.stringify({ success: true, preferences: { modThreads: false, modRelay: true } }));
  };

  await refreshUiPreferences(fetchImpl);

  assert.deepEqual(requests, ['/api/settings/ui-preferences']);
  assert.ok(watcher.changes > 0);
  assert.equal(modEnabledSource.read('modThreads'), false);
  assert.equal(modEnabledSource.read('modRelay'), true);

  // Switched back on the other device → on here too.
  await refreshUiPreferences(async () => new Response(JSON.stringify({ preferences: { modThreads: true } })));
  assert.equal(modEnabledSource.read('modThreads'), true);
});

test('a failed re-read keeps what the screen already shows', async () => {
  memory.clear();
  memory.set('uiPreferences', JSON.stringify({ modCodeStatus: false }));

  await refreshUiPreferences(async () => new Response('nope', { status: 500 }));
  await refreshUiPreferences(async () => { throw new Error('offline'); });

  assert.equal(modEnabledSource.read('modCodeStatus'), false);
});
