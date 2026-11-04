import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { UNKNOWN, buildInspectorRows, turnFileChanges, type InspectorInput } from './inspectorModel.js';

const value = (rows: ReturnType<typeof buildInspectorRows>, id: string) => rows.find((row) => row.id === id);

const full: InspectorInput = {
  projectPath: '/Users/dimasik/Antigravity Project/claude agent/cloudcli-fork',
  git: {
    branch: 'feat/neo3-workbench-build',
    mainBranch: 'main',
    uncommitted: 2,
    notInMain: 3,
    unpushed: 1,
    hasRemote: true,
    lists: { files: ['src/a.ts', 'src/b.ts'], notInMain: [], unpushed: [] },
  },
  provider: 'claude',
  modelLabel: 'Opus 4.7 (1M)',
  effort: 'high',
  attention: { state: 'waiting', reason: 'ask' },
  context: { usedPct: 25, used: 250_000, window: 1_000_000 },
  mcpNames: ['telegram', 'ollama'],
};

test('a Claude chat with everything known', () => {
  const rows = buildInspectorRows(full);
  assert.equal(value(rows, 'folder')?.value, full.projectPath);
  assert.equal(value(rows, 'branch')?.value, 'feat/neo3-workbench-build');
  assert.equal(value(rows, 'branch')?.detail, 'Незакоммиченных файлов: 2');
  assert.equal(value(rows, 'engine')?.value, 'Claude');
  assert.equal(value(rows, 'model')?.value, 'Opus 4.7 (1M)');
  assert.equal(value(rows, 'effort')?.value, 'high');
  assert.equal(value(rows, 'status')?.value, 'Ждёт ответа');
  assert.equal(value(rows, 'context')?.value, '25% · 250 000 из 1 000 000 токенов');
  assert.equal(value(rows, 'mcp')?.value, 'telegram, ollama');
  assert.equal(value(rows, 'changes')?.value, 'Незакоммиченных: 2');
});

test('Codex and Grok get the same rows; their own engine name', () => {
  assert.equal(value(buildInspectorRows({ ...full, provider: 'codex' }), 'engine')?.value, 'Codex');
  assert.equal(value(buildInspectorRows({ ...full, provider: 'grok' }), 'engine')?.value, 'Grok');
  assert.deepEqual(
    buildInspectorRows({ ...full, provider: 'grok' }).map((row) => row.id),
    buildInspectorRows(full).map((row) => row.id),
  );
});

test('what the engine or Neo3 did not report is «неизвестно», never 0', () => {
  const rows = buildInspectorRows({
    projectPath: null,
    git: null,
    provider: 'grok',
    modelLabel: null,
    effort: null,
    attention: null,
    context: { usedPct: null, used: null, window: null },
    mcpNames: null,
  });
  for (const id of ['folder', 'branch', 'model', 'status', 'context', 'mcp', 'turn', 'changes']) {
    assert.equal(value(rows, id)?.value, UNKNOWN, id);
  }
  assert.equal(value(rows, 'branch')?.detail, undefined);
  // A missing effort means the model's own default (the rule of the effort chip).
  assert.equal(value(rows, 'effort')?.value, 'по умолчанию модели');
});

test('occupancy without a model window shows tokens and says the window is unknown', () => {
  const rows = buildInspectorRows({ ...full, context: { usedPct: null, used: 12_000, window: null } });
  assert.equal(value(rows, 'context')?.value, '12 000 токенов');
  assert.equal(value(rows, 'context')?.detail, 'Окно модели неизвестно');
});

test('a clean tree and no MCP are said plainly', () => {
  const rows = buildInspectorRows({
    ...full,
    git: { ...full.git!, uncommitted: 0, lists: { files: [], notInMain: [], unpushed: [] } },
    mcpNames: [],
    effort: 'default',
  });
  assert.equal(value(rows, 'branch')?.detail, 'Всё закоммичено');
  assert.equal(value(rows, 'changes')?.value, 'Нет незакоммиченных файлов');
  assert.equal(value(rows, 'mcp')?.value, 'Не подключены');
  assert.equal(value(rows, 'effort')?.value, 'по умолчанию модели');
});

// R07: «Изменения хода» — the files the agent changed since the last user message.
const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/turn-${name}.json`, import.meta.url), 'utf8'));
const P = '/home/user/project';

test('turn changes: Claude Edit, Write, MultiEdit, NotebookEdit since the last user message', () => {
  assert.deepEqual(turnFileChanges(fixture('claude')), [
    `${P}/src/footer.tsx`,
    `${P}/docs/notes.md`,
    `${P}/analysis.ipynb`,
  ]);
});

test('turn changes: Codex FileChanges in both shapes, a rename counts both paths', () => {
  assert.deepEqual(turnFileChanges(fixture('codex-history')), [
    `${P}/src/a.ts`,
    `${P}/src/b.ts`,
    `${P}/src/old-name.ts`,
    `${P}/src/new-name.ts`,
  ]);
  assert.deepEqual(turnFileChanges(fixture('codex-live')), [`${P}/src/a.ts`, `${P}/src/dead.ts`]);
});

test('turn changes: Grok search_replace and write', () => {
  assert.deepEqual(turnFileChanges(fixture('grok')), [`${P}/lines.json`, `${P}/README.md`]);
});

test('turn changes: nothing yet after a fresh user message; unreadable input is skipped', () => {
  const messages = [...fixture('claude'), { type: 'user', content: 'Ещё', timestamp: 11 }];
  assert.deepEqual(turnFileChanges(messages), []);
  assert.deepEqual(turnFileChanges([
    { type: 'assistant', timestamp: 1, isToolUse: true, toolName: 'Edit', toolInput: '{not json' },
    { type: 'assistant', timestamp: 2, isToolUse: true, toolName: 'Write', toolInput: { file_path: '/x.md' } },
  ] as any), ['/x.md']);
});

test('inspector: «Изменения хода» lists the turn, the uncommitted count is its own row', () => {
  const rows = buildInspectorRows({ ...full, turnFiles: ['src/footer.tsx'] });
  assert.equal(value(rows, 'turn')?.label, 'Изменения хода');
  assert.deepEqual(value(rows, 'turn')?.items, ['src/footer.tsx']);
  assert.equal(value(rows, 'changes')?.value, 'Незакоммиченных: 2');
  assert.equal(value(rows, 'changes')?.items, undefined);
  assert.equal(value(buildInspectorRows({ ...full, turnFiles: [] }), 'turn')?.value, 'В этом ходе файлы не менялись');
  assert.equal(value(buildInspectorRows({ ...full, turnFiles: null }), 'turn')?.value, UNKNOWN);
});
