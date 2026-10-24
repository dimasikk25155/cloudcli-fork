import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { closeConnection, initializeDatabase, sessionsDb } from '../../../modules/database/index.js';
import { ClaudeSessionsProvider } from '../../../modules/providers/list/claude/claude-sessions.provider.js';
// Real rows (text anonymized) from a Neo3 session where the orchestrator ran a
// background `Agent`: [0] the Agent call, [1] its async-launch result,
// [2] the subagent prompt (sidechain), [3] the subagent's tool call,
// [4] that call's result.
const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'claude-subagent-sidechain.jsonl');
const SESSION = '00000000-0000-4000-8000-000000000001';
async function loadRows() {
    const text = await readFile(FIXTURE, 'utf8');
    return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}
/** The live SDK stream shape of a subagent row: wrapper with parent_tool_use_id. */
function asSdkStreamMessage(row, parentToolUseId) {
    return {
        type: row.type,
        message: row.message,
        parent_tool_use_id: parentToolUseId,
        uuid: row.uuid,
        session_id: row.sessionId,
    };
}
function userBubbles(messages) {
    return messages.filter((message) => message.kind === 'text' && message.role === 'user');
}
test('live stream: subagent prompt is not a human turn; its tools are tagged with the Agent call', async () => {
    const rows = await loadRows();
    const provider = new ClaudeSessionsProvider();
    const agentCall = rows[0].message.content[0];
    assert.equal(agentCall.name, 'Agent');
    const normalized = [
        ...provider.normalizeMessage(rows[0], SESSION),
        ...provider.normalizeMessage(rows[1], SESSION),
        ...rows.slice(2).flatMap((row) => provider.normalizeMessage(asSdkStreamMessage(row, agentCall.id), SESSION)),
    ];
    assert.equal(userBubbles(normalized).length, 0, 'subagent prompt must not become a user text row');
    const childCall = rows[3].message.content[0];
    const childRows = normalized.filter((message) => message.toolId === childCall.id);
    assert.deepEqual(childRows.map((message) => message.kind), ['tool_use', 'tool_result']);
    for (const message of childRows) {
        assert.equal(message.parentToolUseId, agentCall.id);
    }
    assert.equal(normalized.find((message) => message.toolId === agentCall.id)?.parentToolUseId, undefined);
});
test('transcript rows: sidechain rows in the main JSONL never become user bubbles', async () => {
    const rows = await loadRows();
    const provider = new ClaudeSessionsProvider();
    const normalized = rows.flatMap((row) => provider.normalizeMessage(row, SESSION));
    assert.equal(userBubbles(normalized).length, 0);
    assert.equal(normalized.some((message) => message.kind === 'tool_use' && message.toolName !== 'Agent'), false);
});
test('history: subagent transcript in <session>/subagents/ fills the Agent card', async (t) => {
    const rows = await loadRows();
    const previousDatabasePath = process.env.DATABASE_PATH;
    const tempDirectory = await mkdtemp(path.join(tmpdir(), 'claude-subagent-history-'));
    t.after(async () => {
        closeConnection();
        if (previousDatabasePath === undefined)
            delete process.env.DATABASE_PATH;
        else
            process.env.DATABASE_PATH = previousDatabasePath;
        await rm(tempDirectory, { recursive: true, force: true });
    });
    closeConnection();
    process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
    await initializeDatabase();
    const projectDir = path.join(tempDirectory, 'projects', '-tmp-fixture-project');
    const jsonlPath = path.join(projectDir, `${SESSION}.jsonl`);
    const agentId = rows[1].toolUseResult.agentId;
    await mkdir(path.join(projectDir, SESSION, 'subagents'), { recursive: true });
    await writeFile(jsonlPath, rows.slice(0, 2).map((row) => JSON.stringify(row)).join('\n') + '\n');
    await writeFile(path.join(projectDir, SESSION, 'subagents', `agent-${agentId}.jsonl`), rows.slice(2).map((row) => JSON.stringify(row)).join('\n') + '\n');
    const sessionId = sessionsDb.createSession(SESSION, 'claude', '/tmp/fixture-project', undefined, undefined, undefined, jsonlPath);
    const history = await new ClaudeSessionsProvider().fetchHistory(sessionId, { providerSessionId: SESSION });
    assert.equal(userBubbles(history.messages).length, 0);
    const card = history.messages.find((message) => message.kind === 'tool_use' && message.toolId === rows[0].message.content[0].id);
    assert.ok(Array.isArray(card?.subagentTools), 'subagent transcript attached to the Agent call');
    assert.deepEqual(card.subagentTools.map((tool) => tool.toolId), [rows[3].message.content[0].id]);
});
//# sourceMappingURL=claude-subagent-history.test.js.map