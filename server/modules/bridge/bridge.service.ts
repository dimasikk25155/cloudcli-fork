/**
 * Мост ИИ на маке: Neo3 только спрашивает и командует пульт
 * `~/.local/share/neo3-agent-proxy/bridge.py` (scripts/agent-proxy/bridge.py).
 * Вызов — execFile без shell, аргументы только из фиксированного списка.
 */

import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

export type BridgeLevel = 'green' | 'yellow' | 'red';

export type BridgeStatus = {
  checked_at: number;
  installed: boolean;
  mode: 'auto' | 'mitya' | 'vps';
  mode_title: string;
  route: string | null;
  route_title: string | null;
  route_since: number | null;
  health_age: number | null;
  expected_ip: string;
  exit_ok: boolean;
  exit_ip: string | null;
  public_tunnel: boolean;
  blocked_last_hour: number;
  switches: Array<{ at: string; route: string; title: string }>;
  routes?: { mitya: string; vps: string };
  public_http?: string | null;
  level: BridgeLevel;
  text: string;
};

export type BridgeAction = 'auto' | 'mitya' | 'vps' | 'fix';
export const BRIDGE_ACTIONS: readonly BridgeAction[] = ['auto', 'mitya', 'vps', 'fix'];

export type BridgeActionResult = { ok: boolean; message: string; status: BridgeStatus | null };

export type BridgeExec = (args: string[], timeoutMs: number) => Promise<{ code: number; stdout: string }>;

const PYTHON = '/usr/bin/python3';

export function bridgeScriptPath(): string {
  return process.env.NEO3_BRIDGE_SCRIPT || path.join(os.homedir(), '.local/share/neo3-agent-proxy/bridge.py');
}

export function realBridgeExec(script = bridgeScriptPath()): BridgeExec {
  return (args, timeoutMs) => new Promise((resolve) => {
    execFile(PYTHON, [script, ...args], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    }, (error, stdout) => {
      const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1) : 0;
      resolve({ code, stdout: String(stdout ?? '') });
    });
  });
}

const ACTION_ARGS: Record<BridgeAction, string[]> = {
  auto: ['auto', '--json'],
  mitya: ['use', 'mitya', '--json'],
  vps: ['use', 'vps', '--json'],
  fix: ['fix', '--json'],
};

function parse<T>(text: string): T | null {
  const line = text.trim().split('\n').filter(Boolean).pop();
  if (!line) return null;
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}

export function createBridgeService(exec: BridgeExec = realBridgeExec()) {
  return {
    /** quick — по файлам сторожа (~0,1 с); полный — с ssh-проверкой обоих серверов (до 20 с). */
    async status(quick = true): Promise<BridgeStatus | null> {
      const { stdout } = await exec(quick ? ['json', '--quick'] : ['json'], quick ? 15_000 : 60_000);
      return parse<BridgeStatus>(stdout);
    },
    /** Человеческий текст полного статуса — для Telegram. */
    async statusText(): Promise<string> {
      const { stdout } = await exec(['status'], 60_000);
      return stdout.trim() || 'Пульт моста не ответил.';
    },
    async act(action: BridgeAction): Promise<BridgeActionResult> {
      if (!BRIDGE_ACTIONS.includes(action)) {
        return { ok: false, message: 'Неизвестное действие', status: null };
      }
      const { stdout } = await exec(ACTION_ARGS[action], 240_000);
      const result = parse<BridgeActionResult>(stdout);
      return result ?? { ok: false, message: 'Пульт моста не ответил (bridge.py).', status: null };
    },
  };
}

export type BridgeService = ReturnType<typeof createBridgeService>;

export const bridgeService = createBridgeService();
