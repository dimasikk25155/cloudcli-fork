import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionSynchronizer } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';
import { CodexSessionSynchronizer } from '@/modules/providers/list/codex/codex-session-synchronizer.provider.js';

// What the composer sends for a picture: typed text (maybe none) plus the
// agent-only «откуда скрин» caption.
const CAPTION = '<screenshot_context>\nскриншот a.png, вставлен из буфера, 12.10.2026 20:58; прикреплён в Neo3: проект Демо\n</screenshot_context>';
const withCaption = (typed: string) => (typed ? `${typed}\n\n${CAPTION}` : CAPTION);

async function withIsolatedHome(run: (home: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'agent-only-titles-'));
  const originalHomedir = os.homedir;
  const previousDatabasePath = process.env.DATABASE_PATH;
  (os as any).homedir = () => home;
  closeConnection();
  process.env.DATABASE_PATH = path.join(home, 'auth.db');
  await initializeDatabase();
  try {
    await run(home);
  } finally {
    closeConnection();
    (os as any).homedir = originalHomedir;
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(home, { recursive: true, force: true });
  }
}

async function claudeTitleFor(home: string, sessionId: string, prompt: string): Promise<string | undefined> {
  const workspace = path.join(home, 'workspace');
  const dir = path.join(home, '.claude', 'projects', 'demo');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  await writeFile(file, [
    JSON.stringify({ type: 'user', sessionId, cwd: workspace, message: { role: 'user', content: prompt } }),
    JSON.stringify({ type: 'last-prompt', sessionId, lastPrompt: prompt }),
  ].join('\n') + '\n');
  const appId = await new ClaudeSessionSynchronizer().synchronizeFile(file);
  return appId ? sessionsDb.getSessionById(appId)?.custom_name ?? undefined : undefined;
}

async function codexTitleFor(home: string, codexId: string, firstMessage: string): Promise<string | undefined> {
  const workspace = path.join(home, 'workspace');
  await mkdir(workspace, { recursive: true });
  const dir = path.join(home, '.codex', 'sessions', '2026', '10', '12');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `rollout-${codexId}.jsonl`), [
    JSON.stringify({ type: 'session_meta', payload: { id: codexId, cwd: workspace } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: firstMessage } }),
  ].join('\n') + '\n');
  const appId = `app-${codexId}`;
  sessionsDb.createAppSession(appId, 'codex', workspace);
  sessionsDb.assignProviderSessionId(appId, codexId);
  await new CodexSessionSynchronizer().synchronize();
  return sessionsDb.getSessionById(appId)?.custom_name ?? undefined;
}

test('Claude: a prompt with a screenshot is titled by the typed text only', { concurrency: false }, async () => {
  await withIsolatedHome(async (home) => {
    assert.equal(await claudeTitleFor(home, 'claude-typed', withCaption('почини промокод')), 'почини промокод');
  });
});

test('Claude: a picture-only prompt falls back to the untitled name, not the caption', { concurrency: false }, async () => {
  await withIsolatedHome(async (home) => {
    assert.equal(await claudeTitleFor(home, 'claude-picture', withCaption('')), 'Untitled Claude Session');
  });
});

test('Codex: a prompt with a screenshot is titled by the typed text only', { concurrency: false }, async () => {
  await withIsolatedHome(async (home) => {
    assert.equal(await codexTitleFor(home, 'codex-typed', withCaption('почини промокод')), 'почини промокод');
  });
});

test('Codex: a picture-only prompt falls back to the untitled name, not the caption', { concurrency: false }, async () => {
  await withIsolatedHome(async (home) => {
    assert.equal(await codexTitleFor(home, 'codex-picture', withCaption('')), 'Untitled Codex Session');
  });
});
