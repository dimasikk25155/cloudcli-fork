import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import {
  AppError,
  getGeminiHome,
  readObjectRecord,
  readOptionalString,
  readStringArray,
  readStringRecord,
} from '@/shared/utils.js';

/**
 * Gemini keeps MCP servers under `mcpServers` in its settings.json, in the same
 * Claude-Code-style shape the other providers use:
 *   { "mcpServers": { name: { command, args, env } | { url, headers? } } }
 * Scopes:
 *   user    — ~/.gemini/settings.json (or $GEMINI_HOME/settings.json)
 *   project — <workspace>/.gemini/settings.json
 *
 * Unlike the other providers, this file is NOT MCP-only — it also holds the
 * user's own Gemini settings (auth type, UI preferences). Every write therefore
 * reads the whole document, replaces just the `mcpServers` branch and writes it
 * back, so unrelated settings survive untouched.
 */
const resolveGeminiSettingsPath = (scope: McpScope, workspacePath: string): string =>
  scope === 'user'
    ? path.join(getGeminiHome(), 'settings.json')
    : path.join(workspacePath, '.gemini', 'settings.json');

const readGeminiSettings = async (filePath: string): Promise<Record<string, unknown>> => {
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

const writeGeminiSettings = async (filePath: string, data: Record<string, unknown>): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

export class GeminiMcpProvider extends McpProvider {
  constructor() {
    super('gemini', ['user', 'project'], ['stdio', 'http']);
  }

  protected async readScopedServers(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
    const settings = await readGeminiSettings(resolveGeminiSettingsPath(scope, workspacePath));
    return readObjectRecord(settings.mcpServers) ?? {};
  }

  protected async writeScopedServers(
    scope: McpScope,
    workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void> {
    const filePath = resolveGeminiSettingsPath(scope, workspacePath);
    const settings = await readGeminiSettings(filePath);
    settings.mcpServers = servers;
    await writeGeminiSettings(filePath, settings);
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
        provider: 'gemini',
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
        provider: 'gemini',
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
