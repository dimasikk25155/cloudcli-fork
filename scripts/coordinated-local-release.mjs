/** Explicitly armed, one-shot Mac release. No model, login, dependency install or Git mutation. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const SERVICE = 'com.dimasik.neo3-local';
const ALLOWED_ROOT = '/Users/dimasik/Antigravity Project/claude agent/cloudcli-fork';
const sha = value => createHash('sha256').update(value).digest('hex');
const TERMINAL = new Set(['verified', 'failed', 'cancelled', 'interrupted']);

export function quietDecision(previous, sample, now, graceMs = 120_000) {
  if (sample.blockers.length) return { status: 'waiting', quietSince: null, sourceHash: sample.sourceHash, blockers: sample.blockers };
  const quietSince = previous.sourceHash === sample.sourceHash && previous.quietSince != null ? previous.quietSince : now;
  return { status: now - quietSince >= graceMs ? 'ready' : 'stabilizing', quietSince, sourceHash: sample.sourceHash, blockers: [] };
}

export function autopilotBlockers(text, approvedWaitHash = null, commonReleaseApproved = false) {
  if (!text) return [];
  const state = JSON.parse(text.replace(/^\s*window\.STATE\s*=\s*/, '').replace(/;\s*$/, ''));
  const blockers = [];
  // The final reporting/publication stage may legitimately wait for this release.
  for (const stage of state.stages ?? []) {
    if (stage.id !== 'final' && !['done', 'skipped'].includes(stage.status)) blockers.push(`autopilot:${stage.id}:${stage.status}`);
  }
  for (const ticket of state.tickets ?? []) if (ticket.status !== 'done') blockers.push(`ticket:${ticket.id}:${ticket.status}`);
  if (state.tests?.failed > 0) blockers.push('autopilot:failed-tests');
  const reviewedFinal = commonReleaseApproved && blockers.length === 0
    && state.stages?.some(stage => stage.id === 'review' && stage.status === 'done')
    && state.stages?.some(stage => stage.id === 'final' && ['pending', 'active'].includes(stage.status));
  if (state.waiting && !(state.waiting.kind === 'action'
    && (sha(JSON.stringify(state.waiting)) === approvedWaitHash || reviewedFinal))) {
    blockers.push('autopilot:waiting-for-decision');
  }
  return blockers;
}

export function activeChildren(table, parentPid) {
  return table.split('\n').filter(line => line.trim()).flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!match) throw new Error('Unreadable process table');
    if (+match[2] !== parentPid || /cloudcli-plugin-starter|\/plugins\/.*\/server\.js/.test(match[3])) return [];
    return [+match[1]]; // Never log command lines: they can contain credentials.
  });
}

function fingerprintTree(root) {
  const hash = createHash('sha256');
  function visit(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, item.name);
      hash.update(path.relative(root, file)).update('\0');
      if (item.isDirectory()) visit(file);
      else if (item.isFile()) hash.update(fs.readFileSync(file));
      else throw new Error('Unexpected build entry');
    }
  }
  visit(root);
  return hash.digest('hex');
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024, ...options });
}
function servicePid() {
  const result = run('/bin/launchctl', ['print', `gui/${process.getuid()}/${SERVICE}`]);
  const pid = Number(/^\s*pid = (\d+)$/m.exec(result)?.[1]);
  if (!pid) throw new Error('Runtime is not running');
  return pid;
}
function sourceFingerprint(root) {
  const names = run('/usr/bin/git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root }).split('\0');
  const hash = createHash('sha256').update(run('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: root }));
  for (const name of [...new Set(names)].filter(name => /^(src\/|server\/|shared\/|scripts\/|public\/|electron\/|claude-plugins\/|\.autopilot\/|[^/]+$)/.test(name)).sort()) {
    if (!name || name.startsWith('.env') || name.startsWith('.secrets')) continue;
    const file = path.join(root, name);
    hash.update(name).update('\0');
    if (!fs.existsSync(file)) { hash.update('missing'); continue; }
    const stat = fs.lstatSync(file);
    if (stat.isFile()) hash.update(fs.readFileSync(file));
    else if (stat.isSymbolicLink()) hash.update(fs.readlinkSync(file));
  }
  return hash.digest('hex');
}

export async function backupDatabase(root, source, destination) {
  const Database = createRequire(path.join(root, 'package.json'))('better-sqlite3');
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try { await db.backup(destination); } finally { db.close(); }
  fs.chmodSync(destination, 0o600);
  const backup = new Database(destination, { readonly: true, fileMustExist: true });
  try {
    if (backup.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Database backup integrity check failed');
  } finally { backup.close(); }
}

export function inspect(config, tracked = []) {
  if (config.root !== ALLOWED_ROOT || process.platform !== 'darwin') throw new Error('Unsupported maintenance target');
  const pid = servicePid();
  if (pid !== config.pid) throw new Error('Runtime PID changed independently; no second restart');
  if (fingerprintTree(path.join(config.root, 'dist-server')) !== config.serverHash
    || fingerprintTree(path.join(config.root, 'dist')) !== config.clientHash) throw new Error('Live build changed independently');
  const blockers = activeChildren(run('/bin/ps', ['-axo', 'pid=,ppid=,args=']), pid).map(pid => `process:${pid}`);
  const Database = createRequire(path.join(config.root, 'package.json'))('better-sqlite3');
  const db = new Database(config.database, { readonly: true, fileMustExist: true });
  let rows;
  try { rows = db.prepare('SELECT a.session_id, a.state, s.project_path FROM session_attention a LEFT JOIN sessions s ON s.session_id=a.session_id').all(); }
  finally { db.close(); }
  const cohort = new Set(tracked);
  for (const row of rows) {
    if (row.state === 'working') {
      blockers.push(`working:${row.session_id}`);
      if (row.project_path === config.root || row.project_path === path.dirname(config.root)) cohort.add(row.session_id);
    }
  }
  for (const id of cohort) {
    const row = rows.find(row => row.session_id === id);
    if (!row || row.state !== 'done') blockers.push(`unfinished:${id}:${row?.state ?? 'missing'}`);
  }
  const stateFile = path.join(config.root, '.autopilot/state.js');
  if (fs.existsSync(stateFile)) blockers.push(...autopilotBlockers(fs.readFileSync(stateFile, 'utf8'), config.approvedAutopilotWaitHash, config.commonReleaseApproved === true));
  if (fs.existsSync(path.join(config.root, '.git/index.lock'))) blockers.push('git:index-locked');
  if (sha(fs.readFileSync(path.join(config.root, 'package-lock.json'))) !== config.lockHash) blockers.push('dependency-lock-changed');
  return { blockers, tracked: [...cohort], sourceHash: sourceFingerprint(config.root) };
}

export async function releaseOnce(config, state, effects) {
  await effects.prepare();
  const sample = await effects.inspect();
  if (sample.blockers.length || sample.sourceHash !== state.sourceHash) throw Object.assign(new Error('Work changed during verification; release was not applied'), { deferred: true });
  await effects.swap();
  try {
    const final = await effects.inspectActivity();
    if (final.blockers.length || final.sourceHash !== state.sourceHash) throw Object.assign(new Error('Work resumed before restart'), { deferred: true });
  } catch (error) { await effects.restore(); throw error; }
  // Persist BEFORE issuing the command. A crash must never cause an automatic repeat.
  await effects.recordRestart();
  await effects.restart();
  await effects.verify();
}

export async function watch(configFile) {
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  if (config.authorized !== true || config.service !== SERVICE) throw new Error('Explicit release authorization missing');
  const dir = path.dirname(configFile), statusFile = path.join(dir, 'status.json');
  let state = fs.existsSync(statusFile) ? JSON.parse(fs.readFileSync(statusFile, 'utf8')) : { status: 'waiting', tracked: [] };
  const save = patch => {
    state = { ...state, ...patch, updatedAt: new Date().toISOString() };
    fs.writeFileSync(statusFile + '.tmp', JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(statusFile + '.tmp', statusFile);
  };
  if (TERMINAL.has(state.status)) return;
  if (state.restartIssued) { save({ status: 'interrupted', detail: 'Restart was already issued; automatic retry prohibited' }); return; }
  const fd = fs.openSync(path.join(dir, 'checks.log'), 'a', 0o600);
  const check = (command, args) => run(command, args, { cwd: config.root, stdio: ['ignore', fd, fd], timeout: 15 * 60_000 });
  try {
    while (Date.now() < config.expiresAt) {
      let sample;
      try { sample = inspect(config, state.tracked); }
      catch (error) {
        if (/changed independently|Unsupported maintenance target/.test(error.message)) throw error;
        // Editors can briefly truncate state files; unreadable never means idle.
        save({ status: 'waiting', quietSince: null, blockers: ['inspection-unavailable'], detail: String(error.message) });
        await delay(config.pollMs);
        continue;
      }
      save({ ...quietDecision(state, sample, Date.now(), config.graceMs), tracked: sample.tracked });
      if (state.status !== 'ready') { await delay(config.pollMs); continue; }
      save({ status: 'checking' });
      const stage = path.join(dir, 'stage');
      if (fs.existsSync(stage)) throw new Error('A previous stage exists; manual review required');
      fs.mkdirSync(stage);
      const backups = [];
      let bundle;
      try { await releaseOnce(config, state, {
        prepare: async () => {
          check(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.json']);
          check(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'server/tsconfig.json']);
          const tests = fs.readdirSync(path.join(config.root, 'scripts')).filter(name => /\.test\.(mjs|js)$/.test(name)).map(name => `scripts/${name}`);
          // Some script tests import TypeScript/runtime services. Give ALL of
          // them the same throwaway HOME/database and tsx loader as npm test.
          check(process.execPath, ['scripts/run-tests.mjs', ...tests, 'scripts/hooks/secret-guard.test.mjs']);
          check(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'server/tsconfig.json', '--outDir', path.join(stage, 'dist-server')]);
          check(process.execPath, ['node_modules/tsc-alias/dist/bin/index.js', '-p', 'server/tsconfig.json', '--outDir', path.join(stage, 'dist-server')]);
          check(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', path.join(stage, 'dist')]);
          bundle = /(?:src|href)="\/?(assets\/index-[^"\s]+\.js)"/.exec(fs.readFileSync(path.join(stage, 'dist/index.html'), 'utf8'))?.[1];
          if (!bundle) throw new Error('Built frontend has no expected entry bundle');
        },
        inspect: async () => inspect(config, state.tracked),
        swap: async () => {
          await backupDatabase(config.root, config.database, path.join(dir, 'auth.before.db'));
          save({ status: 'applying' });
          try {
            for (const name of ['dist', 'dist-server']) {
              const live = path.join(config.root, name), backup = path.join(dir, `${name}.before`);
              fs.renameSync(live, backup); backups.push({ live, backup, name });
              fs.renameSync(path.join(stage, name), live);
            }
          } catch (error) { restore(); throw error; }
        },
        inspectActivity: async () => inspect({ ...config,
          serverHash: fingerprintTree(path.join(config.root, 'dist-server')),
          clientHash: fingerprintTree(path.join(config.root, 'dist')),
        }, state.tracked),
        restore: async () => restore(),
        recordRestart: async () => save({ status: 'restarting', restartIssued: true, bundle }),
        restart: async () => { run('/bin/launchctl', ['kickstart', '-k', `gui/${process.getuid()}/${SERVICE}`]); },
        verify: async () => {
          const expected = sha(fs.readFileSync(path.join(config.root, 'dist', bundle)));
          let last;
          for (let attempt = 0; attempt < 30; attempt++) {
            try {
              const pid = servicePid();
              if (pid === config.pid) throw new Error('Old process still running');
              for (const origin of config.origins) {
                const page = await fetch(origin, { signal: AbortSignal.timeout(10_000) });
                if (page.status !== 200 || !(await page.text()).includes(bundle)) throw new Error(`Unexpected page at ${origin}`);
                const asset = await fetch(`${origin}/${bundle}`, { signal: AbortSignal.timeout(10_000) });
                if (!asset.ok || sha(Buffer.from(await asset.arrayBuffer())) !== expected) throw new Error(`Unexpected asset at ${origin}`);
              }
              save({ status: 'verified', pid, bundle, detail: 'One restart; origin/public HTTP 200 and exact frontend bundle verified' });
              return;
            } catch (error) { last = error; await delay(2_000); }
          }
          throw last;
        },
      }); } catch (error) {
        if (!error.deferred || state.restartIssued) throw error;
        // Only disposable artifacts created by THIS attempt are removed.
        fs.rmSync(stage, { recursive: true, force: true });
        save({ status: 'waiting', quietSince: null, detail: error.message });
        continue;
      }
      return;
      function restore() {
        for (const { live, backup, name } of backups.reverse()) {
          if (fs.existsSync(live)) fs.renameSync(live, path.join(stage, `${name}.not-applied`));
          fs.renameSync(backup, live);
        }
      }
    }
    throw new Error('Observation deadline reached; no forced restart');
  } catch (error) { save({ status: 'failed', detail: String(error.message ?? error) }); }
  finally { fs.closeSync(fd); }
}

export function makeManifest(root, database) {
  return { authorized: true, root, database, service: SERVICE, pid: servicePid(),
    serverHash: fingerprintTree(path.join(root, 'dist-server')), clientHash: fingerprintTree(path.join(root, 'dist')),
    lockHash: sha(fs.readFileSync(path.join(root, 'package-lock.json'))),
    pollMs: 20_000, graceMs: 120_000, expiresAt: Date.now() + 24 * 60 * 60_000,
    origins: ['http://100.96.100.39:3005', 'https://claude.neo3.ru'], approvedAt: new Date().toISOString(),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--watch' || !process.argv[3]) throw new Error('Usage: coordinated-local-release.mjs --watch manifest.json');
  await watch(process.argv[3]);
}
