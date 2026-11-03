import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import TOML from '@iarna/toml';

import { codexHome } from '@/shared/codex-paths.js';
import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import {
  AppError,
  readObjectRecord,
  readOptionalString,
  readStringArray,
  readStringRecord,
} from '@/shared/utils.js';

const readTomlConfig = async (filePath: string): Promise<Record<string, unknown>> => {
  try {
    const content = await readFile(filePath, 'utf8');
    const parsed = TOML.parse(content) as Record<string, unknown>;
    return readObjectRecord(parsed) ?? {};
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {};
    }
    throw error;
  }
};

const writeTomlConfig = async (filePath: string, data: Record<string, unknown>): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  const toml = TOML.stringify(data as never);
  await writeFile(filePath, toml, 'utf8');
};

export class CodexMcpProvider extends McpProvider {
  constructor() {
    super('codex', ['user', 'project'], ['stdio', 'http']);
  }

  protected async readScopedServers(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
    const filePath = scope === 'user'
      ? path.join(codexHome(), 'config.toml')
      : path.join(workspacePath, '.codex', 'config.toml');
    const config = await readTomlConfig(filePath);
    return readObjectRecord(config.mcp_servers) ?? {};
  }

  protected async writeScopedServers(
    scope: McpScope,
    workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void> {
    const filePath = scope === 'user'
      ? path.join(codexHome(), 'config.toml')
      : path.join(workspacePath, '.codex', 'config.toml');
    const config = await readTomlConfig(filePath);
    config.mcp_servers = servers;
    await writeTomlConfig(filePath, config);
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
        env: input.env ?? {},
        env_vars: input.envVars ?? [],
        cwd: input.cwd,
        ...(typeof input.toolTimeoutSec === 'number' ? { tool_timeout_sec: input.toolTimeoutSec } : {}),
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
      bearer_token_env_var: input.bearerTokenEnvVar,
      http_headers: input.headers ?? {},
      env_http_headers: input.envHttpHeaders ?? {},
      ...(typeof input.toolTimeoutSec === 'number' ? { tool_timeout_sec: input.toolTimeoutSec } : {}),
    };
  }

  protected mergeServerConfig(previous: unknown, input: UpsertProviderMcpServerInput): Record<string, unknown> {
    // The UI edits only part of Codex's schema. Keep restrictions, disabled
    // state, approval modes and future fields it cannot represent.
    const preserved = { ...(readObjectRecord(previous) ?? {}) };
    const oppositeTransportKeys = input.transport === 'stdio'
      ? ['url', 'bearer_token_env_var', 'http_headers', 'env_http_headers']
      : ['command', 'args', 'env', 'env_vars', 'cwd'];
    for (const key of oppositeTransportKeys) delete preserved[key];
    return { ...preserved, ...this.buildServerConfig(input) };
  }

  protected normalizeServerConfig(
    scope: McpScope,
    name: string,
    rawConfig: unknown,
  ): ProviderMcpServer | null {
    if (!rawConfig || typeof rawConfig !== 'object') {
      return null;
    }

    const config = rawConfig as Record<string, unknown>;
    if (typeof config.command === 'string') {
      return {
        provider: 'codex',
        name,
        scope,
        transport: 'stdio',
        command: config.command,
        args: readStringArray(config.args),
        env: readStringRecord(config.env),
        cwd: readOptionalString(config.cwd),
        envVars: readStringArray(config.env_vars),
        ...(typeof config.tool_timeout_sec === 'number' ? { toolTimeoutSec: config.tool_timeout_sec } : {}),
      };
    }

    if (typeof config.url === 'string') {
      return {
        provider: 'codex',
        name,
        scope,
        transport: 'http',
        url: config.url,
        headers: readStringRecord(config.http_headers),
        bearerTokenEnvVar: readOptionalString(config.bearer_token_env_var),
        envHttpHeaders: readStringRecord(config.env_http_headers),
        ...(typeof config.tool_timeout_sec === 'number' ? { toolTimeoutSec: config.tool_timeout_sec } : {}),
      };
    }

    return null;
  }
}
