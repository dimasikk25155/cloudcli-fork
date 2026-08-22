import os from 'node:os';
import path from 'node:path';

import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import {
  AppError,
  readJsonConfig,
  readObjectRecord,
  readOptionalString,
  readStringArray,
  readStringRecord,
  writeJsonConfig,
} from '@/shared/utils.js';

/**
 * MCP for Grok Build — deliberately the SAME files Claude Code uses.
 *
 * Grok ships "harness compatibility": `grok inspect` on this box lists every
 * server from ~/.claude.json as `[claude]` and reports them `connected` in the
 * run's system/init event. Its own store is ~/.grok/config.toml, but writing
 * TOML would (a) need a TOML writer and (b) split the truth in two — the UI
 * would show servers Grok already had, or hide ones it is actually using.
 *
 * So this provider reads and writes exactly what Grok reads: ~/.claude.json
 * (user + local scopes) and <workspace>/.mcp.json (project scope). Adding a
 * server "for Grok" therefore adds it for Claude too, which is the honest
 * behaviour: it is one shared MCP fleet.
 */
export class GrokMcpProvider extends McpProvider {
  constructor() {
    super('grok', ['user', 'local', 'project'], ['stdio', 'http', 'sse']);
  }

  protected async readScopedServers(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
    if (scope === 'project') {
      const config = await readJsonConfig(path.join(workspacePath, '.mcp.json'));
      return readObjectRecord(config.mcpServers) ?? {};
    }

    const config = await readJsonConfig(path.join(os.homedir(), '.claude.json'));
    if (scope === 'user') {
      return readObjectRecord(config.mcpServers) ?? {};
    }

    const projects = readObjectRecord(config.projects) ?? {};
    const projectConfig = readObjectRecord(projects[workspacePath]) ?? {};
    return readObjectRecord(projectConfig.mcpServers) ?? {};
  }

  protected async writeScopedServers(
    scope: McpScope,
    workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void> {
    if (scope === 'project') {
      const filePath = path.join(workspacePath, '.mcp.json');
      const config = await readJsonConfig(filePath);
      config.mcpServers = servers;
      await writeJsonConfig(filePath, config);
      return;
    }

    const filePath = path.join(os.homedir(), '.claude.json');
    const config = await readJsonConfig(filePath);
    if (scope === 'user') {
      config.mcpServers = servers;
      await writeJsonConfig(filePath, config);
      return;
    }

    const projects = readObjectRecord(config.projects) ?? {};
    const projectConfig = readObjectRecord(projects[workspacePath]) ?? {};
    projectConfig.mcpServers = servers;
    projects[workspacePath] = projectConfig;
    config.projects = projects;
    await writeJsonConfig(filePath, config);
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
        type: 'stdio',
        command: input.command,
        args: input.args ?? [],
        env: input.env ?? {},
      };
    }

    if (!input.url?.trim()) {
      throw new AppError('url is required for http/sse MCP servers.', {
        code: 'MCP_URL_REQUIRED',
        statusCode: 400,
      });
    }

    return {
      type: input.transport,
      url: input.url,
      headers: input.headers ?? {},
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

    if (typeof config.command === 'string') {
      return {
        provider: 'grok',
        name,
        scope,
        transport: 'stdio',
        command: config.command,
        args: readStringArray(config.args),
        env: readStringRecord(config.env),
      };
    }

    if (typeof config.url === 'string') {
      const transport = readOptionalString(config.type) === 'sse' ? 'sse' : 'http';
      return {
        provider: 'grok',
        name,
        scope,
        transport,
        url: config.url,
        headers: readStringRecord(config.headers),
      };
    }

    return null;
  }
}
