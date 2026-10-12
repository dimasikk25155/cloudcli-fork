import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = 'com.dimasik.neo3-local';

/**
 * Children that are part of the server itself, not a user's run: the plugin
 * host (`cloudcli-plugin-starter`) is spawned once at boot and lives as long
 * as the service does. Counting it as activity is why every restart since it
 * landed timed out after 20 minutes without restarting anything (found
 * 22.09.2026, with a month of Grok fixes sitting unserved).
 */
const SERVER_OWN_CHILDREN = [/cloudcli-plugin-starter/, /\/plugins\/.*\/server\.js/];

export function directChildren(table, parentPid, { ignorePids = [] } = {}) {
  const ignored = new Set(ignorePids.map(Number));
  return table.split('\n').filter((line) => line.trim()).flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!match) throw new Error('Unrecognized process table; refusing to restart');
    const pid = Number(match[1]);
    const executable = match[3];
    if (Number(match[2]) !== parentPid || ignored.has(pid)) return [];
    // `comm=` gives the binary only; the plugin host has to be matched on its
    // full argv, so callers that can pass `args=` get the exclusion too.
    if (SERVER_OWN_CHILDREN.some((pattern) => pattern.test(executable))) return [];
    return [{ pid, executable }];
  });
}

export function serverFingerprint(root = path.join(ROOT, 'dist-server')) {
  const hash = createHash('sha256');
  const visit = (directory) => {
    for (const item of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(directory, item.name);
      if (item.isDirectory()) visit(filename);
      else if (item.isFile()) hash.update(path.relative(root, filename)).update('\0').update(readFileSync(filename));
      else throw new Error('Unexpected server build entry');
    }
  };
  visit(root);
  return hash.digest('hex');
}

/** Two consecutive idle observations; a new child resets the delivery grace. */
export async function waitForIdle({ sample, sleep = delay, now = Date.now, timeoutMs = 20 * 60_000, graceMs = 5_000 }) {
  const deadline = now() + timeoutMs;
  let idleSince = null;
  while (now() < deadline) {
    if (sample().length) idleSince = null;
    else if (idleSince === null) idleSince = now();
    else if (now() - idleSince >= graceMs) return;
    await sleep(Math.min(1_000, Math.max(1, deadline - now())));
  }
  throw new Error('Timed out waiting for all server child processes; no restart performed');
}

function servicePid() {
  const output = execFileSync('/bin/launchctl', ['print', `gui/${process.getuid()}/${LABEL}`], { encoding: 'utf8' });
  const pid = Number(/^\s*pid = (\d+)$/m.exec(output)?.[1]);
  if (!pid) throw new Error('Service has no running PID');
  return pid;
}

export async function applyWhenIdle(manifest, statusFile) {
  // The session asking for the restart is itself a child of the service. It
  // can never go idle before it stops waiting, so it is excluded by pid
  // (written into the manifest by whoever schedules the restart).
  const ignorePids = Array.isArray(manifest.ignorePids) ? manifest.ignorePids : [];
  const report = (status, detail) => writeFileSync(statusFile, JSON.stringify({ status, detail, timestamp: new Date().toISOString() }, null, 2));
  try {
    if (process.platform !== 'darwin') throw new Error('This maintenance job only supports macOS');
    report('waiting', 'Waiting for all current Neo3 child processes, including Codex');
    await waitForIdle({ sample: () => {
      if (servicePid() !== manifest.pid) throw new Error('Service PID changed independently; cancelling this restart');
      return directChildren(execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,args='], { encoding: 'utf8' }), manifest.pid, { ignorePids });
    } });
    if (serverFingerprint() !== manifest.serverHash) throw new Error('Server build changed after approval; cancelling restart');
    const children = directChildren(execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,args='], { encoding: 'utf8' }), manifest.pid, { ignorePids });
    if (children.length || servicePid() !== manifest.pid) throw new Error('Activity changed before restart; cancelling');
    report('restarting', LABEL);
    execFileSync('/bin/launchctl', ['kickstart', '-k', `gui/${process.getuid()}/${LABEL}`]);
    let lastError;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        if (servicePid() === manifest.pid) throw new Error('Old server PID is still running');
        for (const origin of ['http://100.96.100.39:3005', 'https://claude.neo3.ru']) {
          const response = await fetch(origin, { signal: AbortSignal.timeout(10_000) });
          if (!response.ok || !(await response.text()).includes(manifest.bundle)) throw new Error(`Unexpected frontend at ${origin}`);
          const asset = await fetch(`${origin}/${manifest.bundle}`, { signal: AbortSignal.timeout(10_000) });
          if (!asset.ok || createHash('sha256').update(Buffer.from(await asset.arrayBuffer())).digest('hex') !== manifest.bundleHash) {
            throw new Error(`Unexpected bundle at ${origin}`);
          }
        }
        report('verified', { pid: servicePid(), bundle: manifest.bundle });
        return;
      } catch (error) { lastError = error; }
      await delay(2_000);
    }
    throw lastError;
  } catch (error) {
    report('failed', String(error?.message || error));
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--apply-when-idle' || !process.argv[3] || !process.argv[4]) {
    throw new Error('Usage: restart-local-when-idle.js --apply-when-idle manifest.json status.json');
  }
  await applyWhenIdle(JSON.parse(readFileSync(process.argv[3], 'utf8')), process.argv[4]);
}
