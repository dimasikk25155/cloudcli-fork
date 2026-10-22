import assert from 'node:assert/strict';
import test from 'node:test';
import { hasWorkWorthNoting, isQuietStatus } from '../../../modules/memory-suggestions/quiet-session.js';
// Spec story 44 / R38i: a session is "finished" when it has been done for 30
// minutes, holds at least two messages from the user and the agent edited a
// file or ran a command (decision 20: Write, Edit, MultiEdit, NotebookEdit,
// Bash and their Codex/Grok counterparts).
const NOW = new Date('2026-10-12T12:00:00.000Z');
const minutesAgo = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
test('done for 30 minutes or more is quiet; 29 minutes is not', () => {
    assert.equal(isQuietStatus({ state: 'done', updatedAt: minutesAgo(30) }, NOW), true);
    assert.equal(isQuietStatus({ state: 'done', updatedAt: minutesAgo(29) }, NOW), false);
});
test('only finished sessions count: working, waiting and failed are not quiet', () => {
    for (const state of ['working', 'waiting', 'failed']) {
        assert.equal(isQuietStatus({ state, updatedAt: minutesAgo(90) }, NOW), false, state);
    }
});
test('sessions that went quiet more than a day ago are left alone (no backlog sweep on first start)', () => {
    assert.equal(isQuietStatus({ state: 'done', updatedAt: minutesAgo(23 * 60) }, NOW), true);
    assert.equal(isQuietStatus({ state: 'done', updatedAt: minutesAgo(25 * 60) }, NOW), false);
});
test('an unreadable timestamp is never quiet', () => {
    assert.equal(isQuietStatus({ state: 'done', updatedAt: 'not a date' }, NOW), false);
});
const user = (content) => ({ kind: 'text', role: 'user', content });
const assistant = (content) => ({ kind: 'text', role: 'assistant', content });
const tool = (toolName) => ({ kind: 'tool_use', toolName, toolInput: {} });
test('two user messages plus a file edit is worth a look', () => {
    assert.equal(hasWorkWorthNoting([user('почини'), tool('Edit'), assistant('готово'), user('спасибо')]), true);
});
test('one user message is not enough, whatever the agent did', () => {
    assert.equal(hasWorkWorthNoting([user('почини'), tool('Edit'), tool('Bash'), assistant('готово')]), false);
});
test('a pure conversation (no edits, no commands) is not worth a note', () => {
    assert.equal(hasWorkWorthNoting([user('что это?'), tool('Read'), tool('Grep'), assistant('это…'), user('понял')]), false);
});
test('injected user text (Stop-hook follow-ups, task notifications) does not count as Dima writing', () => {
    assert.equal(hasWorkWorthNoting([
        user('почини'),
        tool('Write'),
        user('Stop hook feedback: write the vault'),
        user('<task-notification>done</task-notification>'),
    ]), false);
});
test('edit and command tools of every engine count', () => {
    // Claude: Write/Edit/MultiEdit/NotebookEdit/Bash; Codex: Bash, FileChanges;
    // Grok: run_terminal_command, search_replace, write.
    for (const name of ['Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'FileChanges', 'run_terminal_command', 'search_replace', 'write']) {
        assert.equal(hasWorkWorthNoting([user('a'), tool(name), user('b')]), true, name);
    }
});
//# sourceMappingURL=quiet-session.test.js.map