import { execFile } from 'node:child_process';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { reviewedProposal } from './reviewed-proposal.js';

const exec = promisify(execFile);
const API = 'https://api.github.com/repos/siteboon/claudecodeui';
const WEB = 'https://github.com/siteboon/claudecodeui';
export const defaultReportPath = path.join(os.homedir(), '.cloudcli/upstream-update-report.json');
const inFlight = new Map();
const shaPattern = /^[0-9a-f]{40}$/;

function sha(value) {
  if (!shaPattern.test(value)) throw new Error('GitHub returned an invalid commit SHA');
  return value;
}

async function publicJson(fetchImpl, endpoint, signal) {
  const response = await fetchImpl(`${API}/${endpoint}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Neo3-check-only' },
    redirect: 'error', signal,
  });
  if (!response.ok) throw new Error(`GitHub HTTP ${response.status} (${endpoint.split('/')[0]})`);
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 4 * 1024 * 1024) throw new Error('GitHub response exceeds 4 MiB limit');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const text = (value, limit = 200) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, limit);

/** Public seam: read/check only. No fetch refs, checkout, installer or remote code execution. */
export function createUpstreamChecker({ repo, reportPath = defaultReportPath, fetchImpl = globalThis.fetch, now = () => new Date() }) {
  const git = async (...args) => (await exec('git', ['--no-pager', '-c', 'core.fsmonitor=false', '-C', repo, ...args], {
    encoding: 'utf8', timeout: 8000, maxBuffer: 4 * 1024 * 1024,
    env: { PATH: process.env.PATH, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  })).stdout.trim();

  async function read() {
    try {
      const report = JSON.parse(await readFile(reportPath, 'utf8'));
      const age = now().getTime() - Date.parse(report.lastSuccessfulCheckAt || '');
      return { ...report, stale: report.stale || !Number.isFinite(age) || age > 36 * 60 * 60 * 1000 };
    }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async function collect() {
    const checkedAt = now().toISOString();
    const fork = {
      sha: await git('rev-parse', 'HEAD'),
      branch: await git('branch', '--show-current'),
      version: JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8')).version,
      dirty: Boolean(await git('status', '--porcelain', '--untracked-files=normal')),
    };
    const signal = AbortSignal.timeout(60000);
    const releaseData = await publicJson(fetchImpl, 'releases/latest', signal);
    if (releaseData.draft || releaseData.prerelease || !/^v?\d+\.\d+\.\d+(?:[.+-][\w.-]+)?$/.test(releaseData.tag_name)) throw new Error('GitHub latest release is not a valid stable release');
    const releaseCommit = await publicJson(fetchImpl, `commits/${encodeURIComponent(releaseData.tag_name)}`, signal);
    const main = await publicJson(fetchImpl, 'commits/main', signal);
    const mainSha = sha(main.sha);
    const release = { tag: releaseData.tag_name, sha: sha(releaseCommit.sha), url: `${WEB}/releases/tag/${encodeURIComponent(releaseData.tag_name)}`, publishedAt: releaseData.published_at, notes: text(releaseData.body, 3000) };
    const upstream = { sha: mainSha, url: `${WEB}/commit/${mainSha}`, date: main.commit?.committer?.date };
    let base;
    let patchCoverage = new Map();
    let ancestry = null;
    const risks = [
      'Количество коммитов не равно числу отсутствующих функций: ручные переносы могут отличаться от исходных патчей.',
      'Пути src/modules upstream могут соответствовать src/components форка; полный merge опасен для моделей, сессий и удалённого TaskMaster.',
    ];
    try {
      base = await git('merge-base', 'HEAD', mainSha);
      const counts = (await git('rev-list', '--left-right', '--count', `HEAD...${mainSha}`)).split(/\s+/).map(Number);
      ancestry = { forkOnly: counts[0], upstreamOnly: counts[1], mergeBase: base };
      patchCoverage = new Map((await git('cherry', 'HEAD', mainSha)).split('\n').filter(Boolean).map(line => [line.slice(2), line[0] === '-' ? 'patch-equivalent' : 'not-patch-equivalent']));
    } catch (error) {
      risks.push('Свежие Git-объекты недоступны локально: ancestry и совпадения cherry-pick не подтверждены. Проверка не загружает refs.');
      base = release.sha;
    }
    const comparison = await publicJson(fetchImpl, `compare/${sha(base)}...${mainSha}`, signal);
    if (!Array.isArray(comparison.commits) || !Array.isArray(comparison.files)) throw new Error('GitHub returned an incomplete comparison');
    const dirtyPaths = (await git('ls-files', '--modified', '--others', '--exclude-standard')).split('\n');
    const stagedPaths = (await git('diff', '--no-ext-diff', '--cached', '--name-only')).split('\n');
    const forkPaths = ancestry ? (await git('diff', '--no-ext-diff', '--name-only', `${base}...HEAD`)).split('\n') : [];
    const localPaths = new Set([...dirtyPaths, ...stagedPaths, ...forkPaths]);
    const paths = comparison.files.map(file => text(file.filename, 500));
    const overlap = paths.filter(file => localPaths.has(file) || localPaths.has(file.replace(/^src\/modules\//, 'src/components/')));
    const candidates = comparison.commits.slice(-50).reverse().map(commit => ({
      sha: sha(commit.sha), subject: text(commit.commit?.message?.split('\n')[0]),
      url: `${WEB}/commit/${sha(commit.sha)}`, coverage: patchCoverage.get(commit.sha) || 'unknown',
    }));
    if (comparison.total_commits > comparison.commits.length || paths.length >= 300) risks.push('GitHub ограничил сравнение; список изменений и пересечений неполный.');
    if (fork.dirty) risks.push('В форке есть незавершённые изменения; перед переносом нужна отдельная резервная точка и изолированная рабочая копия.');
    const report = {
      schemaVersion: 1, checkedAt, lastSuccessfulCheckAt: checkedAt, status: 'ok', stale: false, error: null,
      fork, release, upstream, approvalRequired: true, policy: 'check-only',
      reviewedProposal: { ...reviewedProposal, needsReview: fork.sha !== reviewedProposal.forkSha || mainSha !== reviewedProposal.upstreamSha || fork.dirty },
      changes: { ancestry, comparedFrom: base, totalCommits: comparison.total_commits, candidates, overlap, fileCount: paths.length, risks },
      nextStep: `Согласовать конкретные изменения из ${mainSha}. После согласования: отдельный worktree, сохранение локальных правок, выборочный перенос, review, тесты и изолированная сборка, точка отката, затем отдельно согласованный rollout.`,
    };
    return report;
  }

  async function persist(report) {
    await mkdir(path.dirname(reportPath), { recursive: true, mode: 0o700 });
    const temporary = `${reportPath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, reportPath);
    return report;
  }

  async function refresh() {
    const previous = await read();
    let report;
    try {
      report = await collect();
    } catch (error) {
      report = {
        ...previous, schemaVersion: 1, checkedAt: now().toISOString(),
        lastSuccessfulCheckAt: previous?.lastSuccessfulCheckAt ?? null,
        status: 'error', stale: true, error: text(error.message, 300),
        approvalRequired: true, policy: 'check-only',
      };
    }
    return persist(report);
  }
  async function lockedCheck() {
    await mkdir(path.dirname(reportPath), { recursive: true, mode: 0o700 });
    let lock;
    try {
      lock = await open(`${reportPath}.lock`, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      return { ...(await read()), approvalRequired: true, policy: 'check-only', checking: true,
        checkNotice: 'Другая проверка уже выполняется. Если процесс завершился аварийно, проверьте и удалите оставшийся lock-файл по инструкции.' };
    }
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      return await refresh();
    } finally {
      await lock.close();
      await unlink(`${reportPath}.lock`);
    }
  }

  function check() {
    const key = path.resolve(reportPath);
    if (!inFlight.has(key)) {
      inFlight.set(key, lockedCheck().finally(() => inFlight.delete(key)));
    }
    return inFlight.get(key);
  }
  return { read, check };
}

export { mountUpstreamRoutes } from './routes.js';
