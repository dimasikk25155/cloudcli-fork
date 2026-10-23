/**
 * Парк Димы: реестр `~/.claude/skills/fleet-status/services.yaml` (тот же, что
 * у скилла fleet-status) + пульс WhatsApp-ботов на маке. Проверка без модели:
 * ssh/launchctl/curl с жёсткими таймаутами, машины параллельно.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import type { DuetMethod, DuetService, DuetServiceState, DuetSnapshot, DuetStatus } from './duet.types.js';

export type ExecResult = { code: number; stdout: string };
export type Exec = (command: string, args: string[], timeoutMs: number) => Promise<ExecResult>;

/** Пульс бота из панели «Сервер» (`getBotsHealth`). */
export type HeartbeatBot = { id: string; label: string; ok: boolean; detail: string; folder?: string };

export const SSH_HOST = 'vps-nl';
export const SSH_ARGS = ['-o', 'ConnectTimeout=12', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new'];
const SSH_TIMEOUT_MS = 25_000;
const LOCAL_TIMEOUT_MS = 8_000;

/** Имя юнита/контейнера/лейбла, которое можно вставить в удалённую команду. */
export const SAFE_TARGET = /^[A-Za-z0-9@._:-]{1,120}$/;

export function registryPath(): string {
  return process.env.NEO3_DUET_REGISTRY
    || path.join(os.homedir(), '.claude', 'skills', 'fleet-status', 'services.yaml');
}

export function serviceId(machine: string, method: string, target: string): string {
  return createHash('sha1').update(`${machine}|${method}|${target}`).digest('hex').slice(0, 10);
}

const METHODS: ReadonlySet<string> = new Set(['systemd', 'docker', 'http', 'launchd']);

/** Однострочные flow-мапы `- { machine: …, method: …, target: …, crit: …, label: "…" }`. */
export function parseRegistry(text: string): DuetService[] {
  const services: DuetService[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#') || !/^-\s*\{.*\}/.test(line)) continue;
    const machine = line.match(/machine:\s*([A-Za-z0-9._-]+)/)?.[1];
    const method = line.match(/method:\s*([A-Za-z0-9._-]+)/)?.[1];
    const crit = line.match(/crit:\s*(crit|opt)/)?.[1];
    const target = line.match(/target:\s*(?:"([^"]*)"|([^,]+?))\s*,\s*crit:/);
    if (!machine || !method || !crit || !target || !METHODS.has(method)) continue;
    const value = (target[1] ?? target[2] ?? '').trim();
    if (!value) continue;
    const label = line.match(/label:\s*"([^"]*)"/)?.[1] || value;
    services.push({
      id: serviceId(machine, method, value),
      machine,
      method: method as DuetMethod,
      target: value,
      crit: crit === 'crit',
      label,
    });
  }
  return services;
}

export function heartbeatServices(bots: HeartbeatBot[]): Array<{ service: DuetService; status: DuetStatus; detail: string }> {
  return bots.map((bot) => ({
    service: {
      id: serviceId('mac', 'heartbeat', bot.id),
      machine: 'mac',
      method: 'heartbeat' as const,
      target: bot.id,
      crit: true,
      label: bot.label,
      ...(bot.folder ? { projectHint: bot.folder } : {}),
    },
    status: bot.ok ? 'up' : 'down',
    detail: bot.detail,
  }));
}

// ------------------------------------------------------------------ проверки

async function checkVpsSystemd(exec: Exec, targets: string[]): Promise<Map<string, DuetStatus>> {
  const result = new Map<string, DuetStatus>();
  if (targets.length === 0) return result;
  const { code, stdout } = await exec('ssh', [...SSH_ARGS, SSH_HOST, `systemctl is-active ${targets.join(' ')}`], SSH_TIMEOUT_MS);
  if (code === 255 || code === 124) {
    targets.forEach((target) => result.set(target, 'unreachable'));
    return result;
  }
  const lines = stdout.trim().split('\n');
  targets.forEach((target, index) => {
    const state = (lines[index] ?? '').trim();
    result.set(target, state === 'active' ? 'up' : state === 'activating' ? 'idle' : 'down');
  });
  return result;
}

async function checkVpsDocker(exec: Exec, targets: string[]): Promise<Map<string, DuetStatus>> {
  const result = new Map<string, DuetStatus>();
  if (targets.length === 0) return result;
  const script = `for n in ${targets.join(' ')}; do printf '%s\\t%s\\n' "$n" "$(docker inspect -f '{{.State.Status}}' "$n" 2>/dev/null || echo missing)"; done`;
  const { code, stdout } = await exec('ssh', [...SSH_ARGS, SSH_HOST, script], SSH_TIMEOUT_MS);
  if (code === 255 || code === 124) {
    targets.forEach((target) => result.set(target, 'unreachable'));
    return result;
  }
  targets.forEach((target) => result.set(target, 'down'));
  for (const line of stdout.trim().split('\n')) {
    const [name, state] = line.split('\t').map((part) => part?.trim());
    if (!name || !result.has(name)) continue;
    result.set(name, state === 'running' ? 'up' : state === 'missing' ? 'missing' : 'down');
  }
  return result;
}

async function checkHttp(exec: Exec, url: string): Promise<DuetStatus> {
  const { stdout } = await exec('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '6', url], 10_000);
  return stdout.trim().startsWith('2') ? 'up' : 'down';
}

async function checkLaunchd(exec: Exec, label: string): Promise<DuetStatus> {
  const { code, stdout } = await exec('launchctl', ['list', label], LOCAL_TIMEOUT_MS);
  if (code !== 0) return 'down';
  return /"PID"\s*=\s*\d+/.test(stdout) ? 'up' : 'idle';
}

/** Статусы всех сервисов реестра. Небезопасное имя или неизвестная машина → unknown. */
export async function checkServices(services: DuetService[], exec: Exec): Promise<Map<string, DuetStatus>> {
  const statuses = new Map<string, DuetStatus>();
  const safe = (service: DuetService) => service.method === 'http' || SAFE_TARGET.test(service.target);
  const pick = (machine: string, method: DuetMethod) => services
    .filter((service) => service.machine === machine && service.method === method && safe(service))
    .map((service) => service.target);

  const vpsSystemd = pick(SSH_HOST, 'systemd');
  const vpsDocker = pick(SSH_HOST, 'docker');
  const [systemd, docker] = await Promise.all([checkVpsSystemd(exec, vpsSystemd), checkVpsDocker(exec, vpsDocker)]);

  await Promise.all(services.map(async (service) => {
    let status: DuetStatus = 'unknown';
    if (!safe(service)) {
      status = 'unknown';
    } else if (service.machine === SSH_HOST && service.method === 'systemd') {
      status = systemd.get(service.target) ?? 'unknown';
    } else if (service.machine === SSH_HOST && service.method === 'docker') {
      status = docker.get(service.target) ?? 'unknown';
    } else if (service.method === 'http') {
      status = await checkHttp(exec, service.target).catch(() => 'down' as const);
    } else if (service.machine === 'mac' && service.method === 'launchd') {
      status = await checkLaunchd(exec, service.target).catch(() => 'down' as const);
    }
    statuses.set(service.id, status);
  }));
  return statuses;
}

/** Новый снимок: статус + «с какого времени» (переносится, пока статус тот же). */
export function buildSnapshot(
  services: DuetService[],
  statuses: Map<string, DuetStatus>,
  extra: Array<{ service: DuetService; status: DuetStatus; detail: string }>,
  previous: DuetSnapshot | null,
  now: Date,
): DuetSnapshot {
  const before = new Map((previous?.services ?? []).map((entry) => [entry.id, entry]));
  const stamp = now.toISOString();
  const entries: DuetServiceState[] = [
    ...services.map((service) => ({ service, status: statuses.get(service.id) ?? ('unknown' as DuetStatus), detail: undefined as string | undefined })),
    ...extra,
  ].map(({ service, status, detail }) => {
    const old = before.get(service.id);
    return {
      ...service,
      status,
      since: old && old.status === status ? old.since : stamp,
      ...(detail ? { detail } : {}),
    };
  });
  return { checkedAt: stamp, services: entries };
}

export function isBroken(status: DuetStatus): boolean {
  return status === 'down' || status === 'missing';
}

export type FleetDiff = { fell: DuetServiceState[]; recovered: DuetServiceState[] };

/**
 * Что изменилось с прошлой проверки. Первый снимок молчит (старые аварии
 * попадут в бриф), «недоступно» не тревога — это связь, а не сервис.
 */
export function diffSnapshots(previous: DuetSnapshot | null, next: DuetSnapshot, muted: readonly string[]): FleetDiff {
  if (!previous) return { fell: [], recovered: [] };
  const before = new Map(previous.services.map((entry) => [entry.id, entry.status]));
  const quiet = new Set(muted);
  const fell: DuetServiceState[] = [];
  const recovered: DuetServiceState[] = [];
  for (const entry of next.services) {
    const old = before.get(entry.id);
    if (old === undefined || quiet.has(entry.id)) continue;
    if (isBroken(entry.status) && (old === 'up' || old === 'idle')) fell.push(entry);
    if ((entry.status === 'up' || entry.status === 'idle') && isBroken(old)) recovered.push(entry);
  }
  return { fell, recovered };
}

/** Хвост лога упавшего сервиса — для брифа и задания на починку. */
export async function fetchServiceDetail(service: DuetService, exec: Exec): Promise<string> {
  if (!SAFE_TARGET.test(service.target) && service.method !== 'http') return '';
  let output = '';
  if (service.machine === SSH_HOST && service.method === 'systemd') {
    output = (await exec('ssh', [...SSH_ARGS, SSH_HOST,
      `systemctl status ${service.target} --no-pager -n 0 2>&1 | head -6; journalctl -u ${service.target} -n 25 --no-pager 2>&1`], SSH_TIMEOUT_MS)).stdout;
  } else if (service.machine === SSH_HOST && service.method === 'docker') {
    output = (await exec('ssh', [...SSH_ARGS, SSH_HOST,
      `docker ps -a --filter name=^${service.target}$ --format '{{.Status}}' 2>&1; docker logs --tail 25 ${service.target} 2>&1`], SSH_TIMEOUT_MS)).stdout;
  } else if (service.machine === 'mac' && service.method === 'launchd') {
    output = (await exec('launchctl', ['list', service.target], LOCAL_TIMEOUT_MS)).stdout;
  }
  const clean = output.trim();
  return clean.length > 2500 ? `…${clean.slice(-2500)}` : clean;
}

/** Боевой exec: execFile без shell, код 124 — таймаут. */
export const realExec: Exec = (command, args, timeoutMs) => new Promise((resolve) => {
  execFile(command, args, { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
    const err = error as (NodeJS.ErrnoException & { code?: number | string; killed?: boolean }) | null;
    const code = !err ? 0 : err.killed ? 124 : typeof err.code === 'number' ? err.code : 1;
    resolve({ code, stdout: String(stdout ?? '') });
  });
});

/** Можно ли перезапустить сервис сервером (без агента). */
export function canRestart(service: DuetService): boolean {
  if (!SAFE_TARGET.test(service.target)) return false;
  if (service.machine === SSH_HOST) return service.method === 'systemd' || service.method === 'docker';
  return service.machine === 'mac' && service.method === 'launchd';
}

export async function restartService(service: DuetService, exec: Exec): Promise<ExecResult> {
  if (!canRestart(service)) return { code: 1, stdout: 'Этот сервис сервер сам перезапускать не умеет' };
  if (service.machine === SSH_HOST && service.method === 'systemd') {
    return exec('ssh', [...SSH_ARGS, SSH_HOST, `systemctl restart ${service.target} 2>&1`], SSH_TIMEOUT_MS);
  }
  if (service.machine === SSH_HOST && service.method === 'docker') {
    return exec('ssh', [...SSH_ARGS, SSH_HOST, `docker restart ${service.target} 2>&1`], SSH_TIMEOUT_MS);
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
  return exec('launchctl', ['kickstart', '-k', `gui/${uid}/${service.target}`], LOCAL_TIMEOUT_MS);
}
