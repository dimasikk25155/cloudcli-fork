/**
 * Global registration of the neo3-threads MCP server — the same places
 * browser-use uses: ~/.claude.json (Claude Code, and Grok reads it through its
 * harness compatibility) and ~/.codex/config.toml.
 *
 * The entry carries no secret: the token and the API address come from the
 * engine process env per run (server/shared/threads-env.ts). Codex does not
 * hand its env to MCP servers, so its entry whitelists the run variables
 * (`env_vars`: token, address, «threads off» marker) and raises the tool timeout above thread_status' 600 s wait.
 *
 * Idempotent: an entry that already matches is not rewritten (the CLIs keep
 * rewriting ~/.claude.json themselves; fewer writes, fewer races). Before the
 * first change of each file a copy `<file>.bak-neo3-threads` is kept.
 *
 * Only the production instance registers (`NEO3_THREADS_MCP=on` in its
 * environment): dev servers from .worktrees must never touch the real configs.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { providerMcpService } from '@/modules/providers/services/mcp.service.js';
import { NEO3_THREADS_ENV_NAMES } from '@/shared/threads-env.js';
import type { ProviderMcpServer } from '@/shared/types.js';
import { findAppRoot, findServerRoot, getModuleDir } from '@/utils/runtime-paths.js';

export const THREADS_MCP_SERVER_NAME = 'neo3-threads';
/** thread_status may wait 600 s; Codex's default tool timeout is 60 s. */
export const CODEX_THREADS_TOOL_TIMEOUT_SEC = 660;

export type ThreadsMcpCommand = { command: string; args: string[] };

/**
 * How to start the MCP server from this installation: the compiled script
 * next to the running server (production), the TypeScript source through tsx
 * (development), or the `cloudcli threads-mcp` subcommand (npm install).
 */
export function threadsMcpCommand(moduleUrl: string = import.meta.url): ThreadsMcpCommand {
  const serverDir = findServerRoot(getModuleDir(moduleUrl));
  const compiled = path.join(serverDir, 'threads-mcp.js');
  if (fs.existsSync(compiled)) {
    return { command: process.execPath, args: [compiled] };
  }
  const source = path.join(serverDir, 'threads-mcp.ts');
  const tsx = path.join(findAppRoot(serverDir), 'node_modules', '.bin', 'tsx');
  if (fs.existsSync(source) && fs.existsSync(tsx)) {
    // Absolute --tsconfig: a dev server started with `tsx --tsconfig server/…`
    // leaves a RELATIVE TSX_TSCONFIG_PATH in the engines' env, and the engine
    // starts this server in the project folder — tsx then fails to start.
    return { command: tsx, args: ['--tsconfig', path.join(serverDir, 'tsconfig.json'), source] };
  }
  return { command: 'cloudcli', args: ['threads-mcp'] };
}

function sameList(a: string[] | undefined, b: string[]): boolean {
  const left = [...(a ?? [])].sort();
  const right = [...b].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function matches(existing: ProviderMcpServer | undefined, wanted: ThreadsMcpCommand, codex: boolean): boolean {
  if (!existing || existing.transport !== 'stdio') return false;
  if (existing.command !== wanted.command || !sameList(existing.args, wanted.args)) return false;
  if (Object.keys(existing.env ?? {}).length > 0) return false;
  if (codex) {
    return sameList(existing.envVars, [...NEO3_THREADS_ENV_NAMES])
      && (existing as ProviderMcpServer & { toolTimeoutSec?: number }).toolTimeoutSec === CODEX_THREADS_TOOL_TIMEOUT_SEC;
  }
  return true;
}

export const THREADS_MCP_BACKUP_SUFFIX = '.bak-neo3-threads';

/** Explicit opt-in: registration happens only with NEO3_THREADS_MCP=on. */
export function shouldRegisterThreadsMcp(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEO3_THREADS_MCP === 'on';
}

function configFileOf(provider: 'claude' | 'codex'): string {
  return provider === 'claude'
    ? path.join(os.homedir(), '.claude.json')
    : path.join(os.homedir(), '.codex', 'config.toml');
}

/** Copy of the file as it was before neo3-threads first changed it (kept once). */
function backupOnce(filePath: string): void {
  const backupPath = `${filePath}${THREADS_MCP_BACKUP_SUFFIX}`;
  if (fs.existsSync(filePath) && !fs.existsSync(backupPath)) {
    fs.copyFileSync(filePath, backupPath, fs.constants.COPYFILE_EXCL);
  }
}

export type ThreadsMcpRegistrationResult = { provider: 'claude' | 'codex'; changed: boolean; error?: string };

/**
 * Writes the neo3-threads entry where it is missing or outdated. Claude's
 * entry also serves Grok (same ~/.claude.json). Never throws: a failed
 * provider is reported in its result.
 */
export async function registerThreadsMcp(options: { command?: ThreadsMcpCommand } = {}): Promise<ThreadsMcpRegistrationResult[]> {
  const wanted = options.command ?? threadsMcpCommand();
  const results: ThreadsMcpRegistrationResult[] = [];

  for (const provider of ['claude', 'codex'] as const) {
    const codex = provider === 'codex';
    try {
      const current = await providerMcpService.listProviderMcpServersForScope(provider, 'user');
      if (matches(current.find((server) => server.name === THREADS_MCP_SERVER_NAME), wanted, codex)) {
        results.push({ provider, changed: false });
        continue;
      }
      backupOnce(configFileOf(provider));
      await providerMcpService.upsertProviderMcpServer(provider, {
        name: THREADS_MCP_SERVER_NAME,
        scope: 'user',
        transport: 'stdio',
        command: wanted.command,
        args: wanted.args,
        env: {},
        ...(codex ? { envVars: [...NEO3_THREADS_ENV_NAMES], toolTimeoutSec: CODEX_THREADS_TOOL_TIMEOUT_SEC } : {}),
      });
      results.push({ provider, changed: true });
    } catch (error) {
      results.push({ provider, changed: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
