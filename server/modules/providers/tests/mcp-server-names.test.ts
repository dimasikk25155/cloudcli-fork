import assert from 'node:assert/strict';
import test from 'node:test';

import { mcpServerNamesByScope } from '@/modules/providers/services/mcp.service.js';
import type { McpScope, ProviderMcpServer } from '@/shared/types.js';

// The session inspector shows connections by name only (spec story 15:
// «MCP-имена, без значений»); env/header values must not leave the server.
test('mcpServerNamesByScope keeps only server names, no env or header values', () => {
  const grouped = {
    user: [
      { provider: 'claude', name: 'telegram', scope: 'user', transport: 'stdio', command: 'uv', env: { API_TOKEN: 'value-must-not-leak' } },
      { provider: 'claude', name: 'remote', scope: 'user', transport: 'http', url: 'https://example.invalid/mcp', headers: { Authorization: 'Bearer value-must-not-leak' } },
    ],
    project: [{ provider: 'claude', name: 'telegram', scope: 'project', transport: 'stdio' }],
    local: [],
  } as unknown as Record<McpScope, ProviderMcpServer[]>;

  const names = mcpServerNamesByScope(grouped);

  assert.deepEqual(names, {
    user: [{ name: 'telegram' }, { name: 'remote' }],
    project: [{ name: 'telegram' }],
    local: [],
  });
  assert.equal(JSON.stringify(names).includes('value-must-not-leak'), false);
});
