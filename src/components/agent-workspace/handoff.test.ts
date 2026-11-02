import test from 'node:test';
import assert from 'node:assert/strict';

import { stageWorkspaceHandoff, selectHandoffProject, HANDOFF_STORAGE_PREFIX } from './handoff';
test('handoff opens selected project via normal new-chat callback and preserves existing draft and model choices', () => {
    const values = new Map([['draft_input_b', 'User draft'], ['selected-provider', 'codex'], ['codex-model', 'gpt-6-astra'], ['effort', 'high']]);
    const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
    stageWorkspaceHandoff({ projectId: 'b', projectPath: '/b', source: { kind: 'document', id: 'doc' }, text: 'Material', grantId: 'grant' }, storage, storage);
    let selected = 'a', navigated = false;
    selectHandoffProject([{ projectId: 'a' }, { projectId: 'b' }], 'b', project => { selected = project.projectId; navigated = true; });
    assert.equal(selected, 'b');
    assert.equal(navigated, true);
    assert.equal(values.get('draft_input_b'), 'User draft\n\nMaterial');
    assert.equal(values.get('selected-provider'), 'codex');
    assert.equal(values.get('codex-model'), 'gpt-6-astra');
    assert.equal(values.get('effort'), 'high');
    assert.match(values.get(HANDOFF_STORAGE_PREFIX + 'b')!, /grant/);
    assert.throws(() => selectHandoffProject([{ projectId: 'a' }], 'b', () => assert.fail('must not navigate')));
});
