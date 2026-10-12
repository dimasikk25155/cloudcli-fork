import assert from 'node:assert/strict';
import test from 'node:test';

import { parseNoteAnswer } from '@/modules/memory-suggestions/vault-note.js';

// Spec story 46 / decision 20: the model decides whether a note is worth it;
// a note follows the vault template (frontmatter created/tags/aliases, H1,
// at least one [[wikilink]]) and lands only in a folder from the vault rule,
// anything else becomes wiki/synthesis.

const CONTEXT = { today: '2026-10-12', projectFolders: ['Tyres', 'mebelsolnza'] };

test('worth=false means nothing to show', () => {
  assert.deepEqual(parseNoteAnswer({ worth: false }, CONTEXT), { kind: 'skip' });
});

test('a good answer becomes a note in the vault template', () => {
  const result = parseNoteAnswer(
    {
      worth: true,
      title: 'Ollama context window for memory notes',
      folder: 'wiki/synthesis',
      tags: ['ollama', 'neo3'],
      aliases: ['memory notes ctx'],
      body: 'Ollama обрезает промпт по num_ctx. Связано с [[windows-server]].',
    },
    CONTEXT,
  );
  assert.equal(result.kind, 'note');
  if (result.kind !== 'note') return;
  assert.equal(result.title, 'Ollama context window for memory notes');
  assert.equal(result.folder, 'wiki/synthesis');
  assert.equal(
    result.body,
    [
      '---',
      'created: 2026-10-12',
      'tags: [ollama, neo3]',
      'aliases: [memory notes ctx]',
      '---',
      '# Ollama context window for memory notes',
      '',
      'Ollama обрезает промпт по num_ctx. Связано с [[windows-server]].',
      '',
    ].join('\n'),
  );
});

const note = (folder: unknown) =>
  parseNoteAnswer({ worth: true, title: 'T', folder, body: 'факт, см. [[x]]' }, CONTEXT);
const folderOf = (folder: unknown) => {
  const result = note(folder);
  return result.kind === 'note' ? result.folder : `(${result.kind})`;
};

test('folders from the vault rule are kept', () => {
  assert.equal(folderOf('wiki/concepts'), 'wiki/concepts');
  assert.equal(folderOf('wiki/entities/'), 'wiki/entities');
  assert.equal(folderOf('Brand/clients'), 'Brand/clients');
  assert.equal(folderOf('Tyres'), 'Tyres');
});

test('anything outside the rule falls back to wiki/synthesis', () => {
  for (const folder of ['wiki', 'Brand', 'Brand/secret-stuff', 'RandomProject', '../outside', '/etc', 'wiki/../..', 'Tyres/../..', 42, undefined]) {
    assert.equal(folderOf(folder), 'wiki/synthesis', String(folder));
  }
});

test('a note without a single [[wikilink]] is malformed, not shown', () => {
  const result = parseNoteAnswer({ worth: true, title: 'T', folder: 'wiki/concepts', body: '# T\n\nфакт без ссылок' }, CONTEXT);
  assert.equal(result.kind, 'invalid');
});

test('frontmatter written by the model is replaced by ours, keeping its tags and aliases', () => {
  const result = parseNoteAnswer(
    {
      worth: true,
      title: 'Fix',
      folder: 'wiki/synthesis',
      body: '---\ncreated: 1999-01-01\ntags: [neo3, hooks]\naliases: [stop hook]\nupdated: 1999-01-02\n---\n# Fix\n\nСм. [[neo3]].',
    },
    CONTEXT,
  );
  assert.equal(result.kind, 'note');
  if (result.kind !== 'note') return;
  assert.equal(result.body, '---\ncreated: 2026-10-12\ntags: [neo3, hooks]\naliases: [stop hook]\n---\n# Fix\n\nСм. [[neo3]].\n');
});

test('a key the model copied into the note is scrubbed before it can reach the vault', () => {
  const key = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const result = parseNoteAnswer({ worth: true, title: 'Key', folder: 'wiki/concepts', body: `ключ ${key}, см. [[secrets]]` }, CONTEXT);
  assert.equal(result.kind, 'note');
  if (result.kind !== 'note') return;
  assert.ok(!result.body.includes(key));
});
