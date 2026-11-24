// Run: node --test scripts/preview-stand/
// (`npm test` only picks up server/** and src/**, so this file is run on its own.)
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFrameUrl,
  buildServerEnv,
  USAGE,
  parseArgs,
  pickPort,
  standStatus,
} from './lib.mjs';
import { readFileSync } from 'node:fs';

import * as frameParams from './frame/frame-params.mjs';
import { normalizeFrameParams } from './frame/frame-params.mjs';
import * as seed from './seed.mjs';

const { buildTranscript, encodeProjectDir } = seed;

test('parseArgs: bare commands get the defaults', () => {
  assert.deepEqual(parseArgs(['up']), { command: 'up', port: null, build: true, seed: true });
  assert.deepEqual(parseArgs(['down']), { command: 'down', port: null, build: true, seed: true });
  assert.deepEqual(parseArgs(['status']), { command: 'status', port: null, build: true, seed: true });
});

test('parseArgs: help is a command, and the usage names every frame parameter', () => {
  for (const word of ['help', '--help', '-h']) {
    assert.equal(parseArgs([word]).command, 'help');
  }
  for (const name of ['w=', 'h=', 'theme=', 'variant=', 'themes=', 'path=', 'zoom=', 'login=0', 'sync=0', 'fresh=1']) {
    assert.ok(USAGE.includes(name), `usage must explain ${name}`);
  }
});

test('parseArgs: flags of up', () => {
  assert.deepEqual(parseArgs(['up', '--port', '4100', '--no-build', '--no-seed']), {
    command: 'up',
    port: 4100,
    build: false,
    seed: false,
  });
  assert.equal(parseArgs(['up', '--port=4101']).port, 4101);
});

test('parseArgs: refuses what it does not understand', () => {
  assert.throws(() => parseArgs([]), /up \| down \| status \| help/);
  assert.throws(() => parseArgs(['restart']), /up \| down \| status \| help/);
  assert.throws(() => parseArgs(['up', '--force']), /--force/);
  assert.throws(() => parseArgs(['up', '--port', 'abc']), /--port/);
  assert.throws(() => parseArgs(['up', '--port']), /--port/);
  assert.throws(() => parseArgs(['up', '--port', '80']), /--port/);
});

test('parseArgs: the ports of the live Neo3 can never be asked for', () => {
  assert.throws(() => parseArgs(['up', '--port', '3001']), /3001/);
  assert.throws(() => parseArgs(['up', '--port=3005']), /3005/);
});

test('pickPort: first free port from the preferred one upwards', async () => {
  const busy = new Set([3917, 3918]);
  const port = await pickPort({ preferred: 3917, isFree: async (candidate) => !busy.has(candidate) });
  assert.equal(port, 3919);
});

test('pickPort: skips the live ports even when they look free', async () => {
  const asked = [];
  const port = await pickPort({
    preferred: 3001,
    isFree: async (candidate) => {
      asked.push(candidate);
      return true;
    },
  });
  assert.equal(port, 3002);
  assert.deepEqual(asked, [3002]);

  const busy = new Set([3004]);
  assert.equal(await pickPort({ preferred: 3004, isFree: async (candidate) => !busy.has(candidate) }), 3006);
});

test('pickPort: gives up with a clear message when nothing is free', async () => {
  await assert.rejects(
    pickPort({ preferred: 3917, span: 3, isFree: async () => false }),
    /3917.+3919/,
  );
});

test('buildFrameUrl: width and theme', () => {
  assert.equal(
    buildFrameUrl({ port: 3917, width: 390, theme: 'glass' }),
    'http://127.0.0.1:3917/stand/frame.html?w=390&theme=glass',
  );
  assert.equal(buildFrameUrl({ port: 3917 }), 'http://127.0.0.1:3917/stand/frame.html?w=390');
});

test('buildFrameUrl: variant, path and switches', () => {
  assert.equal(
    buildFrameUrl({ port: 4100, width: 430, theme: 'neon', variant: 'city', path: '/session/abc?x=1' }),
    'http://127.0.0.1:4100/stand/frame.html?w=430&theme=neon&variant=city&path=%2Fsession%2Fabc%3Fx%3D1',
  );
  assert.equal(
    buildFrameUrl({ port: 4100, width: 390, height: 700, login: false, sync: false, fresh: true }),
    'http://127.0.0.1:4100/stand/frame.html?w=390&h=700&login=0&sync=0&fresh=1',
  );
});

test('buildFrameUrl: refuses a width, theme or path the frame would not accept', () => {
  assert.throws(() => buildFrameUrl({ port: 3917, width: 5000 }), /w=/);
  assert.throws(() => buildFrameUrl({ port: 3917, theme: 'glass light' }), /theme/);
  assert.throws(() => buildFrameUrl({ port: 3917, path: '//evil.example/' }), /path/);
  assert.throws(() => buildFrameUrl({ port: 3917, path: 'https://evil.example/' }), /path/);
});

test('normalizeFrameParams: defaults follow the width', () => {
  assert.deepEqual(normalizeFrameParams(''), {
    width: 390,
    height: 844,
    phones: [{ theme: null, variant: null }],
    path: '/',
    zoom: 'fit',
    login: true,
    sync: true,
    fresh: false,
    problems: [],
  });
  const wide = normalizeFrameParams('?w=430');
  assert.equal(wide.width, 430);
  assert.equal(wide.height, 932);
});

test('normalizeFrameParams: every parameter of the link', () => {
  assert.deepEqual(
    normalizeFrameParams('?w=390&h=700&theme=neon&variant=city&path=%2Fsession%2Fabc&zoom=0.5&login=0&sync=0&fresh=1'),
    {
      width: 390,
      height: 700,
      phones: [{ theme: 'neon', variant: 'city' }],
      path: '/session/abc',
      zoom: 0.5,
      login: false,
      sync: false,
      fresh: true,
      problems: [],
    },
  );
});

test('normalizeFrameParams: bad values fall back and are reported, never navigated to', () => {
  const params = normalizeFrameParams('?w=5000&h=abc&theme=%3Cscript%3E&variant=a%20b&path=%2F%2Fevil.example%2F');
  assert.equal(params.width, 390);
  assert.equal(params.height, 844);
  assert.deepEqual(params.phones, [{ theme: null, variant: null }]);
  assert.equal(params.path, '/');
  assert.deepEqual(params.problems.map((problem) => problem.split('=')[0]), ['w', 'h', 'theme', 'variant', 'path']);
  assert.equal(normalizeFrameParams('?path=https%3A%2F%2Fevil.example').path, '/');
  assert.equal(normalizeFrameParams('?path=%2F%5Cevil.example').path, '/');
});

test('normalizeFrameParams: several themes side by side', () => {
  const params = normalizeFrameParams('?themes=ember,glass,neon:city');
  assert.deepEqual(params.phones, [
    { theme: 'ember', variant: null },
    { theme: 'glass', variant: null },
    { theme: 'neon', variant: 'city' },
  ]);
  assert.deepEqual(params.problems, []);
  // `themes` is the whole list: a single `theme` next to it is not a fourth phone.
  assert.deepEqual(normalizeFrameParams('?theme=bio&themes=ember,codex').phones, [
    { theme: 'ember', variant: null },
    { theme: 'codex', variant: null },
  ]);
});

test('normalizeFrameParams: a bad or fifth theme is dropped and reported', () => {
  const bad = normalizeFrameParams('?themes=ember,gla%20ss,neon:ci%3Cty');
  assert.deepEqual(bad.phones, [{ theme: 'ember', variant: null }]);
  assert.deepEqual(bad.problems, ['themes=gla ss', 'themes=neon:ci<ty']);

  const many = normalizeFrameParams('?themes=a,b,c,d,e');
  assert.deepEqual(many.phones.map((phone) => phone.theme), ['a', 'b', 'c', 'd']);
  assert.deepEqual(many.problems, ['themes=e']);

  assert.deepEqual(normalizeFrameParams('?themes=').phones, [{ theme: null, variant: null }]);
});

test('buildFrameUrl: several themes', () => {
  assert.equal(
    buildFrameUrl({ port: 3917, themes: ['ember', 'glass', 'neon:city'] }),
    'http://127.0.0.1:3917/stand/frame.html?w=390&themes=ember%2Cglass%2Cneon%3Acity',
  );
  assert.throws(() => buildFrameUrl({ port: 3917, themes: ['ember', 'gla ss'] }), /themes/);
  assert.throws(() => buildFrameUrl({ port: 3917, themes: ['a', 'b', 'c', 'd', 'e'] }), /themes/);
  assert.throws(() => buildFrameUrl({ port: 3917, theme: 'ember', themes: ['glass'] }), /themes/);
});

test('normalizeFrameParams: zoom is «fit» or a plain factor', () => {
  assert.equal(normalizeFrameParams('?zoom=fit').zoom, 'fit');
  assert.equal(normalizeFrameParams('?zoom=1').zoom, 1);
  assert.equal(normalizeFrameParams('?zoom=2').zoom, 2);
  for (const bad of ['0', '0.1', '5', '-1', '1e1', 'big']) {
    const params = normalizeFrameParams(`?zoom=${bad}`);
    assert.equal(params.zoom, 'fit', `zoom=${bad}`);
    assert.deepEqual(params.problems, [`zoom=${bad}`]);
  }
});

test('buildFrameUrl: zoom', () => {
  assert.equal(buildFrameUrl({ port: 3917, zoom: 1 }), 'http://127.0.0.1:3917/stand/frame.html?w=390&zoom=1');
  assert.equal(buildFrameUrl({ port: 3917, zoom: 'fit' }), 'http://127.0.0.1:3917/stand/frame.html?w=390');
  assert.throws(() => buildFrameUrl({ port: 3917, zoom: 9 }), /zoom/);
});

test('buildServerEnv: the server only ever sees the scratch home', () => {
  const env = buildServerEnv({
    baseEnv: {
      PATH: '/usr/bin:/bin',
      LANG: 'ru_RU.UTF-8',
      TMPDIR: '/var/folders/x/T/',
      HOME: '/Users/real',
      DATABASE_PATH: '/Users/real/.cloudcli/auth.db',
      SERVER_PORT: '3001',
      HOST: '0.0.0.0',
      CODEX_HOME: '/Users/real/.codex',
      TELEGRAM_BOT_TOKEN: 'not-a-real-token',
      NEO3_THREADS_MCP: 'on',
      NEO3_THREADS_TOKEN: 'not-a-real-token',
      JWT_SECRET: 'not-a-real-secret',
    },
    home: '/scratch/home',
    port: 3917,
    realHome: '/Users/real',
  });

  assert.equal(env.HOME, '/scratch/home');
  assert.equal(env.USERPROFILE, '/scratch/home');
  assert.equal(env.DATABASE_PATH, '/scratch/home/.cloudcli/auth.db');
  assert.equal(env.SERVER_PORT, '3917');
  assert.equal(env.HOST, '127.0.0.1');
  assert.equal(env.PATH, '/usr/bin:/bin');
  assert.equal(env.LANG, 'ru_RU.UTF-8');
  assert.equal(env.TMPDIR, '/var/folders/x/T/');
  for (const leaked of ['CODEX_HOME', 'TELEGRAM_BOT_TOKEN', 'NEO3_THREADS_MCP', 'NEO3_THREADS_TOKEN', 'JWT_SECRET']) {
    assert.equal(leaked in env, false, `${leaked} must not reach the stand server`);
  }
  for (const watch of [
    'NEO3_KRABIK_WATCH',
    'NEO3_DUET_WATCH',
    'NEO3_BRIDGE_WATCH',
    'NEO3_AGENT_QUEUE_WATCH',
    'NEO3_SCHEDULE_NOTIFY_WATCH',
    'NEO3_MEMORY_SUGGESTIONS',
  ]) {
    assert.equal(env[watch], 'off', `${watch} must be switched off`);
  }
  assert.equal(env.NEO3_SCHEDULE_DIR, '/scratch/home/schedules');
  assert.equal(env.NEO3_SCHEDULE_LOG_DIR, '/scratch/home/schedules/logs');
});

test('buildServerEnv: refuses the real home and the live ports', () => {
  const base = { baseEnv: { PATH: '/usr/bin' }, realHome: '/Users/real' };
  assert.throws(() => buildServerEnv({ ...base, home: '/Users/real', port: 3917 }), /HOME/);
  assert.throws(() => buildServerEnv({ ...base, home: '/Users/real/', port: 3917 }), /HOME/);
  assert.throws(() => buildServerEnv({ ...base, home: '/Users/real/.cloudcli', port: 3917 }), /\.cloudcli/);
  assert.throws(() => buildServerEnv({ ...base, home: 'relative/home', port: 3917 }), /HOME/);
  assert.throws(() => buildServerEnv({ ...base, home: '/scratch/home', port: 3001 }), /3001/);
  assert.throws(() => buildServerEnv({ ...base, home: '/scratch/home', port: 3005 }), /3005/);
});

test('standStatus: running, stopped, stale', () => {
  assert.equal(standStatus({ state: null, pidAlive: false, healthy: false }), 'stopped');
  assert.equal(standStatus({ state: { pid: 10, port: 3917 }, pidAlive: true, healthy: true }), 'running');
  assert.equal(standStatus({ state: { pid: 10, port: 3917 }, pidAlive: true, healthy: false }), 'starting');
  assert.equal(standStatus({ state: { pid: 10, port: 3917 }, pidAlive: false, healthy: false }), 'stale');
  // Another process answers on the port, ours is gone: still not ours.
  assert.equal(standStatus({ state: { pid: 10, port: 3917 }, pidAlive: false, healthy: true }), 'stale');
});

test('encodeProjectDir: the folder name Claude Code gives a project', () => {
  assert.equal(encodeProjectDir('/Users/stand/work/eko-rotang'), '-Users-stand-work-eko-rotang');
  assert.equal(encodeProjectDir('/a b/c.d'), '-a-b-c-d');
});

test('buildTranscript: a Claude Code transcript the server can index', () => {
  const lines = buildTranscript({
    sessionId: '11111111-1111-4111-8111-111111111111',
    cwd: '/work/demo',
    startedAt: '2026-11-23T09:00:00.000Z',
    turns: [
      { role: 'user', text: 'Привет' },
      { role: 'assistant', text: 'Здравствуй' },
      { role: 'assistant', tool: { name: 'Bash', input: { command: 'ls' }, output: 'a.txt' } },
    ],
  })
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line));

  // user, assistant, assistant tool_use, user tool_result
  assert.equal(lines.length, 4);
  for (const line of lines) {
    assert.equal(line.sessionId, '11111111-1111-4111-8111-111111111111');
    assert.equal(line.cwd, '/work/demo');
  }
  assert.deepEqual(lines.map((line) => line.type), ['user', 'assistant', 'assistant', 'user']);
  assert.equal(lines[0].message.content, 'Привет');
  assert.equal(lines[0].parentUuid, null);
  assert.equal(lines[1].parentUuid, lines[0].uuid);
  assert.deepEqual(lines[1].message.content, [{ type: 'text', text: 'Здравствуй' }]);
  assert.equal(lines[2].message.content[0].type, 'tool_use');
  assert.equal(lines[3].message.content[0].type, 'tool_result');
  assert.equal(lines[3].message.content[0].tool_use_id, lines[2].message.content[0].id);
  assert.equal(lines[0].timestamp, '2026-11-23T09:00:00.000Z');
  assert.equal(lines[3].timestamp, '2026-11-23T09:03:00.000Z');
  assert.equal(new Set(lines.map((line) => line.uuid)).size, 4);
});

test('demoChatPath: the app route of the seeded chat with history', () => {
  // The id is the transcript file the running stand wrote for «Кнопка «Заказать» на телефоне»
  // (shop-frontend, first chat); the frame opened it as /session/<id>.
  assert.equal(seed.demoChatPath?.(), '/session/384e6aaa-4860-4c31-8d19-43850e79d4e0');
  // A stand raised with --no-seed has no such chat.
  assert.equal(seed.demoChatPath?.([]), null);
});

// ---- вход рамки: секрет одного `up` (ревью ветки, безопасность) -------------
//
// Сервер стенда раздаёт dist/ с `Access-Control-Allow-Origin: *`. Файл с токеном
// тестового пользователя по известному адресу читала бы страница любого сайта,
// открытая на этом Маке. Имя файла несёт секрет, который есть только в ссылке рамки.

// 32 случайных байта в base64url — так секрет выглядит у stand.mjs.
const KEY = 'q8ZtJ3nV0x-L5aRmB2cYd7EoKfGhW1uSiP4_TeN9Qw6';

test('sessionFileName: the sign-in file cannot be named without the key', () => {
  assert.equal(frameParams.sessionFileName?.(KEY), `session-${KEY}.json`);
  // Other secret — other file: knowing the scheme is not enough.
  assert.notEqual(frameParams.sessionFileName?.(KEY.replace('q8', 'zz')), frameParams.sessionFileName?.(KEY));
  // Nothing that could walk out of the frame folder or collapse into a guessable name.
  for (const bad of ['', 'short', '../../state', `${KEY}/..`, `${KEY}.json`, `a b${KEY}`, undefined, null, 42]) {
    assert.equal(frameParams.isSessionKey?.(bad), false, `key ${String(bad)} must be refused`);
    assert.throws(() => frameParams.sessionFileName(bad), /key/, `file name for ${String(bad)}`);
  }
});

test('readSessionKey: the frame takes the key only from its own link', () => {
  assert.equal(frameParams.readSessionKey?.(`?w=390&key=${KEY}`), KEY);
  assert.equal(frameParams.readSessionKey?.('?w=390'), null);
  assert.equal(frameParams.readSessionKey?.('?key=..%2F..%2Fstate'), null);
  assert.equal(frameParams.readSessionKey?.('?key='), null);
});

test('buildFrameUrl: the ready link carries the key, a broken key is refused', () => {
  assert.equal(
    buildFrameUrl({ port: 3917, width: 390, theme: 'glass', key: KEY }),
    `http://127.0.0.1:3917/stand/frame.html?w=390&theme=glass&key=${KEY}`,
  );
  assert.throws(() => buildFrameUrl({ port: 3917, key: '../state' }), /key/);
  assert.ok(USAGE.includes('key='), 'usage must explain key=');
});

test('the token file has no fixed address: stand and frame name it only through the key', () => {
  const stand = readFileSync(new URL('./stand.mjs', import.meta.url), 'utf8');
  const page = readFileSync(new URL('./frame/frame-page.mjs', import.meta.url), 'utf8');
  for (const [name, source] of [['stand.mjs', stand], ['frame-page.mjs', page]]) {
    assert.doesNotMatch(source, /session\.json/, `${name} still uses the fixed name`);
    assert.match(source, /sessionFileName\(/, `${name} must name the file through the key`);
  }
  // A new secret on every `up`: random bytes, generated where the file is written.
  assert.match(stand, /randomBytes\(32\)\.toString\('base64url'\)/);
  assert.match(page, /readSessionKey\(window\.location\.search\)/);
});
