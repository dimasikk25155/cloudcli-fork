import assert from 'node:assert/strict';
import test from 'node:test';

import { parseNoteAnswer, relatedNotes, type NoteContext } from '@/modules/memory-suggestions/vault-note.js';

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

// 12.10: a live note came out in English with two links to notes that do not
// exist. Links are now checked against the vault and the body must be Russian.

const KNOWN = ['wiki/entities/insta-comments', 'insta-comments/meta-app-setup', 'wiki/index'];
const LINKED = { ...CONTEXT, knownNotes: KNOWN, relatedNotes: ['wiki/entities/insta-comments'] };
const bodyOf = (body: string, context: NoteContext = LINKED) => {
  const result = parseNoteAnswer({ worth: true, title: 'T', folder: 'wiki/synthesis', body }, context);
  return result.kind === 'note' ? result.body : `(${result.kind}${result.kind === 'invalid' ? `: ${result.reason}` : ''})`;
};

test('real links stay, by full path or by bare name, with alias and heading', () => {
  const body = bodyOf('Факт. См. [[wiki/entities/insta-comments]], [[meta-app-setup|настройка]] и [[Wiki/Index#Боты]].');
  assert.match(body, /\[\[wiki\/entities\/insta-comments\]\], \[\[meta-app-setup\|настройка\]\] и \[\[Wiki\/Index#Боты\]\]\./);
  assert.doesNotMatch(body, /## Связи/);
});

test('made-up links become plain text and the project note is linked instead', () => {
  const body = bodyOf('Факт про вебхук.\n\n[[insta-comments/Handoff-Grok-Sessions]]\n[[wiki/concepts/Meta-API-Limits|лимиты Meta]]');
  assert.doesNotMatch(body, /Handoff-Grok-Sessions\]\]|Meta-API-Limits/);
  assert.match(body, /insta-comments\/Handoff-Grok-Sessions\nлимиты Meta/);
  assert.match(body, /## Связи\n\n- \[\[wiki\/entities\/insta-comments\]\]\n$/);
});

test('only made-up links and no related note → rejected', () => {
  assert.equal(bodyOf('Факт. [[nope]]', { ...CONTEXT, knownNotes: KNOWN }), '(invalid: no wikilink)');
});

test('a note written in English is rejected', () => {
  assert.equal(
    bodyOf('Meta does not return ad post comments via GET /comments, so the bot cannot delete them. See [[wiki/index]].'),
    '(invalid: not in Russian)',
  );
});

test('Russian prose with code, commands and English terms passes', () => {
  const body = bodyOf('Вебхук `api/webhook.js` ловит `comments` от Meta, poll — запасной путь.\n\n```bash\nnpm run subscribe --tenant buenos\n```\n\n[[wiki/index]]');
  assert.match(body, /^---\n/);
});

test('related notes: the project note first, then its folder, then name mentions', () => {
  assert.deepEqual(
    relatedNotes(
      ['insta-comments/meta-app-setup', 'wiki/concepts/insta-comments-poll', 'wiki/entities/insta-comments', 'Tyres/x'],
      'insta-comments',
    ),
    ['wiki/entities/insta-comments', 'insta-comments/meta-app-setup', 'wiki/concepts/insta-comments-poll'],
  );
  assert.deepEqual(relatedNotes(['a/b'], null), []);
});
