/**
 * /doctor: read-only report on the Neo3 environment. Same checks as the
 * terminal skill `setup-doctor` (engines, MCP, neo3-threads, Ollama tunnel,
 * disk, database, Neo3 service). Nothing is fixed here and no secret value is
 * ever read into the report: config files are parsed only for server names,
 * the output of commands is reduced to numbers and yes/no.
 */

import path from 'node:path';

import type { CheckStatus, DiagExec, DiagFs, DoctorCheck, DoctorReport } from './diagnostics.types.js';

export type DoctorDependencies = {
  exec: DiagExec;
  fs: DiagFs;
  home: string;
  platform?: NodeJS.Platform;
  /** Path of the Neo3 database file. */
  databasePath?: string;
  /** Numeric user id for `launchctl gui/<uid>`. */
  uid?: number;
  ollamaUrl?: string;
  now?: () => number;
};

const LOW_DISK_WARN_GB = 15;
const LOW_DISK_FAIL_GB = 5;
const BIG_DB_WARN_MB = 1024;
const SERVICE_LABEL = 'com.dimasik.neo3-local';
const ENGINES: Array<{ id: 'claude' | 'codex' | 'grok'; title: string; required: boolean }> = [
  { id: 'claude', title: 'Движок Claude', required: true },
  { id: 'codex', title: 'Движок Codex', required: false },
  { id: 'grok', title: 'Движок Grok', required: false },
];

function check(id: string, title: string, status: CheckStatus, detail: string): DoctorCheck {
  return { id, title, status, detail };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 120) : 'ошибка';
}

/** First line that looks like a version, e.g. `2.1.281` from `2.1.281 (Claude Code)`. */
function versionOf(output: string): string | null {
  const match = /\d+\.\d+(?:\.\d+)?(?:[-+.\w]*)?/.exec(output);
  return match ? match[0] : null;
}

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} ГБ`;
}

/** Names of the servers in a JSON config (`mcpServers` keys only). */
function serverNames(raw: string): string[] | null {
  try {
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    const servers = parsed?.mcpServers;
    return servers && typeof servers === 'object' ? Object.keys(servers) : [];
  } catch {
    return null;
  }
}

export function createDoctor(deps: DoctorDependencies) {
  const { exec, fs, home } = deps;
  const platform = deps.platform ?? process.platform;
  const now = deps.now ?? Date.now;

  async function engineLogin(id: 'claude' | 'codex' | 'grok'): Promise<'yes' | 'no' | 'unknown'> {
    try {
      if (id === 'codex') {
        return (await fs.exists(path.join(home, '.codex', 'auth.json'))) ? 'yes' : 'no';
      }
      if (id === 'grok') {
        return (await fs.exists(path.join(home, '.grok', 'auth.json'))) ? 'yes' : 'unknown';
      }
      if (platform === 'darwin') {
        // Without -w/-g the keychain prints no secret; only the exit code is used.
        const result = await exec('security', ['find-generic-password', '-s', 'Claude Code-credentials'], { timeoutMs: 5000 });
        if (result.code === 0) return 'yes';
        if (result.code === 44) return 'no';
        return 'unknown';
      }
      return (await fs.exists(path.join(home, '.claude', '.credentials.json'))) ? 'yes' : 'unknown';
    } catch {
      return 'unknown';
    }
  }

  async function engines(): Promise<DoctorCheck[]> {
    const out: DoctorCheck[] = [];
    for (const engine of ENGINES) {
      const id = `engine.${engine.id}`;
      try {
        const result = await exec(engine.id, ['--version'], { timeoutMs: 8000 });
        if (result.code === 127) {
          out.push(check(id, engine.title, engine.required ? 'fail' : 'warn', 'не установлен'));
          continue;
        }
        if (result.code === null) {
          out.push(check(id, engine.title, 'unknown', 'не ответил вовремя'));
          continue;
        }
        const version = versionOf(result.stdout || result.stderr);
        const login = await engineLogin(engine.id);
        const loginText = login === 'yes' ? 'вход есть' : login === 'no' ? 'входа нет' : 'вход не определён';
        const status: CheckStatus = result.code !== 0 ? 'warn' : login === 'no' ? 'warn' : login === 'unknown' ? 'unknown' : 'ok';
        out.push(check(id, engine.title, status, `установлен${version ? `, версия ${version}` : ''}; ${loginText}`));
      } catch (error) {
        out.push(check(id, engine.title, 'unknown', errorText(error)));
      }
    }
    return out;
  }

  async function mcp(): Promise<DoctorCheck[]> {
    let names: string[] | null = null;
    try {
      names = serverNames(await fs.readFile(path.join(home, '.claude.json')));
    } catch {
      names = null;
    }
    const list = names === null
      ? check('mcp.servers', 'MCP-серверы', 'unknown', 'файл настроек Claude не прочитан')
      : check('mcp.servers', 'MCP-серверы', names.length ? 'ok' : 'warn', names.length ? `${names.length}: ${names.join(', ')}` : 'ни одного');

    let inClaude: boolean | null = names === null ? null : names.includes('neo3-threads');
    let inCodex: boolean | null = null;
    try {
      inCodex = /^\s*\[mcp_servers\.["']?neo3-threads["']?\]/m.test(await fs.readFile(path.join(home, '.codex', 'config.toml')));
    } catch {
      inCodex = null;
    }
    const word = (value: boolean | null) => (value === null ? 'не проверено' : value ? 'есть' : 'нет');
    const threads = inClaude === null && inCodex === null
      ? check('mcp.threads', 'Регистрация neo3-threads', 'unknown', 'конфиги не прочитаны')
      : check(
          'mcp.threads',
          'Регистрация neo3-threads',
          inClaude || inCodex ? 'ok' : 'warn',
          `Claude: ${word(inClaude)}; Codex: ${word(inCodex)}${inClaude || inCodex ? '' : ' (включается флагом NEO3_THREADS_MCP=on у службы)'}`,
        );
    return [list, threads];
  }

  async function ollama(): Promise<DoctorCheck> {
    const title = 'Туннель Ollama';
    try {
      const url = deps.ollamaUrl ?? 'http://localhost:11435/api/tags';
      const result = await exec('curl', ['-s', '-m', '3', '-o', '/dev/null', '-w', '%{http_code}', url], { timeoutMs: 6000 });
      if (result.code === 127) return check('ollama', title, 'unknown', 'curl не найден');
      const code = result.stdout.trim();
      return code === '200'
        ? check('ollama', title, 'ok', 'отвечает')
        : check('ollama', title, 'warn', code && code !== '000' ? `ответ ${code}` : 'не отвечает (туннель не поднят?)');
    } catch (error) {
      return check('ollama', title, 'unknown', errorText(error));
    }
  }

  async function disk(): Promise<DoctorCheck> {
    const title = 'Место на диске';
    try {
      const result = await exec('df', ['-k', '/'], { timeoutMs: 5000 });
      const line = result.stdout.trim().split('\n').slice(-1)[0] ?? '';
      const columns = line.trim().split(/\s+/);
      // Filesystem 1K-blocks Used Available Capacity ...
      const availableKb = Number(columns[3]);
      if (result.code !== 0 || !Number.isFinite(availableKb)) return check('disk', title, 'unknown', 'df не разобран');
      const free = availableKb * 1024;
      const freeGb = free / 1024 ** 3;
      const status: CheckStatus = freeGb < LOW_DISK_FAIL_GB ? 'fail' : freeGb < LOW_DISK_WARN_GB ? 'warn' : 'ok';
      return check('disk', title, status, `свободно ${gb(free)}${status === 'ok' ? '' : ' — мало, уборку решает Дима'}`);
    } catch (error) {
      return check('disk', title, 'unknown', errorText(error));
    }
  }

  async function database(): Promise<DoctorCheck> {
    const title = 'База Neo3';
    const file = deps.databasePath ?? path.join(home, '.cloudcli', 'auth.db');
    try {
      const size = await fs.fileSize(file);
      if (size === null) return check('database', title, 'warn', 'файл базы не найден');
      const mb = size / 1024 ** 2;
      return check('database', title, mb > BIG_DB_WARN_MB ? 'warn' : 'ok', `${mb.toFixed(1)} МБ`);
    } catch (error) {
      return check('database', title, 'unknown', errorText(error));
    }
  }

  async function service(): Promise<DoctorCheck> {
    const title = 'Служба Neo3';
    if (platform !== 'darwin') return check('service', title, 'unknown', 'проверка службы есть только на Mac');
    try {
      const uid = deps.uid ?? (typeof process.getuid === 'function' ? process.getuid() : 501);
      const result = await exec('launchctl', ['print', `gui/${uid}/${SERVICE_LABEL}`], { timeoutMs: 6000 });
      if (result.code !== 0) return check('service', title, 'fail', 'служба не загружена');
      const state = /\bstate = (\w+)/.exec(result.stdout)?.[1] ?? null;
      const pid = /\bpid = (\d+)/.exec(result.stdout)?.[1] ?? null;
      if (state === 'running') return check('service', title, 'ok', `работает${pid ? `, pid ${pid}` : ''}`);
      return check('service', title, 'warn', `состояние: ${state ?? 'не определено'}`);
    } catch (error) {
      return check('service', title, 'unknown', errorText(error));
    }
  }

  return {
    async runDoctor(): Promise<DoctorReport> {
      const [engineChecks, mcpChecks, ollamaCheck, diskCheck, dbCheck, serviceCheck] = await Promise.all([
        engines(),
        mcp(),
        ollama(),
        disk(),
        database(),
        service(),
      ]);
      return {
        checks: [...engineChecks, ...mcpChecks, ollamaCheck, diskCheck, dbCheck, serviceCheck],
        generatedAt: new Date(now()).toISOString(),
      };
    },
  };
}
