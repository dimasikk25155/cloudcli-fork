import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createCodeStatusService } from '@/modules/code-status/index.js';

// getCodeStatus(projectPath, {isAdmin}) on throwaway git repositories: what
// the chat header learns about "where is my code".

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  // No machine config: no global hooks, templates, signing or default branch.
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
};
// The service under test runs git with this process's environment.
Object.assign(process.env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });

function git(cwd: string, args: string[], extraEnv: Record<string, string> = {}): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    env: { ...process.env, ...GIT_ENV, ...extraEnv },
    encoding: 'utf8',
  }).trim();
}

async function commitFile(cwd: string, name: string, message: string, date?: string): Promise<string> {
  await writeFile(path.join(cwd, name), `${message}\n`);
  git(cwd, ['add', name]);
  const env: Record<string, string> = date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {};
  git(cwd, ['commit', '-q', '-m', message], env);
  return git(cwd, ['rev-parse', 'HEAD']);
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'code-status-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A repo on `main` with one commit, ready for the scenario to diverge. */
async function initRepo(dir: string, mainName = 'main'): Promise<string> {
  const repo = path.join(dir, 'site-project');
  await mkdir(repo);
  git(repo, ['init', '-q', '-b', mainName]);
  await commitFile(repo, 'README.md', 'first');
  return repo;
}

/** Service with the network and the site registry switched off. */
function offlineService(dir: string) {
  return createCodeStatusService({
    fetchImpl: async () => {
      throw new Error('network must not be used');
    },
    registryFile: path.join(dir, 'no-registry.yaml'),
    secretsFile: path.join(dir, 'no-secrets.env'),
  });
}

test('a folder without git has no git part and no site part', async () => {
  await withTempDir(async (dir) => {
    const status = await offlineService(dir).getCodeStatus(dir, { isAdmin: true });
    assert.equal(status.git, null);
    assert.equal(status.site, null);
    assert.ok(!Number.isNaN(Date.parse(status.checkedAt)));
  });
});

test('uncommitted files are counted and listed', async () => {
  await withTempDir(async (dir) => {
    const repo = await initRepo(dir);
    await writeFile(path.join(repo, 'README.md'), 'changed\n');
    await writeFile(path.join(repo, 'new-page.tsx'), 'export {}\n');

    const status = await offlineService(dir).getCodeStatus(repo, { isAdmin: false });
    assert.ok(status.git);
    assert.equal(status.git.branch, 'main');
    assert.equal(status.git.mainBranch, 'main');
    assert.equal(status.git.uncommitted, 2);
    assert.deepEqual([...(status.git.lists?.files ?? [])].sort(), ['README.md', 'new-page.tsx']);
    assert.equal(status.git.notInMain, 0);
    assert.equal(status.git.unpushed, 0);
    assert.equal(status.git.hasRemote, false);
  });
});

test('commits on a feature branch are "not in main", one line each', async () => {
  await withTempDir(async (dir) => {
    const repo = await initRepo(dir);
    git(repo, ['checkout', '-q', '-b', 'feature/chip']);
    await commitFile(repo, 'a.txt', 'add chip');
    await commitFile(repo, 'b.txt', 'style chip');

    const status = await offlineService(dir).getCodeStatus(repo, { isAdmin: false });
    assert.ok(status.git);
    assert.equal(status.git.branch, 'feature/chip');
    assert.equal(status.git.uncommitted, 0);
    assert.equal(status.git.notInMain, 2);
    const subjects = (status.git.lists?.notInMain ?? []).map((line) => line.replace(/^[0-9a-f]+ /, ''));
    assert.deepEqual(subjects, ['style chip', 'add chip']);
  });
});

test('commits the remote does not have are "unpushed"; pushed ones are not', async () => {
  await withTempDir(async (dir) => {
    const remote = path.join(dir, 'remote.git');
    git(dir, ['init', '-q', '--bare', '-b', 'main', remote]);
    const repo = await initRepo(dir);
    git(repo, ['remote', 'add', 'origin', remote]);
    git(repo, ['push', '-q', '-u', 'origin', 'main']);
    await commitFile(repo, 'c.txt', 'not pushed yet');

    const status = await offlineService(dir).getCodeStatus(repo, { isAdmin: false });
    assert.ok(status.git);
    assert.equal(status.git.hasRemote, true);
    assert.equal(status.git.unpushed, 1);
    assert.equal(status.git.notInMain, 0);
    assert.equal(status.git.lists?.unpushed.length, 1);
    assert.match(status.git.lists?.unpushed[0] ?? '', / not pushed yet$/);
  });
});

test('main falls back to master', async () => {
  await withTempDir(async (dir) => {
    const repo = await initRepo(dir, 'master');
    git(repo, ['checkout', '-q', '-b', 'work']);
    await commitFile(repo, 'w.txt', 'work');

    const status = await offlineService(dir).getCodeStatus(repo, { isAdmin: false });
    assert.equal(status.git?.mainBranch, 'master');
    assert.equal(status.git?.notInMain, 1);
  });
});

test('without main, master or origin/HEAD there is no "not in main" item', async () => {
  await withTempDir(async (dir) => {
    const repo = await initRepo(dir, 'trunk');
    await commitFile(repo, 'x.txt', 'more');

    const status = await offlineService(dir).getCodeStatus(repo, { isAdmin: false });
    assert.ok(status.git);
    assert.equal(status.git.branch, 'trunk');
    assert.equal(status.git.mainBranch, null);
    assert.equal(status.git.notInMain, 0);
    assert.deepEqual(status.git.lists?.notInMain, []);
  });
});

test('main is taken from origin/HEAD when there is no local main or master', async () => {
  await withTempDir(async (dir) => {
    const remote = path.join(dir, 'remote.git');
    git(dir, ['init', '-q', '--bare', '-b', 'develop', remote]);
    const seed = await initRepo(dir, 'develop');
    git(seed, ['remote', 'add', 'origin', remote]);
    git(seed, ['push', '-q', 'origin', 'develop']);

    const clone = path.join(dir, 'clone');
    git(dir, ['clone', '-q', remote, clone]);
    git(clone, ['checkout', '-q', '-b', 'topic']);
    git(clone, ['branch', '-q', '-D', 'develop']);
    await commitFile(clone, 't.txt', 'topic work');

    const status = await offlineService(dir).getCodeStatus(clone, { isAdmin: false });
    assert.equal(status.git?.mainBranch, 'origin/develop');
    assert.equal(status.git?.notInMain, 1);
  });
});

test('long lists are capped at 20 lines while counts stay exact', async () => {
  await withTempDir(async (dir) => {
    const repo = await initRepo(dir);
    git(repo, ['checkout', '-q', '-b', 'many']);
    for (let index = 0; index < 23; index += 1) {
      await writeFile(path.join(repo, `file-${index}.txt`), `${index}\n`);
    }
    for (let index = 0; index < 22; index += 1) {
      git(repo, ['commit', '-q', '--allow-empty', '-m', `step ${index}`]);
    }

    const status = await offlineService(dir).getCodeStatus(repo, { isAdmin: false });
    assert.equal(status.git?.uncommitted, 23);
    assert.equal(status.git?.lists?.files.length, 20);
    assert.equal(status.git?.notInMain, 22);
    assert.equal(status.git?.lists?.notInMain.length, 20);
  });
});

// ---- Site part: Vercel (fetch stubbed) and the deploy-verify registry ----

const FAKE_TOKEN = 'vercel-test-token-0123456789';

type Call = { url: string; headers: Record<string, string> };

type FakeDeployment = { url: string; created: number; target?: string; meta?: Record<string, string> };

/** Vercel API stand-in: answers /v6/deployments by `target`, records every call. */
function fakeVercel(answers: { production: FakeDeployment[]; preview?: FakeDeployment[] }) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, headers: init?.headers ?? {} });
    const target = new URL(url).searchParams.get('target');
    const deployments = target === 'production' ? answers.production : answers.preview ?? [];
    return { ok: true, status: 200, json: async () => ({ deployments }) };
  };
  return { calls, fetchImpl };
}

async function linkToVercel(repo: string, dir: string): Promise<string> {
  // `vercel link` keeps .vercel out of git; so does this fixture.
  await writeFile(path.join(repo, '.git', 'info', 'exclude'), '.vercel\n');
  await mkdir(path.join(repo, '.vercel'));
  await writeFile(
    path.join(repo, '.vercel', 'project.json'),
    JSON.stringify({ orgId: 'team_testorg', projectId: 'prj_testproject' }),
  );
  const secretsFile = path.join(dir, 'secrets.env');
  await writeFile(secretsFile, `OTHER_KEY=nope\nVERCEL_TOKEN="${FAKE_TOKEN}"\n`);
  return secretsFile;
}

async function withoutEnvToken(run: () => Promise<void>): Promise<void> {
  const previous = process.env.VERCEL_TOKEN;
  delete process.env.VERCEL_TOKEN;
  try {
    await run();
  } finally {
    if (previous !== undefined) process.env.VERCEL_TOKEN = previous;
  }
}

test('Vercel: production built from the main tip is "fresh"; the branch preview is offered', async () => {
  await withoutEnvToken(() => withTempDir(async (dir) => {
    const repo = await initRepo(dir);
    const mainTip = await commitFile(repo, 'page.tsx', 'ship page');
    const secretsFile = await linkToVercel(repo, dir);
    git(repo, ['checkout', '-q', '-b', 'feature/x']);

    const vercel = fakeVercel({
      production: [{ url: 'site-abc.vercel.app', created: 1_760_000_000_000, meta: { githubCommitSha: mainTip } }],
      preview: [
        { url: 'site-other.vercel.app', created: 1_760_000_500_000, meta: { githubCommitRef: 'other' } },
        { url: 'site-feature.vercel.app', created: 1_760_000_400_000, meta: { githubCommitRef: 'feature/x' } },
      ],
    });
    const service = createCodeStatusService({
      fetchImpl: vercel.fetchImpl,
      secretsFile,
      registryFile: path.join(dir, 'none.yaml'),
    });

    const status = await service.getCodeStatus(repo, { isAdmin: true });
    assert.deepEqual(
      { kind: status.site?.kind, state: status.site?.state, sha: status.site?.sha, previewUrl: status.site?.previewUrl },
      { kind: 'vercel', state: 'fresh', sha: mainTip, previewUrl: 'https://site-feature.vercel.app' },
    );
    assert.equal(status.site?.url, 'https://site-abc.vercel.app');
    assert.equal(status.site?.deployedAt, new Date(1_760_000_000_000).toISOString());

    const production = vercel.calls.find((call) => new URL(call.url).searchParams.get('target') === 'production');
    assert.ok(production, 'production deployments were asked for');
    assert.equal(new URL(production.url).searchParams.get('projectId'), 'prj_testproject');
    assert.equal(new URL(production.url).searchParams.get('teamId'), 'team_testorg');
    assert.equal(production.headers.Authorization, `Bearer ${FAKE_TOKEN}`);
    assert.ok(!JSON.stringify(status).includes(FAKE_TOKEN), 'token never reaches the client');
  }));
});

test('Vercel: production built from an older commit is "stale"', async () => {
  await withoutEnvToken(() => withTempDir(async (dir) => {
    const repo = await initRepo(dir);
    const deployed = await commitFile(repo, 'v1.txt', 'v1');
    await commitFile(repo, 'v2.txt', 'v2');
    const secretsFile = await linkToVercel(repo, dir);

    const vercel = fakeVercel({
      production: [{ url: 'site.vercel.app', created: 1_760_000_000_000, meta: { githubCommitSha: deployed } }],
    });
    const status = await createCodeStatusService({
      fetchImpl: vercel.fetchImpl,
      secretsFile,
      registryFile: path.join(dir, 'none.yaml'),
    }).getCodeStatus(repo, { isAdmin: true });

    assert.equal(status.site?.state, 'stale');
    assert.equal(status.site?.sha, deployed);
    assert.equal(status.site?.previewUrl, null);
  }));
});

test('Vercel: a production SHA this repository does not have is "unknown", not "stale"', async () => {
  await withoutEnvToken(() => withTempDir(async (dir) => {
    const repo = await initRepo(dir);
    const secretsFile = await linkToVercel(repo, dir);
    const foreignSha = 'deadbeef'.repeat(5);

    const vercel = fakeVercel({
      production: [{ url: 'site.vercel.app', created: 1_760_000_000_000, meta: { githubCommitSha: foreignSha } }],
    });
    const status = await createCodeStatusService({
      fetchImpl: vercel.fetchImpl,
      secretsFile,
      registryFile: path.join(dir, 'none.yaml'),
    }).getCodeStatus(repo, { isAdmin: true });

    assert.equal(status.site?.state, 'unknown');
    assert.equal(status.site?.sha, foreignSha);
  }));
});

test('Vercel without a commit SHA compares the build time with the last main commit', async () => {
  await withoutEnvToken(() => withTempDir(async (dir) => {
    const repo = await initRepo(dir);
    await commitFile(repo, 'late.txt', 'late change', '2026-10-10T12:00:00Z');
    const secretsFile = await linkToVercel(repo, dir);
    const lastMainCommit = Date.parse('2026-10-10T12:00:00Z');

    const statusFor = async (created: number) => {
      const vercel = fakeVercel({ production: [{ url: 'cli-deploy.vercel.app', created }] });
      return createCodeStatusService({
        fetchImpl: vercel.fetchImpl,
        secretsFile,
        registryFile: path.join(dir, 'none.yaml'),
      }).getCodeStatus(repo, { isAdmin: true });
    };

    const before = await statusFor(lastMainCommit - 60_000);
    assert.equal(before.site?.state, 'stale');
    assert.equal(before.site?.sha, undefined);

    const after = await statusFor(lastMainCommit + 60_000);
    assert.equal(after.site?.state, 'fresh');
  }));
});

test('a Vercel failure makes the site "unknown" and keeps the git part', async () => {
  await withoutEnvToken(() => withTempDir(async (dir) => {
    const repo = await initRepo(dir);
    const secretsFile = await linkToVercel(repo, dir);
    await writeFile(path.join(repo, 'dirty.txt'), 'x\n');

    for (const fetchImpl of [
      async () => {
        throw new Error('getaddrinfo ENOTFOUND api.vercel.com');
      },
      async () => ({ ok: false, status: 403, json: async () => ({ error: { code: 'forbidden' } }) }),
    ]) {
      const status = await createCodeStatusService({
        fetchImpl,
        secretsFile,
        registryFile: path.join(dir, 'none.yaml'),
      }).getCodeStatus(repo, { isAdmin: true });
      assert.equal(status.site?.kind, 'vercel');
      assert.equal(status.site?.state, 'unknown');
      assert.equal(status.git?.uncommitted, 1);
    }
  }));
});

test('a non-admin gets no site part and the Vercel API is not called', async () => {
  await withoutEnvToken(() => withTempDir(async (dir) => {
    const repo = await initRepo(dir);
    const secretsFile = await linkToVercel(repo, dir);
    const vercel = fakeVercel({ production: [{ url: 'site.vercel.app', created: 1 }] });

    const status = await createCodeStatusService({
      fetchImpl: vercel.fetchImpl,
      secretsFile,
      registryFile: path.join(dir, 'none.yaml'),
    }).getCodeStatus(repo, { isAdmin: false });

    assert.equal(status.site, null);
    assert.equal(status.git?.mainBranch, 'main');
    assert.equal(vercel.calls.length, 0);
  }));
});

test('a project outside Vercel but in the site registry reports "up" / "down" by its folder name', async () => {
  await withTempDir(async (dir) => {
    const repo = await initRepo(dir);
    const registryFile = path.join(dir, 'sites.yaml');
    await writeFile(registryFile, [
      'sites:',
      '  - { project: other-site, url: "https://other.example/", marker: "x", crit: crit, note: "" }',
      '  - { project: site-project, url: "https://site.example/", marker: "", crit: opt, note: "a, b" }',
      '',
    ].join('\n'));

    const requested: string[] = [];
    const statusWith = (status: number) => createCodeStatusService({
      fetchImpl: async (url: string) => {
        requested.push(url);
        return { ok: status < 400, status, json: async () => ({}) };
      },
      registryFile,
      secretsFile: path.join(dir, 'none.env'),
    }).getCodeStatus(repo, { isAdmin: true });

    const up = await statusWith(200);
    assert.deepEqual(up.site, { kind: 'registry', url: 'https://site.example/', state: 'up' });
    const down = await statusWith(502);
    assert.equal(down.site?.state, 'down');
    assert.deepEqual(requested, ['https://site.example/', 'https://site.example/']);

    const unreachable = await createCodeStatusService({
      fetchImpl: async () => {
        throw new Error('connect ETIMEDOUT');
      },
      registryFile,
      secretsFile: path.join(dir, 'none.env'),
    }).getCodeStatus(repo, { isAdmin: true });
    assert.equal(unreachable.site?.state, 'down');
  });
});

test('a registry row without a confirmed URL means no site item', async () => {
  await withTempDir(async (dir) => {
    const repo = await initRepo(dir);
    const registryFile = path.join(dir, 'sites.yaml');
    await writeFile(registryFile, '  - { project: site-project, url: TODO_CONFIRM, marker: "", crit: opt, note: "" }\n');

    const status = await createCodeStatusService({
      fetchImpl: async () => {
        throw new Error('must not be called');
      },
      registryFile,
      secretsFile: path.join(dir, 'none.env'),
    }).getCodeStatus(repo, { isAdmin: true });
    assert.equal(status.site, null);
    assert.ok(status.git);
  });
});

test('answers are reused for 60 s; refresh asks again', async () => {
  await withoutEnvToken(() => withTempDir(async (dir) => {
    const repo = await initRepo(dir);
    const secretsFile = await linkToVercel(repo, dir);
    const vercel = fakeVercel({ production: [{ url: 'site.vercel.app', created: 1 }] });
    let clock = 1_000_000;
    const service = createCodeStatusService({
      fetchImpl: vercel.fetchImpl,
      secretsFile,
      registryFile: path.join(dir, 'none.yaml'),
      now: () => clock,
    });

    const productionCalls = () =>
      vercel.calls.filter((call) => new URL(call.url).searchParams.get('target') === 'production').length;

    await service.getCodeStatus(repo, { isAdmin: true });
    await writeFile(path.join(repo, 'new.txt'), 'x\n');
    clock += 59_000;
    const cached = await service.getCodeStatus(repo, { isAdmin: true });
    assert.equal(cached.git?.uncommitted, 0, 'within 60 s the cached answer is served');
    assert.equal(productionCalls(), 1);

    const refreshed = await service.getCodeStatus(repo, { isAdmin: true, refresh: true });
    assert.equal(refreshed.git?.uncommitted, 1);
    assert.equal(productionCalls(), 2);

    clock += 61_000;
    await service.getCodeStatus(repo, { isAdmin: true });
    assert.equal(productionCalls(), 3, 'after 60 s it is computed again');
  }));
});

test('refresh joins a check already running and is not repeated within a few seconds', async () => {
  await withoutEnvToken(() => withTempDir(async (dir) => {
    const repo = await initRepo(dir);
    const secretsFile = await linkToVercel(repo, dir);
    const vercel = fakeVercel({ production: [{ url: 'site.vercel.app', created: 1 }] });
    let clock = 5_000_000;
    const service = createCodeStatusService({
      fetchImpl: vercel.fetchImpl,
      secretsFile,
      registryFile: path.join(dir, 'none.yaml'),
      now: () => clock,
    });
    const productionCalls = () =>
      vercel.calls.filter((call) => new URL(call.url).searchParams.get('target') === 'production').length;

    // Three taps on «обновить» while the first check is still running: one check.
    await Promise.all([
      service.getCodeStatus(repo, { isAdmin: true, refresh: true }),
      service.getCodeStatus(repo, { isAdmin: true, refresh: true }),
      service.getCodeStatus(repo, { isAdmin: true, refresh: true }),
    ]);
    assert.equal(productionCalls(), 1);

    // A tap two seconds later is answered from that check.
    clock += 2_000;
    await service.getCodeStatus(repo, { isAdmin: true, refresh: true });
    assert.equal(productionCalls(), 1);

    // Ten seconds after the check, refresh runs a new one.
    clock += 8_000;
    await service.getCodeStatus(repo, { isAdmin: true, refresh: true });
    assert.equal(productionCalls(), 2);
  }));
});
