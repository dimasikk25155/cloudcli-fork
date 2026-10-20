/**
 * Telegram for teammates, through a gatekeeper.
 *
 * Dima's Telegram MCP (`telegram-mcp/`, http://127.0.0.1:8765/mcp) speaks for
 * his whole account and has no password, so the project jail closes it
 * (server/shared/user-jail.ts). Teammates still need it: they leave tasks and
 * big videos in Dima's Telegram and ask their agent to read and fetch them.
 *
 * This module is a small MCP server for jailed engines (Bearer = a per-run
 * token) that forwards to Dima's server as an MCP client of its own:
 * - only reading tools and `download_media` pass (nothing is sent, edited,
 *   deleted or administered from Dima's account);
 * - the client roots it declares are the teammate's project folder, so
 *   downloads land there and nowhere else (telegram-mcp enforces roots).
 */

import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { threadsApiUrl } from '@/shared/threads-env.js';

/** Reading Dima's chats and fetching files; no sending, editing, deleting or admin. */
export const TEAM_TELEGRAM_TOOLS = new Set([
  'get_chats',
  'list_chats',
  'get_chat',
  'get_full_chat',
  'get_messages',
  'list_messages',
  'get_history',
  'get_message_context',
  'get_last_interaction',
  'get_direct_chat_by_contact',
  'get_contact_chats',
  'search_messages',
  'search_contacts',
  'list_contacts',
  'get_contact_ids',
  'list_topics',
  'get_pinned_messages',
  'get_media_info',
  'download_media',
  'get_me',
  'resolve_username',
  'get_full_user',
  'get_message_link',
  'list_folders',
  'get_folder',
]);

export const TEAM_TELEGRAM_DENIED =
  'В командном доступе Telegram только читает переписки и скачивает файлы в папку проекта. '
  + 'Отправить, изменить или удалить что-то от имени Димы нельзя — передай запрос Диме.';

export const TEAM_TELEGRAM_TTL_MS = 24 * 60 * 60 * 1000;

export type TeamTelegramGrant = { root: string; userId: number; expiresAt: number };

/** What a jailed run gets: where the gatekeeper is and its key. */
export type TeamTelegramAccess = { url: string; token: string };

type ToolLike = { name: string; [key: string]: unknown };

/** The part of an MCP client this module uses — a seam for tests. */
export type TelegramUpstream = {
  listTools: () => Promise<{ tools: ToolLike[] }>;
  callTool: (params: { name: string; arguments?: Record<string, unknown> }) => Promise<unknown>;
  close?: () => Promise<void>;
};

export type TeamTelegramDependencies = {
  /** Opens an upstream client whose declared roots are `[root]`. */
  connect?: (root: string) => Promise<TelegramUpstream>;
  now?: () => number;
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function connectToDimaTelegram(root: string): Promise<TelegramUpstream> {
  const url = new URL(process.env.NEO3_TELEGRAM_MCP_URL || 'http://127.0.0.1:8765/mcp');
  const client = new Client(
    { name: 'neo3-team-telegram', version: '1.0.0' },
    { capabilities: { roots: { listChanged: false } } },
  );
  client.setRequestHandler(ListRootsRequestSchema, async () => ({
    roots: [{ uri: pathToFileURL(root).href, name: 'project' }],
  }));
  await client.connect(new StreamableHTTPClientTransport(url));
  return client as unknown as TelegramUpstream;
}

type RpcMessage = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

export function createTeamTelegram(dependencies: TeamTelegramDependencies = {}) {
  const connect = dependencies.connect ?? connectToDimaTelegram;
  const now = dependencies.now ?? Date.now;
  const grants = new Map<string, TeamTelegramGrant>();
  const upstreams = new Map<string, Promise<TelegramUpstream>>();

  function prune(): void {
    const time = now();
    for (const [key, grant] of grants) {
      if (grant.expiresAt <= time) grants.delete(key);
    }
  }

  /** A key for one jailed run; valid 24 h. */
  function issue(grant: { root: string; userId: number }): string {
    prune();
    const token = randomBytes(32).toString('hex');
    grants.set(hashToken(token), { ...grant, expiresAt: now() + TEAM_TELEGRAM_TTL_MS });
    return token;
  }

  function grantFor(token: string | null | undefined): TeamTelegramGrant | null {
    if (!token) return null;
    const grant = grants.get(hashToken(token));
    if (!grant || grant.expiresAt <= now()) return null;
    return grant;
  }

  /** One upstream session per project folder; a broken one is dropped and reopened once. */
  async function withUpstream<T>(root: string, work: (upstream: TelegramUpstream) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      let pending = upstreams.get(root);
      if (!pending) {
        pending = connect(root);
        upstreams.set(root, pending);
      }
      try {
        return await work(await pending);
      } catch (error) {
        upstreams.delete(root);
        void pending.then((upstream) => upstream.close?.()).catch(() => {});
        if (attempt >= 1) throw error;
      }
    }
  }

  async function handleMessage(grant: TeamTelegramGrant, message: RpcMessage): Promise<Record<string, unknown> | null> {
    if (message.id === undefined || message.id === null) return null; // notification
    const reply = (result: unknown) => ({ jsonrpc: '2.0', id: message.id, result });
    const fail = (code: number, text: string) => ({ jsonrpc: '2.0', id: message.id, error: { code, message: text } });
    try {
      switch (message.method) {
        case 'initialize':
          return reply({
            protocolVersion: typeof message.params?.protocolVersion === 'string' ? message.params.protocolVersion : '2025-06-18',
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'telegram', version: '1.0.0' },
            instructions: 'Telegram Димы в командном доступе: чтение переписок и скачивание файлов (download_media) в папку проекта.',
          });
        case 'ping':
          return reply({});
        case 'tools/list': {
          const { tools } = await withUpstream(grant.root, (upstream) => upstream.listTools());
          return reply({ tools: tools.filter((tool) => TEAM_TELEGRAM_TOOLS.has(tool.name)) });
        }
        case 'tools/call': {
          const name = String(message.params?.name ?? '');
          if (!TEAM_TELEGRAM_TOOLS.has(name)) {
            return reply({ isError: true, content: [{ type: 'text', text: TEAM_TELEGRAM_DENIED }] });
          }
          const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
          return reply(await withUpstream(grant.root, (upstream) => upstream.callTool({ name, arguments: args })));
        }
        default:
          return fail(-32601, `Method not found: ${message.method}`);
      }
    } catch (error) {
      return fail(-32603, `Telegram недоступен: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** One JSON-RPC body (single or batch) → reply body, or null when it held only notifications. */
  async function handle(grant: TeamTelegramGrant, body: unknown): Promise<unknown> {
    if (Array.isArray(body)) {
      const replies = (await Promise.all(body.map((item) => handleMessage(grant, item as RpcMessage)))).filter(Boolean);
      return replies.length > 0 ? replies : null;
    }
    return handleMessage(grant, (body ?? {}) as RpcMessage);
  }

  return { issue, grantFor, handle };
}

export type TeamTelegram = ReturnType<typeof createTeamTelegram>;

export const teamTelegram = createTeamTelegram();

/** Where jailed engines reach the gatekeeper: Neo3's own address, as for threads. */
export function teamTelegramUrl(): string {
  return threadsApiUrl().replace(/\/api\/threads$/, '/api/team-mcp/telegram');
}
