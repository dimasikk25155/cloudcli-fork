/** Explicit, bounded release executor. Run outside the Neo3 launchd process group. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { activeChildren, backupDatabase } from './coordinated-local-release.mjs';

const ROOT = '/Users/dimasik/Antigravity Project/claude agent/cloudcli-fork';
const SERVICE = 'com.dimasik.neo3-local';
const sha = value => createHash('sha256').update(value).digest('hex');
const requireCondition = (ok, message) => { if (!ok) throw new Error(message); };
const run = (command, args, cwd) => {
  try { return execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { throw new Error(`Command failed: ${path.basename(command)}`); }
};

export function treeHash(root) {
  const hash = createHash('sha256');
  function visit(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name), stat = fs.lstatSync(file);
      hash.update(path.relative(root, file)).update('\0');
      if (stat.isDirectory()) visit(file);
      else if (stat.isFile()) hash.update(fs.readFileSync(file));
      else throw new Error('Unexpected symlink or special file in build');
    }
  }
  requireCondition(fs.lstatSync(root).isDirectory(), 'Build path is not a directory');
  visit(root);
  return hash.digest('hex');
}

export function sourceHash(root) {
  const hash = createHash('sha256');
  const names = run('/usr/bin/git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root).split('\0');
  for (const name of [...new Set(names)].filter(name => /^(src\/|server\/|shared\/|scripts\/|public\/|electron\/|claude-plugins\/|package(?:-lock)?\.json$|.*config\.(?:js|ts|json)$)/.test(name)).sort()) {
    hash.update(name).update('\0');
    const file = path.join(root, name);
    if (!fs.existsSync(file)) { hash.update('missing'); continue; }
    const stat = fs.lstatSync(file);
    if (stat.isFile()) hash.update(fs.readFileSync(file));
    else if (stat.isSymbolicLink()) hash.update(fs.readlinkSync(file));
    else throw new Error('Unexpected source entry');
  }
  return hash.digest('hex');
}

/** Effects are injected so tests never address launchd, production DB or network. */
export async function executeRelease(effects) {
  const state = { status: 'checking', restartIssued: false, recoveryRestartIssued: false, startedAt: new Date().toISOString() };
  const save = async patch => {
    const next = { ...state, ...patch, updatedAt: new Date().toISOString() };
    await effects.save(next);
    Object.assign(state, next);
  };
  const saveFailure = async patch => {
    try { await save(patch); }
    catch { Object.assign(state, patch, { statusWriteError: 'Could not persist release status' }); }
  };
  let swapAttempted = false;
  try {
    await save({});
    await effects.preflight(false, true);
    await effects.backup();
    await effects.preflight(false);
    await save({ status: 'applying' });
    swapAttempted = true;
    await effects.swap();
    await effects.preflight(true);
    await save({ status: 'restarting', restartIssued: true });
    await effects.restart(false);
    const verification = await effects.verify(false);
    await save({ status: 'verified', verification, finishedAt: new Date().toISOString() });
  } catch (error) {
    await saveFailure({ status: 'failed', error: String(error.message), rollback: { status: swapAttempted ? 'pending' : 'not-needed' } });
    if (swapAttempted) {
      try {
        await effects.restore();
        if (state.restartIssued) {
          await save({ rollback: { status: 'restarting' }, recoveryRestartIssued: true });
          await effects.restart(true);
          const verification = await effects.verify(true);
          await saveFailure({ rollback: { status: 'verified', verification } });
        } else await saveFailure({ rollback: { status: 'restored-before-restart' } });
      } catch (rollbackError) {
        await saveFailure({ rollback: { status: 'failed', error: String(rollbackError.message) } });
      }
    }
    await saveFailure({ finishedAt: new Date().toISOString() });
  }
  return state;
}

function serviceState() {
  const output = run('/bin/launchctl', ['print', `gui/${process.getuid()}/${SERVICE}`]);
  const pid = Number(/^\s*pid = (\d+)$/m.exec(output)?.[1]);
  requireCondition(pid > 1, 'Neo3 service has no running PID');
  return pid;
}

function readBundle(dir) {
  const relative = /(?:src|href)="\/?(assets\/index-[a-zA-Z0-9_-]+\.js)"/.exec(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'))?.[1];
  requireCondition(relative, 'Expected frontend bundle missing');
  return { path: relative, sha256: sha(fs.readFileSync(path.join(dir, relative))) };
}

export function activityBlockers(table, runtimePid, controller, working, executorPid) {
  const blockers = [], children = activeChildren(table, runtimePid);
  const allowed = controller?.pid;
  if (children.some(pid => pid !== allowed)) blockers.push('runtime-children');
  if (allowed && children.includes(allowed)) {
    const line = table.split('\n').find(line => new RegExp(`^\\s*${allowed}\\s+${runtimePid}\\s+`).test(line));
    if (!line || !/(?:^|\/)codex(?:\.neo3-direct)?(?:\s|$)/.test(line)) blockers.push('controller-identity');
  }
  if (working.some(row => !(allowed && children.includes(allowed) && row.session_id === controller.sessionId))) blockers.push('working-sessions');
  const concurrent = table.split('\n').some(line => {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    return m && Number(m[1]) !== executorPid && /(?:node|nodejs)\s+.*(?:coordinated-local-release\.mjs|coordinated-release[^\s]*\/watcher\.mjs|apply-combined-local-release\.mjs)\s+(?:--watch|--apply)/.test(m[3]);
  });
  if (concurrent) blockers.push('other-release');
  return blockers;
}

export function validateManifest(manifest, dir) {
  requireCondition(process.platform === 'darwin', 'Only the approved Mac target is supported');
  requireCondition(manifest.authorized === true && manifest.service === SERVICE && manifest.root === ROOT, 'Explicit approved target required');
  requireCondition(Number.isSafeInteger(manifest.expectedPid) && manifest.expectedPid > 1, 'Expected runtime PID required');
  requireCondition(/^[a-f0-9]{40}$/.test(manifest.sourceSha) && /^[a-f0-9]{64}$/.test(manifest.sourceHash), 'Exact source identity required');
  for (const kind of ['live', 'stage']) for (const name of ['dist', 'dist-server']) requireCondition(/^[a-f0-9]{64}$/.test(manifest.hashes?.[kind]?.[name]), 'Exact build hashes required');
  const base = fs.realpathSync(path.join('/Users/dimasik/.cloudcli', 'maintenance'));
  requireCondition(fs.realpathSync(dir).startsWith(base + path.sep), 'Release directory must be inside maintenance');
  requireCondition(fs.realpathSync(manifest.stage).startsWith(fs.realpathSync(dir) + path.sep), 'Stage must be owned by this release');
  requireCondition(path.isAbsolute(manifest.database) && fs.statSync(manifest.database).isFile(), 'Existing database path required');
  requireCondition(Array.isArray(manifest.origins) && manifest.origins.length === 2 && manifest.origins.includes('http://100.96.100.39:3005') && manifest.origins.includes('https://claude.neo3.ru'), 'Only approved origin and public URL are allowed');
  requireCondition(Number.isFinite(manifest.expiresAt) && Date.now() < manifest.expiresAt && manifest.expiresAt - Date.now() <= 60 * 60_000, 'Release approval must expire within one hour');
  if (manifest.controller) requireCondition(Number.isSafeInteger(manifest.controller.pid) && manifest.controller.pid > 1 && typeof manifest.controller.sessionId === 'string' && manifest.controller.sessionId.length > 0, 'Controller requires exact PID and session ID');
}

export async function applyManifest(manifestFile) {
  const dir = path.dirname(path.resolve(manifestFile));
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  validateManifest(manifest, dir);
  const statusFile = path.join(dir, 'status.json');
  requireCondition(!fs.existsSync(statusFile), 'This one-shot release already has a status; do not repeat it');
  const oldBundle = readBundle(path.join(ROOT, 'dist'));
  const newBundle = readBundle(path.join(manifest.stage, 'dist'));
  const Database = createRequire(path.join(ROOT, 'package.json'))('better-sqlite3');
  const lockFile = path.join(path.dirname(dir), 'combined-release.lock');
  const lock = fs.openSync(lockFile, 'wx', 0o600);
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, release: dir }));
  const moved = [];
  let restartFromPid = manifest.expectedPid;
  let lastState;
  const save = async state => {
    lastState = { ...state };
    const record = { ...state, sourceSha: manifest.sourceSha, sourceHash: manifest.sourceHash, bundle: newBundle, previousBundle: oldBundle, backup: path.join(dir, 'auth.before.db') };
    const fd = fs.openSync(statusFile + '.tmp', 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(record, null, 2)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(statusFile + '.tmp', statusFile);
    const directoryFd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
    const lines = ['# Общий выпуск Neo3 — 03.11.2026', '', `Статус: **${state.status}**`, `Исходники: \`${manifest.sourceSha}\``, `Обновлено: ${state.updatedAt}`, `Перезапуск выпуска: ${state.restartIssued ? 'выдан' : 'не выполнялся'}`, `Восстановительный перезапуск: ${state.recoveryRestartIssued ? 'выдан' : 'не выполнялся'}`, '', state.waitingReason ? `Ожидание: ${state.waitingReason}` : '', state.error ? `Причина неуспешного выпуска: ${state.error}` : '', state.rollback ? `Откат: ${state.rollback.status}` : '', state.rollback?.error ? `Ошибка отката: ${state.rollback.error}` : '', state.verification ? `Проверено: новый PID ${state.verification.pid}, root и health origin/public HTTP 200, точный SHA клиентского файла, таблицы и маршруты.` : 'Публичная проверка выпуска ещё не подтверждена.', '', 'Резервная копия БД: auth.before.db; старые сборки: dist.before и dist-server.before (при откате возвращены в рабочую папку). Автоматическое восстановление БД запрещено.', '', 'Доставка писем и пользовательский браузерный сценарий этим отчётом не подтверждаются.'];
    fs.writeFileSync(path.join(dir, 'report.md'), lines.filter(Boolean).join('\n') + '\n', { mode: 0o600 });
  };
  const activity = () => {
    requireCondition(serviceState() === manifest.expectedPid, 'Runtime changed independently');
    const groups = run('/bin/ps', ['-p', `${process.pid},${manifest.expectedPid}`, '-o', 'pid=,pgid=']).trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
    const executorGroup = groups.find(row => row[0] === process.pid)?.[1], runtimeGroup = groups.find(row => row[0] === manifest.expectedPid)?.[1];
    requireCondition(executorGroup && runtimeGroup && executorGroup !== runtimeGroup, 'Release executor must run outside the Neo3 process group');
    const table = run('/bin/ps', ['-axo', 'pid=,ppid=,args=']);
    const db = new Database(manifest.database, { readonly: true, fileMustExist: true });
    try {
      const working = db.prepare("SELECT session_id FROM session_attention WHERE state='working'").all();
      const blockers = activityBlockers(table, manifest.expectedPid, manifest.controller, working, process.pid);
      requireCondition(!blockers.includes('controller-identity'), 'Allowed controller PID is not the expected Codex child');
      requireCondition(!blockers.includes('other-release'), 'Another release executor is active');
      if (blockers.length) throw Object.assign(new Error('Other active work: ' + blockers.join(', ')), { busy: true });
    } finally { db.close(); }
  };
  const inspect = swapped => {
    requireCondition(Date.now() < manifest.expiresAt, 'Release approval expired');
    requireCondition(run('/usr/bin/git', ['rev-parse', 'HEAD'], ROOT).trim() === manifest.sourceSha, 'Source commit changed');
    requireCondition(sourceHash(ROOT) === manifest.sourceHash, 'Source files changed after verification');
    for (const name of ['dist', 'dist-server']) {
      requireCondition(treeHash(path.join(ROOT, name)) === manifest.hashes[swapped ? 'stage' : 'live'][name], 'Live artifacts changed independently');
      if (!swapped) requireCondition(treeHash(path.join(manifest.stage, name)) === manifest.hashes.stage[name], 'Staged artifacts changed after verification');
    }
    activity();
  };
  const idleDeadline = Math.min(manifest.expiresAt, Date.now() + 15 * 60_000);
  const preflight = async (swapped, allowWait = false) => {
    for (;;) {
      try {
        inspect(swapped);
        if (lastState?.status === 'waiting') await save({ ...lastState, status: 'checking', waitingReason: undefined, updatedAt: new Date().toISOString() });
        return;
      } catch (error) {
        if (!allowWait || swapped || !error.busy || Date.now() >= idleDeadline) throw error;
        await save({ ...lastState, status: 'waiting', waitingReason: error.message, updatedAt: new Date().toISOString() });
        await delay(5000);
      }
    }
  };
  const verify = async rollback => {
    const bundle = rollback ? oldBundle : newBundle;
    const deadline = Date.now() + 120_000;
    let lastError;
    for (let attempt = 0; attempt < 30 && Date.now() < deadline; attempt++) {
      try {
        const pid = serviceState();
        requireCondition(pid !== restartFromPid, 'Runtime PID did not change');
        for (const origin of manifest.origins) {
          const signal = () => AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now())));
          const get = pathname => fetch(origin + pathname, { redirect: 'error', signal: signal() });
          const health = await get('/health');
          requireCondition(health.status === 200 && (await health.json()).status === 'ok', 'Health verification failed');
          const page = await get('/');
          requireCondition(page.status === 200 && (await page.text()).includes(bundle.path), 'Frontend entry verification failed');
          const asset = await get('/' + bundle.path);
          requireCondition(asset.status === 200 && sha(Buffer.from(await asset.arrayBuffer())) === bundle.sha256, 'Frontend asset hash verification failed');
          if (!rollback) {
            const form = await get('/neo3-intake.html');
            requireCondition(form.status === 200 && (form.headers.get('content-type') ?? '').includes('text/html'), 'Public intake page verification failed');
            const staff = await get('/api/agent-workspace/projects');
            requireCondition([401, 403].includes(staff.status), 'Workspace authentication boundary verification failed');
            const intake = await fetch(origin + '/api/public-intake/start', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ formToken: 'invalid-release-probe' }), signal: signal() });
            requireCondition(intake.status === 404, 'Public intake route verification failed');
          }
        }
        if (!rollback) {
          const db = new Database(manifest.database, { readonly: true, fileMustExist: true });
          try {
            for (const name of ['workspace_records', 'run_durations', 'improvement_ideas']) requireCondition(Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)), 'Expected migrated table missing');
          } finally { db.close(); }
        }
        return { pid, checkedAt: new Date().toISOString(), origins: manifest.origins, bundle };
      } catch (error) { lastError = error; if (attempt < 29) await delay(2000); }
    }
    throw new Error(lastError?.message ?? 'Post-restart verification failed');
  };
  try {
    return await executeRelease({ save, preflight, verify,
      backup: () => backupDatabase(ROOT, manifest.database, path.join(dir, 'auth.before.db')),
      swap: async () => {
        for (const name of ['dist', 'dist-server']) {
          const live = path.join(ROOT, name), backup = path.join(dir, name + '.before');
          requireCondition(!fs.existsSync(backup), 'Backup artifact path already exists');
          fs.renameSync(live, backup); moved.push({ name, live, backup });
          fs.renameSync(path.join(manifest.stage, name), live);
        }
      },
      restore: async () => {
        const errors = [];
        for (const { name, live, backup } of [...moved].reverse()) {
          try {
            if (fs.existsSync(live)) fs.renameSync(live, path.join(dir, name + '.failed'));
            fs.renameSync(backup, live);
            requireCondition(treeHash(live) === manifest.hashes.live[name], 'Restored artifact hash mismatch');
          } catch { errors.push(name); }
        }
        requireCondition(!errors.length, 'Could not restore artifacts: ' + errors.join(', '));
      },
      restart: async rollback => {
        if (rollback) { try { restartFromPid = serviceState(); } catch { restartFromPid = manifest.expectedPid; } }
        run('/bin/launchctl', ['kickstart', '-k', `gui/${process.getuid()}/${SERVICE}`]);
      },
    });
  } finally { fs.closeSync(lock); fs.unlinkSync(lockFile); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--apply' || !process.argv[3]) throw new Error('Usage: apply-combined-local-release.mjs --apply manifest.json');
  try { const result = await applyManifest(process.argv[3]); process.exitCode = result.status === 'verified' ? 0 : 1; }
  catch { console.error('Release could not start; inspect the manifest, lock and status file. No automatic retry.'); process.exitCode = 1; }
}
