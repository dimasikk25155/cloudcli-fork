#!/usr/bin/env node
// Preview stand: a separate Neo3 built from THIS working copy, on a free port,
// with a scratch HOME and database, a test user and demo projects.
//
//   node scripts/preview-stand/stand.mjs up | down | status
//
// The live Neo3 is never touched: the server gets a scratch HOME (without it it
// would overwrite ~/.cloudcli/local-server.json), ports 3001 and 3005 are
// refused, the client is built with `vite build` into this copy's own dist/.
// Pure parts live in lib.mjs (tests: node --test scripts/preview-stand/lib.test.mjs).
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FRAME_PATH } from './frame/frame-params.mjs';
import { STAND_HOST, USAGE, buildFrameUrl, buildServerEnv, parseArgs, pickPort, standStatus } from './lib.mjs';
import { demoChatPath, writeSeed } from './seed.mjs';

const STAND_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(STAND_DIR, '..', '..');
const RUNTIME_DIR = path.join(STAND_DIR, 'runtime');
const SCRATCH_HOME = path.join(RUNTIME_DIR, 'home');
const WORKSPACE_DIR = path.join(RUNTIME_DIR, 'workspace');
const STATE_FILE = path.join(RUNTIME_DIR, 'state.json');
const SERVER_LOG = path.join(RUNTIME_DIR, 'server.log');
const DIST_DIR = path.join(APP_ROOT, 'dist');
/** Present in a dist/ this script built: `down` removes only such a dist/. */
const DIST_MARKER = path.join(DIST_DIR, '.preview-stand');
const FRAME_SOURCE = path.join(STAND_DIR, 'frame');
const FRAME_TARGET = path.join(DIST_DIR, path.dirname(FRAME_PATH));
const SERVER_ENTRY = path.join('server', 'index.js');
/**
 * Extra argument the server ignores. It makes the stand's process recognisable
 * in `ps`: the live Neo3 also runs a `server/index.js`, and `down` must never
 * mistake it for ours if a pid is ever reused.
 */
const SERVER_MARK = '--preview-stand';
const STAND_USER = 'stand';
const BOOT_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 15_000;

const say = (line = '') => process.stdout.write(`${line}\n`);
// `stand.mjs status | head -1` closes the pipe early; that is not a failure of the stand.
process.stdout.on('error', (error) => {
  if (error.code !== 'EPIPE') {
    throw error;
  }
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rel = (target) => path.relative(APP_ROOT, target) || '.';

class StandError extends Error {}

// ---- state ----------------------------------------------------------------

function readState() {
  let raw;
  try {
    raw = fs.readFileSync(STATE_FILE, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new StandError(`Файл состояния стенда испорчен: ${rel(STATE_FILE)}. Убери стенд: stand.mjs down.`);
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

// ---- processes and ports --------------------------------------------------

/** Our server, not a stranger that got the same pid after a reboot. */
function isStandProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 1) {
    return false;
  }
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  return result.status === 0 && result.stdout.includes(`${SERVER_ENTRY} ${SERVER_MARK}`);
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (connected) => {
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(400, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function canListen(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen({ host: STAND_HOST, port, exclusive: true }, () => probe.close(() => resolve(true)));
  });
}

/**
 * Nobody answers on the port (on either loopback) and it can be bound. The
 * connect probe matters: macOS lets a second socket bind 127.0.0.1 next to a
 * process listening on 0.0.0.0, and the stand would then steal its traffic.
 */
async function isPortFree(port) {
  if ((await canConnect('127.0.0.1', port)) || (await canConnect('::1', port))) {
    return false;
  }
  return canListen(port);
}

async function fetchJson(url, { token, ...init } = {}) {
  const headers = { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(20_000) });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

const origin = (port) => `http://${STAND_HOST}:${port}`;

/** The port answers as a Neo3 server (the auth status route is public). */
async function isHealthy(port) {
  try {
    const { ok, body } = await fetchJson(`${origin(port)}/api/auth/status`);
    return ok && body !== null && typeof body.needsSetup === 'boolean';
  } catch {
    return false;
  }
}

async function inspect() {
  const state = readState();
  const pidAlive = Boolean(state) && isStandProcess(state.pid);
  const healthy = pidAlive && (await isHealthy(state.port));
  return { state, status: standStatus({ state, pidAlive, healthy }) };
}

// ---- guards ---------------------------------------------------------------

/**
 * `up` builds into dist/ of this copy. If the live Neo3 is served from this
 * very folder, that build would replace the running app — refuse.
 */
function assertNotLiveCopy() {
  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.cloudcli', 'local-server.json'), 'utf8'));
  } catch {
    return; // no live server on this machine, or its marker is unreadable
  }
  const liveRoot = typeof marker?.appRoot === 'string' ? marker.appRoot : null;
  if (liveRoot && fs.existsSync(liveRoot) && fs.realpathSync(liveRoot) === fs.realpathSync(APP_ROOT)) {
    throw new StandError(
      'Из этой папки работает боевой Neo3 — стенд здесь пересобрал бы его dist/. Запускай стенд из отдельной рабочей копии.',
    );
  }
}

// ---- steps of `up` --------------------------------------------------------

function buildClient() {
  say('Собираю клиент (vite build → dist/ этой копии)…');
  const result = spawnSync(path.join('node_modules', '.bin', 'vite'), ['build', '--logLevel', 'error'], {
    cwd: APP_ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new StandError('Сборка клиента не прошла — стенд не поднят. Ошибка сборки выше.');
  }
  fs.writeFileSync(DIST_MARKER, 'built by scripts/preview-stand/stand.mjs\n');
}

function assertClientBuilt() {
  if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    throw new StandError('В dist/ нет собранного клиента: запусти up без --no-build.');
  }
}

/** Frame page next to the app, on the same origin: it shares localStorage with it. */
function installFrame(token) {
  fs.rmSync(FRAME_TARGET, { recursive: true, force: true });
  fs.cpSync(FRAME_SOURCE, FRAME_TARGET, { recursive: true });
  fs.writeFileSync(path.join(FRAME_TARGET, 'session.json'), `${JSON.stringify({ username: STAND_USER, token })}\n`, { mode: 0o600 });
}

function prepareScratch({ seed }) {
  fs.mkdirSync(path.join(SCRATCH_HOME, '.cloudcli'), { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  // Demo projects live inside this working copy. Their own empty repository
  // keeps every git call the app makes for them away from the copy's history.
  const git = spawnSync('git', ['init', '--quiet', WORKSPACE_DIR], { encoding: 'utf8', env: { ...process.env, HOME: SCRATCH_HOME } });
  if (git.status !== 0) {
    throw new StandError(`Не удалось завести репозиторий демо-проектов: ${(git.stderr || '').trim() || 'git init не сработал'}.`);
  }
  return seed ? writeSeed({ home: SCRATCH_HOME, workspace: WORKSPACE_DIR }) : [];
}

function startServer(port) {
  const env = buildServerEnv({ baseEnv: process.env, home: SCRATCH_HOME, port, realHome: os.homedir() });
  const log = fs.openSync(SERVER_LOG, 'a');
  const child = spawn(path.join('node_modules', '.bin', 'tsx'), ['--tsconfig', path.join('server', 'tsconfig.json'), SERVER_ENTRY, SERVER_MARK], {
    cwd: APP_ROOT,
    env,
    detached: true, // own process group: `down` stops tsx and the server together
    stdio: ['ignore', log, log],
  });
  fs.closeSync(log);
  child.unref();
  return child.pid;
}

function logTail(lines = 25) {
  try {
    return fs.readFileSync(SERVER_LOG, 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
  } catch {
    return '(журнал сервера пуст)';
  }
}

async function waitForServer(pid, port) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isHealthy(port)) {
      return;
    }
    if (!isStandProcess(pid)) {
      throw new StandError(`Сервер стенда завершился при запуске. Конец журнала:\n${logTail()}`);
    }
    await sleep(500);
  }
  throw new StandError(`Сервер стенда не ответил за ${BOOT_TIMEOUT_MS / 1000} с. Конец журнала:\n${logTail()}`);
}

async function signIn(port, { password, firstRun }) {
  const route = firstRun ? 'register' : 'login';
  const { ok, status, body } = await fetchJson(`${origin(port)}/api/auth/${route}`, {
    method: 'POST',
    body: JSON.stringify({ username: STAND_USER, password }),
  });
  if (!ok || typeof body?.token !== 'string') {
    throw new StandError(`Вход тестового пользователя не удался (${route}, код ${status}): ${body?.error ?? 'нет ответа'}.`);
  }
  return body.token;
}

/** A new user is met by the four-step tour; the stand's user is past it. */
async function skipOnboarding(port, token) {
  const { ok, status } = await fetchJson(`${origin(port)}/api/user/complete-onboarding`, { method: 'POST', token });
  if (!ok) {
    throw new StandError(`Не удалось отметить знакомство пройденным (код ${status}).`);
  }
}

/** The first project list makes the server index the seeded chats; then pin the marked ones. */
async function pinSeededProjects(port, token, seeded) {
  const { ok, status, body } = await fetchJson(`${origin(port)}/api/projects`, { token });
  if (!ok || !Array.isArray(body)) {
    throw new StandError(`Сервер стенда не отдал список проектов (код ${status}).`);
  }
  const missing = seeded.filter((project) => !body.some((item) => item.fullPath === project.cwd || item.path === project.cwd));
  if (missing.length > 0) {
    throw new StandError(`Сервер не увидел демо-проекты: ${missing.map((project) => project.name).join(', ')}.`);
  }
  for (const project of seeded.filter((item) => item.starred)) {
    const found = body.find((item) => item.fullPath === project.cwd || item.path === project.cwd);
    if (found.isStarred) {
      continue;
    }
    const pinned = await fetchJson(`${origin(port)}/api/projects/${encodeURIComponent(found.projectId)}/toggle-star`, { method: 'POST', token });
    if (!pinned.ok) {
      throw new StandError(`Не удалось закрепить демо-проект ${project.name} (код ${pinned.status}).`);
    }
  }
  return body.length;
}

function printAddresses(port, { chatPath } = {}) {
  say(`Адрес:           ${origin(port)}/`);
  say(`Рамка 390:       ${buildFrameUrl({ port, width: 390 })}`);
  say(`Рамка 430:       ${buildFrameUrl({ port, width: 430 })}`);
  say(`С темой:         ${buildFrameUrl({ port, width: 390, theme: 'glass' })}`);
  say(`Три темы рядом:  ${buildFrameUrl({ port, width: 390, themes: ['ember', 'glass', 'codex'] })}`);
  if (chatPath) {
    say(`Чат с перепиской: ${buildFrameUrl({ port, width: 390, path: chatPath })}`);
  }
  say('Параметры рамки: w, h, theme, variant, themes, path, zoom, login=0, sync=0, fresh=1 — node scripts/preview-stand/stand.mjs help');
  say('Вход выполняет сама ссылка рамки. Вручную: открой её в любом браузере на этом Маке.');
  say(`Журнал сервера:  ${rel(SERVER_LOG)}`);
  say('Погасить:        node scripts/preview-stand/stand.mjs down');
}

// ---- commands -------------------------------------------------------------

async function up(options) {
  const { state, status } = await inspect();

  if (status === 'running' || status === 'starting') {
    if (status === 'starting') {
      await waitForServer(state.pid, state.port);
    }
    say(`Стенд уже работает на порту ${state.port} (pid ${state.pid}) — второй не поднимаю.`);
    if (options.port && options.port !== state.port) {
      say(`Порт ${options.port} не применён: сначала down.`);
    }
    if (options.build) {
      buildClient();
    }
    assertClientBuilt();
    installFrame(await signIn(state.port, { password: state.password, firstRun: false }));
    printAddresses(state.port, state);
    return;
  }

  if (status === 'stale') {
    say('Остался след прежнего стенда (процесса уже нет) — убираю и поднимаю заново.');
    await down();
  }

  assertNotLiveCopy();
  if (options.build) {
    buildClient();
  }
  assertClientBuilt();

  const seeded = prepareScratch(options);
  const port = options.port ?? (await pickPort({ isFree: isPortFree }));
  if (options.port && !(await isPortFree(port))) {
    throw new StandError(`Порт ${port} занят. Убери --port — стенд выберет свободный сам.`);
  }

  const password = randomBytes(18).toString('base64url');
  const pid = startServer(port);
  const chatPath = seeded.length > 0 ? demoChatPath() : null;
  writeState({ pid, port, password, chatPath, startedAt: new Date().toISOString() });
  say(`Поднимаю сервер стенда на порту ${port} (pid ${pid})…`);

  try {
    await waitForServer(pid, port);
    const token = await signIn(port, { password, firstRun: true });
    await skipOnboarding(port, token);
    const projectCount = seeded.length > 0 ? await pinSeededProjects(port, token, seeded) : 0;
    installFrame(token);
    say(`Стенд готов: пользователь «${STAND_USER}», демо-проектов — ${projectCount}.`);
    printAddresses(port, { chatPath });
  } catch (error) {
    await down({ quiet: true });
    throw error;
  }
}

async function status() {
  const { state, status: current } = await inspect();
  if (current === 'stopped') {
    say('Стенд не запущен.');
    return;
  }
  if (current === 'stale') {
    say(`Стенд не работает: процесса ${state.pid} уже нет, остались временные файлы. Убрать: stand.mjs down.`);
    return;
  }
  if (current === 'starting') {
    say(`Стенд запускается: процесс ${state.pid} жив, порт ${state.port} ещё не отвечает.`);
    return;
  }
  say(`Стенд работает: порт ${state.port}, pid ${state.pid}, с ${state.startedAt}.`);
  printAddresses(state.port, state);
}

function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') {
      throw error;
    }
  }
}

async function stopServer(state) {
  if (!isStandProcess(state.pid)) {
    return false;
  }
  signalGroup(state.pid, 'SIGTERM');
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!isStandProcess(state.pid) && !(await canConnect(STAND_HOST, state.port))) {
      return true;
    }
    await sleep(250);
  }
  signalGroup(state.pid, 'SIGKILL');
  await sleep(500);
  if (isStandProcess(state.pid)) {
    throw new StandError(`Не удалось остановить сервер стенда (pid ${state.pid}). Временная папка не удалена.`);
  }
  return true;
}

async function down({ quiet = false } = {}) {
  const note = quiet ? () => undefined : say;
  let state = null;
  try {
    state = readState();
  } catch (error) {
    if (!(error instanceof StandError)) {
      throw error;
    }
    note('Файл состояния испорчен — процесс по нему не найти; убираю только файлы.');
  }

  const stopped = state ? await stopServer(state) : false;
  const hadFiles = fs.existsSync(RUNTIME_DIR) || fs.existsSync(FRAME_TARGET);
  fs.rmSync(RUNTIME_DIR, { recursive: true, force: true });
  fs.rmSync(FRAME_TARGET, { recursive: true, force: true });
  const removedDist = fs.existsSync(DIST_MARKER);
  if (removedDist) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }

  if (!stopped && !hadFiles && !removedDist) {
    note('Стенд не запущен — убирать нечего.');
    return;
  }
  note(
    [
      stopped ? `Сервер стенда остановлен (pid ${state.pid}, порт ${state.port}).` : 'Процесса стенда не было.',
      `Временная папка ${rel(RUNTIME_DIR)} удалена.`,
      removedDist ? 'dist/, собранный стендом, удалён.' : 'dist/ собран не стендом — оставлен.',
    ].join(' '),
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'help') {
    say(USAGE);
  } else if (options.command === 'up') {
    await up(options);
  } else if (options.command === 'down') {
    await down();
  } else {
    await status();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  if (!(error instanceof StandError) && error instanceof Error && error.stack && process.env.STAND_DEBUG) {
    process.stderr.write(`${error.stack}\n`);
  }
  process.exitCode = 1;
});
