import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import {
  AppError,
  readObjectRecord,
  readOptionalString,
  readStringArray,
  readStringRecord,
} from '@/shared/utils.js';
import { getKimiCodeHome } from '@/shared/utils.js';

/**
 * Kimi Code reads MCP servers from Claude-Code-style mcp.json files:
 *   { "mcpServers": { name: { command, args, env, cwd } | { url, headers? } | { transport: "sse", url } } }
 * Scopes (kimi-code docs/customization/mcp.md):
 *   user    — ~/.kimi-code/mcp.json (or $KIMI_CODE_HOME/mcp.json), shared
 *   project — <workspace>/.kimi-code/mcp.json, wins over user-level same-name
 */
const resolveKimiMcpPath = (scope: McpScope, workspacePath: string): string =>
  scope === 'user'
    ? path.join(getKimiCodeHome(), 'mcp.json')
    : path.join(workspacePath, '.kimi-code', 'mcp.json');

const readKimiMcpConfig = async (filePath: string): Promise<Record<string, unknown>> => {
  try {
    const content = await readFile(filePath, 'utf8');
    return readObjectRecord(JSON.parse(content)) ?? {};
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {};
    }

    throw error;
  }
};

const writeKimiMcpConfig = async (filePath: string, data: Record<string, unknown>): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

export class KimiMcpProvider extends McpProvider {
  constructor() {
    super('kimi', ['user', 'project'], ['stdio', 'http']);
  }

  protected async readScopedServers(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
    const config = await readKimiMcpConfig(resolveKimiMcpPath(scope, workspacePath));
    return readObjectRecord(config.mcpServers) ?? {};
  }

  protected async writeScopedServers(
    scope: McpScope,
    workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void> {
    const filePath = resolveKimiMcpPath(scope, workspacePath);
    const config = await readKimiMcpConfig(filePath);
    config.mcpServers = servers;
    await writeKimiMcpConfig(filePath, config);
  }

  protected buildServerConfig(input: UpsertProviderMcpServerInput): Record<string, unknown> {
    if (input.transport === 'stdio') {
      if (!input.command?.trim()) {
        throw new AppError('command is required for stdio MCP servers.', {
          code: 'MCP_COMMAND_REQUIRED',
          statusCode: 400,
        });
      }

      return {
        command: input.command,
        args: input.args ?? [],
        ...(input.env ? { env: input.env } : {}),
      };
    }

    if (!input.url?.trim()) {
      throw new AppError('url is required for http MCP servers.', {
        code: 'MCP_URL_REQUIRED',
        statusCode: 400,
      });
    }

    return {
      url: input.url,
      ...(input.headers ? { headers: input.headers } : {}),
    };
  }

  protected normalizeServerConfig(
    scope: McpScope,
    name: string,
    rawConfig: unknown,
  ): ProviderMcpServer | null {
    const config = readObjectRecord(rawConfig);
    if (!config) {
      return null;
    }

    const command = readOptionalString(config.command);
    if (command) {
      return {
        provider: 'kimi',
        name,
        scope,
        transport: 'stdio',
        command,
        args: readStringArray(config.args),
        env: readStringRecord(config.env),
      };
    }

    const url = readOptionalString(config.url);
    if (url) {
      return {
        provider: 'kimi',
        name,
        scope,
        transport: 'http',
        url,
        headers: readStringRecord(config.headers),
      };
    }

    return null;
  }
}
