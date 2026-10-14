import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  projectsDb,
  sessionsDb,
  userDb,
  userProjectAccessDb,
} from '@/modules/database/index.js';
import { createSessionAttentionService } from '@/modules/session-attention/session-attention.service.js';
import {
  createMemorySuggestionsService,
  type MemorySuggestionsDependencies,
} from '@/modules/memory-suggestions/memory-suggestions.service.js';
import type { CompleteJsonOptions } from '@/shared/local-llm.js';

// Spec stories 44–48 through the module's public face, on a temporary
// database and a temporary vault (never the real one).

const NOW = new Date('2026-10-12T12:00:00.000Z');
const HOUR_AGO = new Date(NOW.getTime() - 60 * 60_000);

type Fixture = {
  adminId: number;
  memberId: number;
  sessionId: string;
  projectId: string;
  vault: string;
};

async function withIsolatedWorld(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const previousDb = process.env.DATABASE_PATH;
  const dir = await mkdtemp(path.join(tmpdir(), 'memory-suggestions-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(dir, 'auth.db');
  await initializeDatabase();
  try {
    const admin = userDb.createUserWithRole('dima', 'x', 'admin');
    const member = userDb.createUserWithRole('guest', 'x', 'user');
    const sessionId = sessionsDb.createSession('sess-mem', 'claude', '/workspace/alpha', 'Чиню хук');
    const projectId = projectsDb.getProjectPath('/workspace/alpha')!.project_id;
    const vault = path.join(await realpath(dir), 'vault');
    await mkdir(path.join(vault, 'wiki', 'entities'), { recursive: true });
    // Notes the model's links are checked against: one it links, one of the project.
    await writeFile(path.join(vault, 'wiki', 'entities', 'neo3-agent-system.md'), '# Neo3\n');
    await writeFile(path.join(vault, 'wiki', 'entities', 'alpha.md'), '# alpha\n');
    await run({ adminId: Number(admin.id), memberId: Number(member.id), sessionId, projectId, vault });
  } finally {
    closeConnection();
    if (previousDb === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDb;
    await rm(dir, { recursive: true, force: true });
  }
}

/** Drives the real status module: a run that ended `at`, started by `userId`. */
function finishRun(fixture: Fixture, userId: number, at: Date): void {
  const attention = createSessionAttentionService({
    broadcast: () => {},
    fetchLastAssistantText: async () => 'Готово, хук починен.',
    now: () => at,
  });
  const run = { appSessionId: fixture.sessionId, provider: 'claude', userId, projectId: fixture.projectId };
  attention.recordRunStart({ ...run, userId });
  attention.recordRunEvent(run, { kind: 'text', role: 'assistant', content: 'Готово, хук починен.' });
  attention.recordRunEvent(run, { kind: 'complete', exitCode: 0, aborted: false });
  // Seen through the admin's eyes: access roles come from the database, so a
  // member's own view would not show an ungranted project.
  const [item] = attention.listForUser({ id: fixture.adminId, role: 'admin' });
  assert.equal(item.state, 'done', 'fixture: the run must end as done');
}

const WORKED_TRANSCRIPT = [
  { kind: 'text', role: 'user', content: 'почини стоп-хук' },
  { kind: 'tool_use', toolName: 'Edit', toolInput: { file_path: '/x/settings.json' } },
  { kind: 'text', role: 'assistant', content: 'Починил: хук выходит при NEO3_SESSION=1.' },
  { kind: 'text', role: 'user', content: 'отлично' },
];

const GOOD_NOTE = {
  worth: true,
  title: 'Stop hook exits inside Neo3',
  folder: 'wiki/synthesis',
  tags: ['neo3'],
  aliases: [],
  body: 'Хук выходит при NEO3_SESSION=1. См. [[neo3-agent-system]].',
};

function service(
  fixture: Fixture,
  overrides: MemorySuggestionsDependencies & { calls?: CompleteJsonOptions[]; answer?: unknown } = {},
) {
  const calls = overrides.calls ?? [];
  return createMemorySuggestionsService({
    fetchHistory: async () => ({ messages: WORKED_TRANSCRIPT }),
    complete: async (options) => {
      calls.push(options);
      return overrides.answer === undefined ? GOOD_NOTE : overrides.answer;
    },
    now: () => NOW,
    vaultDir: () => fixture.vault,
    broadcast: () => {},
    // The card flow below is tested with auto-write off; auto-write has its own tests.
    autoWrite: () => false,
    ...overrides,
  });
}

// 13.10: Dima always pressed «Записать» — a good note is now written by itself.
test('auto-write: a good note lands in the vault with no card and no tap', async () => {
  await withIsolatedWorld(async (fixture) => {
    finishRun(fixture, fixture.adminId, HOUR_AGO);
    const memory = service(fixture, { autoWrite: () => true });

    await memory.runCheck();

    assert.deepEqual(memory.list({ id: fixture.adminId, role: 'admin' }), []);
    const files = await readdir(path.join(fixture.vault, 'wiki', 'synthesis'));
    assert.equal(files.length, 1);
    assert.match(await readFile(path.join(fixture.vault, 'wiki', 'synthesis', files[0]), 'utf8'), /# Stop hook exits inside Neo3/);
  });
});

test('auto-write that fails leaves the card, so the note is not lost', async () => {
  await withIsolatedWorld(async (fixture) => {
    finishRun(fixture, fixture.adminId, HOUR_AGO);
    // A file where the folder should be: the write fails.
    await writeFile(path.join(fixture.vault, 'wiki', 'synthesis'), 'not a folder');
    const memory = service(fixture, { autoWrite: () => true });

    await memory.runCheck();

    const items = memory.list({ id: fixture.adminId, role: 'admin' });
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'Stop hook exits inside Neo3');
  });
});

test('a quiet admin session with real work gets one proposed note, and the model is asked only once', async () => {
  await withIsolatedWorld(async (fixture) => {
    finishRun(fixture, fixture.adminId, HOUR_AGO);
    const calls: CompleteJsonOptions[] = [];
    const memory = service(fixture, { calls });

    await memory.runCheck();
    await memory.runCheck();

    assert.equal(calls.length, 1);
    const items = memory.list({ id: fixture.adminId, role: 'admin' }, { sessionId: fixture.sessionId });
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'Stop hook exits inside Neo3');
    assert.equal(items[0].sessionId, fixture.sessionId);
    assert.match(items[0].body, /^---\ncreated: 2026-10-12\n/);
  });
});

test('model down: 3 attempts across ticks, then the session is given up on', async () => {
  await withIsolatedWorld(async (fixture) => {
    finishRun(fixture, fixture.adminId, HOUR_AGO);
    const calls: CompleteJsonOptions[] = [];
    const memory = service(fixture, { calls, answer: null });

    for (let tick = 0; tick < 6; tick += 1) {
      await memory.runCheck();
    }

    assert.equal(calls.length, 3);
    assert.deepEqual(memory.list({ id: fixture.adminId, role: 'admin' }), []);
  });
});

test('worth=false: nothing is shown and the session is not asked about again', async () => {
  await withIsolatedWorld(async (fixture) => {
    finishRun(fixture, fixture.adminId, HOUR_AGO);
    const calls: CompleteJsonOptions[] = [];
    const memory = service(fixture, { calls, answer: { worth: false } });

    await memory.runCheck();
    await memory.runCheck();

    assert.equal(calls.length, 1);
    assert.deepEqual(memory.list({ id: fixture.adminId, role: 'admin' }), []);
  });
});

test('only admin sessions are reviewed', async () => {
  await withIsolatedWorld(async (fixture) => {
    finishRun(fixture, fixture.memberId, HOUR_AGO);
    const calls: CompleteJsonOptions[] = [];
    await service(fixture, { calls }).runCheck();
    assert.equal(calls.length, 0);
  });
});

test('a session done 10 minutes ago is not reviewed yet', async () => {
  await withIsolatedWorld(async (fixture) => {
    finishRun(fixture, fixture.adminId, new Date(NOW.getTime() - 10 * 60_000));
    const calls: CompleteJsonOptions[] = [];
    await service(fixture, { calls }).runCheck();
    assert.equal(calls.length, 0);
  });
});

test('a session without edits or commands never reaches the model', async () => {
  await withIsolatedWorld(async (fixture) => {
    finishRun(fixture, fixture.adminId, HOUR_AGO);
    const calls: CompleteJsonOptions[] = [];
    const chatOnly = [
      { kind: 'text', role: 'user', content: 'что такое num_ctx?' },
      { kind: 'text', role: 'assistant', content: 'Окно контекста.' },
      { kind: 'text', role: 'user', content: 'спасибо' },
    ];
    await service(fixture, { calls, fetchHistory: async () => ({ messages: chatOnly }) }).runCheck();
    assert.equal(calls.length, 0);
  });
});

test('the model gets the memory model name and a transcript with secrets scrubbed', async () => {
  await withIsolatedWorld(async (fixture) => {
    finishRun(fixture, fixture.adminId, HOUR_AGO);
    const calls: CompleteJsonOptions[] = [];
    const key = 'sk-ant-api03-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const withKey = [...WORKED_TRANSCRIPT, { kind: 'text', role: 'user', content: `ключ ${key}` }];
    const previous = process.env.LOCAL_LLM_MEMORY_MODEL;
    delete process.env.LOCAL_LLM_MEMORY_MODEL;
    try {
      await service(fixture, { calls, fetchHistory: async () => ({ messages: withKey }) }).runCheck();
    } finally {
      if (previous !== undefined) process.env.LOCAL_LLM_MEMORY_MODEL = previous;
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, 'qwen3.5:9b');
    assert.ok(!calls[0].prompt.includes(key));
    assert.ok(calls[0].prompt.includes('почини стоп-хук'));
    assert.ok(calls[0].prompt.includes('- wiki/entities/alpha'), 'the model sees the real notes of the project');
  });
});

test('«Записать»: only an admin writes; the file lands in the vault and the suggestion goes away', async () => {
  await withIsolatedWorld(async (fixture) => {
    finishRun(fixture, fixture.adminId, HOUR_AGO);
    const memory = service(fixture);
    await memory.runCheck();
    const admin = { id: fixture.adminId, role: 'admin' };
    const [item] = memory.list(admin);

    assert.deepEqual(await memory.write({ id: fixture.memberId, role: 'user' }, item.id), { status: 'forbidden' });

    const result = await memory.write(admin, item.id);
    assert.equal(result.status, 'ok');
    if (result.status !== 'ok') return;
    assert.equal(result.relativePath, 'wiki/synthesis/stop-hook-exits-inside-neo3.md');
    assert.equal(result.path, path.join(fixture.vault, 'wiki', 'synthesis', 'stop-hook-exits-inside-neo3.md'));
    assert.match(await readFile(result.path, 'utf8'), /# Stop hook exits inside Neo3/);
    assert.deepEqual(memory.list(admin), []);

    // A second tap answers with the same path instead of a second file.
    const again = await memory.write(admin, item.id);
    assert.equal(again.status === 'ok' && again.relativePath, 'wiki/synthesis/stop-hook-exits-inside-neo3.md');
  });
});

test('«Не надо»: the suggestion disappears and cannot be written afterwards', async () => {
  await withIsolatedWorld(async (fixture) => {
    finishRun(fixture, fixture.adminId, HOUR_AGO);
    const memory = service(fixture);
    await memory.runCheck();
    const admin = { id: fixture.adminId, role: 'admin' };
    const [item] = memory.list(admin);

    assert.deepEqual(memory.dismiss(admin, item.id), { status: 'ok' });
    assert.deepEqual(memory.list(admin), []);
    assert.deepEqual(await memory.write(admin, item.id), { status: 'gone' });
  });
});

test('non-admins never see proposed notes', async () => {
  await withIsolatedWorld(async (fixture) => {
    finishRun(fixture, fixture.adminId, HOUR_AGO);
    const memory = service(fixture);
    await memory.runCheck();
    assert.deepEqual(memory.list({ id: fixture.memberId, role: 'user' }), []);
  });
});

test('two «Записать» at once: exactly one file; the other gets the same path or a refusal', async () => {
  await withIsolatedWorld(async (fixture) => {
    finishRun(fixture, fixture.adminId, HOUR_AGO);
    const memory = service(fixture);
    await memory.runCheck();
    const admin = { id: fixture.adminId, role: 'admin' };
    const [item] = memory.list(admin);

    const [first, second] = await Promise.all([memory.write(admin, item.id), memory.write(admin, item.id)]);

    const files = await readdir(path.join(fixture.vault, 'wiki', 'synthesis'));
    assert.deepEqual(files, ['stop-hook-exits-inside-neo3.md']);
    const ok = [first, second].filter((result) => result.status === 'ok');
    assert.ok(ok.length >= 1);
    for (const result of [first, second]) {
      if (result.status === 'ok') {
        assert.equal(result.relativePath, 'wiki/synthesis/stop-hook-exits-inside-neo3.md');
      } else {
        assert.equal(result.status, 'busy');
      }
    }
  });
});

test('«Не надо» while the note is being written is refused: no file with a dismissed suggestion', async () => {
  await withIsolatedWorld(async (fixture) => {
    finishRun(fixture, fixture.adminId, HOUR_AGO);
    const memory = service(fixture);
    await memory.runCheck();
    const admin = { id: fixture.adminId, role: 'admin' };
    const [item] = memory.list(admin);

    const writing = memory.write(admin, item.id);
    const dismissed = memory.dismiss(admin, item.id);
    const written = await writing;

    assert.deepEqual(dismissed, { status: 'gone' });
    assert.equal(written.status, 'ok');
  });
});

test('«Не надо» is admin-only, same rule as the list', async () => {
  await withIsolatedWorld(async (fixture) => {
    finishRun(fixture, fixture.adminId, HOUR_AGO);
    const memory = service(fixture);
    await memory.runCheck();
    const [item] = memory.list({ id: fixture.adminId, role: 'admin' });
    // Even with access to the project a non-admin cannot dismiss Dima's note.
    userProjectAccessDb.grantAccess(fixture.memberId, fixture.projectId, fixture.adminId);

    assert.deepEqual(memory.dismiss({ id: fixture.memberId, role: 'user' }, item.id), { status: 'forbidden' });
    assert.equal(memory.list({ id: fixture.adminId, role: 'admin' }).length, 1);
  });
});

test('first and repeated «Записать» answer the same real absolute path, even via a symlinked vault', async () => {
  await withIsolatedWorld(async (fixture) => {
    finishRun(fixture, fixture.adminId, HOUR_AGO);
    const link = `${fixture.vault}-link`;
    await symlink(fixture.vault, link);
    const memory = service(fixture, { vaultDir: () => link });
    await memory.runCheck();
    const admin = { id: fixture.adminId, role: 'admin' };
    const [item] = memory.list(admin);

    const first = await memory.write(admin, item.id);
    const again = await memory.write(admin, item.id);

    const expected = path.join(fixture.vault, 'wiki', 'synthesis', 'stop-hook-exits-inside-neo3.md');
    assert.equal(first.status === 'ok' && first.path, expected);
    assert.equal(again.status === 'ok' && again.path, expected);
  });
});

test('notes switched off: the quiet chat is not read, the model is not asked, the list is empty', async () => {
  await withIsolatedWorld(async (fixture) => {
    finishRun(fixture, fixture.adminId, HOUR_AGO);
    const calls: CompleteJsonOptions[] = [];
    let reads = 0;
    const off = new Set<string>(['modMemoryNotes']);
    const memory = service(fixture, {
      calls,
      fetchHistory: async () => {
        reads += 1;
        return { messages: WORKED_TRANSCRIPT };
      },
      isModOn: (_userId, key) => !off.has(key),
    });

    assert.deepEqual(await memory.runCheck(), { reviewed: 0 });
    assert.equal(reads, 0);
    assert.equal(calls.length, 0);

    // Switched back on: the same chat is reviewed as usual — and while off,
    // a ready card is not shown.
    off.clear();
    await memory.runCheck();
    assert.equal(calls.length, 1);
    assert.equal(memory.list({ id: fixture.adminId, role: 'admin' }).length, 1);
    off.add('modMemoryNotes');
    assert.deepEqual(memory.list({ id: fixture.adminId, role: 'admin' }), []);
  });
});
