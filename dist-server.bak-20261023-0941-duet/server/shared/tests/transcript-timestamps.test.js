import assert from 'node:assert/strict';
import { mkdtemp, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readLastJsonlTimestamp, readTranscriptTimestamps } from '../utils.js';
const tempFile = async (content) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'transcript-ts-'));
    const filePath = path.join(dir, 'session.jsonl');
    await writeFile(filePath, content);
    return filePath;
};
test('updatedAt is the last message time, not the rewritten file mtime', async () => {
    const filePath = await tempFile([
        JSON.stringify({ type: 'user', timestamp: '2026-09-24T01:00:00.000Z' }),
        JSON.stringify({ type: 'assistant', timestamp: '2026-09-24T01:36:11.374Z' }),
        JSON.stringify({ type: 'last-prompt', lastPrompt: 'без времени' }),
        '',
    ].join('\n'));
    // A cleanup rewrites the file today.
    const now = new Date('2026-10-22T13:10:00.000Z');
    await utimes(filePath, now, now);
    const timestamps = await readTranscriptTimestamps(filePath);
    assert.equal(timestamps.updatedAt, '2026-09-24T01:36:11.374Z');
});
test('falls back to mtime when no line carries a timestamp', async () => {
    const filePath = await tempFile(`${JSON.stringify({ type: 'summary' })}\n`);
    const mtime = new Date('2026-10-01T10:00:00.000Z');
    await utimes(filePath, mtime, mtime);
    assert.equal(await readLastJsonlTimestamp(filePath), undefined);
    assert.equal((await readTranscriptTimestamps(filePath)).updatedAt, mtime.toISOString());
});
test('finds the timestamp behind a huge last line', async () => {
    const filePath = await tempFile([
        JSON.stringify({ type: 'assistant', timestamp: '2026-10-20T08:00:00.000Z' }),
        JSON.stringify({ type: 'image', data: 'x'.repeat(200 * 1024) }),
    ].join('\n'));
    assert.equal(await readLastJsonlTimestamp(filePath), '2026-10-20T08:00:00.000Z');
});
test('missing file gives no timestamps', async () => {
    assert.equal(await readLastJsonlTimestamp('/nonexistent/session.jsonl'), undefined);
    assert.deepEqual(await readTranscriptTimestamps('/nonexistent/session.jsonl'), {});
});
//# sourceMappingURL=transcript-timestamps.test.js.map