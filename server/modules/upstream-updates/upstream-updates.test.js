import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createUpstreamChecker } from './index.js';

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'neo3-upstream-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo');
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Fixture');
  await writeFile(path.join(repo, 'package.json'), '{"version":"1.37.0"}');
  await writeFile(path.join(repo, 'chat.txt'), 'base\n');
  git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  await writeFile(path.join(repo, 'chat.txt'), 'upstream fix\n');
  git('commit', '-qam', 'fix: Safari Enter');
  const main = git('rev-parse', 'HEAD');
  git('checkout', '-qb', 'fork', base);
  await writeFile(path.join(repo, 'local.txt'), 'fork\n');
  git('add', '.'); git('commit', '-qm', 'fork feature');
  await writeFile(path.join(repo, 'chat.txt'), 'staged\n'); git('add', 'chat.txt');
  await writeFile(path.join(repo, 'chat.txt'), 'dirty\n');
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const endpoint = new URL(url).pathname;
    let body;
    if (endpoint.endsWith('/releases/latest')) body = { tag_name: 'v1.37.3', prerelease: false, draft: false, published_at: '2026-09-08T00:00:00Z', body: 'Stable release notes' };
    else if (endpoint.endsWith('/commits/v1.37.3')) body = { sha: base };
    else if (endpoint.endsWith('/commits/main')) body = { sha: main, commit: { message: 'fix: Safari Enter', committer: { date: '2026-09-21T00:00:00Z' } } };
    else if (endpoint.includes('/compare/')) body = { total_commits: 1, commits: [{ sha: main, commit: { message: 'fix: Safari Enter', committer: { date: '2026-09-21T00:00:00Z' } } }], files: [{ filename: 'chat.txt' }] };
    else throw new Error(`Unexpected public endpoint: ${url}`);
    return new Response(JSON.stringify(body));
  };
  return { repo, git, base, main, calls, fetchImpl, reportPath: path.join(dir, 'report.json') };
}

test('check reports stable release and main separately, preserves HEAD, index and dirty files', async (t) => {
  const f = await fixture(t);
  const before = { head: f.git('rev-parse', 'HEAD'), index: await readFile(path.join(f.repo, '.git/index')), status: f.git('status', '--porcelain'), body: await readFile(path.join(f.repo, 'chat.txt')) };
  const checker = createUpstreamChecker(f);
  const report = await checker.check();
  assert.equal(report.status, 'ok');
  assert.equal(report.release.tag, 'v1.37.3');
  assert.equal(report.release.sha, f.base);
  assert.equal(report.upstream.sha, f.main);
  assert.equal(report.fork.sha, before.head);
  assert.equal(report.fork.version, '1.37.0');
  assert.equal(report.fork.dirty, true);
  assert.equal(report.approvalRequired, true);
  assert.equal(report.changes.candidates[0].subject, 'fix: Safari Enter');
  assert.equal(report.changes.candidates[0].coverage, 'not-patch-equivalent');
  assert.ok(report.changes.overlap.includes('chat.txt'));
  assert.equal(f.git('rev-parse', 'HEAD'), before.head);
  assert.deepEqual(await readFile(path.join(f.repo, '.git/index')), before.index);
  assert.equal(f.git('status', '--porcelain'), before.status);
  assert.deepEqual(await readFile(path.join(f.repo, 'chat.txt')), before.body);
  for (const call of f.calls) {
    assert.equal(new URL(call.url).host, 'api.github.com');
    assert.ok(new URL(call.url).pathname.startsWith('/repos/siteboon/claudecodeui/'));
    assert.equal(call.options.headers.Authorization, undefined);
    assert.equal(call.options.redirect, 'error');
  }
});

test('failed refresh retains last successful data and marks it stale, including first-run failure', async (t) => {
  const f = await fixture(t);
  const good = await createUpstreamChecker(f).check();
  const failedChecker = createUpstreamChecker({ ...f, fetchImpl: async () => new Response('{}', { status: 503 }), now: () => new Date('2026-10-01T08:00:00Z') });
  const failure = await failedChecker.check();
  assert.equal(failure.status, 'error');
  assert.equal(failure.stale, true);
  assert.equal(failure.checkedAt, '2026-10-01T08:00:00.000Z');
  assert.equal(failure.lastSuccessfulCheckAt, good.checkedAt);
  assert.equal(failure.upstream.sha, f.main);
  assert.equal(failure.release.tag, 'v1.37.3');
  assert.match(failure.error, /503/);
  assert.equal((await failedChecker.read()).status, 'error');
  const initial = await createUpstreamChecker({ ...f, reportPath: `${f.reportPath}.first`, fetchImpl: async () => { throw new Error('offline'); } }).check();
  assert.equal(initial.status, 'error');
  assert.equal(initial.lastSuccessfulCheckAt, null);
  assert.equal(initial.release, undefined);
  assert.equal(initial.approvalRequired, true);
});

test('concurrent checks share work; a separate-process lock blocks network without replacing the report', async (t) => {
  const f = await fixture(t);
  const checker = createUpstreamChecker(f);
  const [one, two] = await Promise.all([checker.check(), createUpstreamChecker(f).check()]);
  assert.equal(one.checkedAt, two.checkedAt);
  assert.equal(f.calls.filter(call => call.url.endsWith('/releases/latest')).length, 1);
  const cached = await readFile(f.reportPath, 'utf8');
  await writeFile(`${f.reportPath}.lock`, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
  const locked = await checker.check();
  assert.equal(locked.checking, true);
  assert.equal(locked.upstream.sha, f.main);
  assert.equal(await readFile(f.reportPath, 'utf8'), cached);
  assert.equal(f.calls.length, 4);
});

test('unknown main objects report uncertainty and an old successful report is explicitly stale', async (t) => {
  const f = await fixture(t);
  const unknown = '9'.repeat(40);
  const fetchImpl = async (url, options) => url.endsWith('/commits/main')
    ? new Response(JSON.stringify({ sha: unknown })) : f.fetchImpl(url, options);
  const report = await createUpstreamChecker({ ...f, fetchImpl, now: () => new Date('2026-09-20T00:00:00Z') }).check();
  assert.equal(report.status, 'ok');
  assert.equal(report.upstream.sha, unknown);
  assert.equal(report.changes.ancestry, null);
  assert.equal(report.changes.candidates[0].coverage, 'unknown');
  assert.ok(report.changes.risks.some(risk => risk.includes('не подтверждены')));
  const later = await createUpstreamChecker({ ...f, now: () => new Date('2026-09-23T00:00:00Z') }).read();
  assert.equal(later.stale, true);
  assert.equal(later.lastSuccessfulCheckAt, '2026-09-20T00:00:00.000Z');
});

test('report includes a dated manual shortlist and requires re-review after revision changes', async (t) => {
  const f = await fixture(t);
  const report = await createUpstreamChecker(f).check();
  assert.equal(report.reviewedProposal.reviewedAt, '2026-09-24');
  assert.equal(report.reviewedProposal.needsReview, true);
  assert.equal(report.reviewedProposal.firstBatch[0].sha, '557109a2e98e833ad9cb6659ec89e97ccacdd024');
  assert.equal(report.reviewedProposal.firstBatch[0].coverage, 'missing-at-review');
  assert.ok(report.reviewedProposal.alreadyPresent.some(item => item.includes('история ввода')));
});
