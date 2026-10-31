import assert from 'node:assert/strict';
import test from 'node:test';
import { tools, webUrl, callTool } from './edge-browser-mcp.mjs';

test('the Edge bridge refuses file, javascript and non-web URL schemes', () => {
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,test', '']) assert.throws(() => webUrl(url));
  assert.equal(webUrl('https://example.com'), 'https://example.com/');
});

test('a session cannot select or close a foreign browser target', async () => {
  await assert.rejects(callTool('browser_tabs', { sessionId: 'another-task', action: 'close', index: 0 }), /session not found/);
  await assert.rejects(callTool('browser_close_session', { sessionId: 'another-task' }), /session not found/);
});

test('all advertised browser operations have a unique schema and ownership requirement', () => {
  assert.equal(tools.length, 13);
  assert.equal(new Set(tools.map((t) => t.name)).size, tools.length);
  for (const tool of tools) {
    if (!['browser_create_session', 'browser_list_sessions'].includes(tool.name)) assert.ok(tool.inputSchema.required.includes('sessionId'));
  }
});
