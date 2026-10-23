import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTranscript } from '../../../modules/memory-suggestions/vault-note.js';
// Spec story 45: the transcript goes to the local model with secrets scrubbed,
// cut to about 60K characters from the end.
test('secrets in the transcript are scrubbed before it leaves for the model', () => {
    const key = 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const text = buildTranscript([{ kind: 'text', role: 'user', content: `вот токен ${key}` }]);
    assert.ok(text.includes('вот токен'));
    assert.ok(!text.includes(key));
});
test('a long transcript keeps its last 60 000 characters', () => {
    const early = { kind: 'text', role: 'user', content: `START ${'а'.repeat(70_000)}` };
    const late = { kind: 'text', role: 'assistant', content: 'ИТОГ: починил хук' };
    const text = buildTranscript([early, late]);
    assert.equal(text.length, 60_000);
    assert.ok(text.endsWith('ИТОГ: починил хук'));
    assert.ok(!text.includes('START'));
});
test('tool calls appear as one line each, so the model sees what was changed', () => {
    const text = buildTranscript([{ kind: 'tool_use', toolName: 'Bash', toolInput: { command: 'npm test' } }]);
    assert.match(text, /Bash.*npm test/);
});
//# sourceMappingURL=transcript.test.js.map