import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { explainFailure, groupErrors } from '@/modules/vps/vps.service.js';
import type { Diagnosis, LogLine, Overview, ServiceAction, ServiceInfo } from '@/modules/vps/vps.service.js';

const run = promisify(execFile);

// macOS-половина панели сервера. Linux-путь (systemd + /proc) живёт в
// vps.service.ts и здесь не участвует — это два независимых бэкенда под один
// и тот же контракт, чтобы фронт не знал, на какой машине он открыт.
//
// Отличий, из-за которых нельзя было обойтись «подменой пары команд», три:
//   * нет /proc — метрики берутся из sysctl/vm_stat/netstat;
//   * нет journald — логи только те, что демон пишет в свои файлы (в plist);
//   * launchd адресует сервисы не именем юнита, а меткой в домене gui/<uid>.

const EXEC_OPTS = { timeout: 15_000, maxBuffer: 8 * 1024 * 1024 } as const;

export const IS_DARWIN = process.platform === 'darwin';

/** Метка launchd: обратный домен, без слэшей — иначе можно уехать в чужой домен. */
export const LABEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/;

const GUI_DOMAIN = `gui/${process.getuid?.() ?? 501}`;
const AGENTS_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');

// Погасив это, панель отрубит сама себя или доступ к маку.
const PROTECTED_LABELS = new Set(['com.dimasik.neo3-local']);
const PROTECTED_PREFIXES = ['com.apple.', 'com.tailscale', 'io.tailscale', 'homebrew.mxcl.tailscale'];

const ERROR_RE = /error|traceback|exception|failed|fatal|critical|panic|refused|denied|unauthorized/i;
const WARN_RE = /warn|deprecat|retry|timeout|slow/i;

async function safeRun(cmd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  try {
    const { stdout } = await run(cmd, args, EXEC_OPTS);
    return { ok: true, stdout: stdout.trim() };
  } catch (error) {
    const partial = (error as { stdout?: string })?.stdout;
    return { ok: false, stdout: typeof partial === 'string' ? partial.trim() : '' };
  }
}

// ---------------------------------------------------------------- overview

let lastCpu: { idle: number; total: number } | null = null;
let lastNet: { rx: number; tx: number; ts: number } | null = null;

/**
 * CPU через os.cpus(): Node сам отдаёт накопленные тики планировщика, и это
 * единственный способ получить загрузку мгновенно. `top -l 2` честнее, но
 * стоит двух секунд ожидания на каждый опрос панели.
 */
function cpuPercent(): number {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  const prev = lastCpu;
  lastCpu = { idle, total };
  if (!prev || total <= prev.total) return 0;
  const busy = total - prev.total - (idle - prev.idle);
  return Math.max(0, Math.min(100, Math.round((busy / (total - prev.total)) * 100)));
}

/** Exported for tests. */
export function parseVmStat(raw: string, pageSize: number) {
  const pages: Record<string, number> = {};
  for (const line of raw.split('\n')) {
    const match = /^Pages\s+(.+?):\s+(\d+)\./.exec(line.trim());
    if (match) pages[match[1]] = Number(match[2]);
  }
  // «Занято» по-маковски — active + wired + compressed. Inactive и speculative
  // система отдаёт приложениям по первому требованию, считать их занятыми
  // значит рисовать 90% занятой памяти на пустом маке.
  const busyPages =
    (pages.active ?? 0) + (pages['wired down'] ?? 0) + (pages['occupied by compressor'] ?? 0);
  return busyPages * pageSize;
}

/** Exported for tests. */
export function parseSwapUsage(raw: string) {
  const toBytes = (value: string | undefined) => Math.round(Number(value ?? 0) * 1024 * 1024);
  const total = toBytes(/total\s*=\s*([\d.]+)M/.exec(raw)?.[1]);
  const used = toBytes(/used\s*=\s*([\d.]+)M/.exec(raw)?.[1]);
  return { totalBytes: total, usedBytes: used, pct: total ? Math.round((used / total) * 100) : 0 };
}

async function memInfo() {
  const total = os.totalmem();
  const [vmStat, pageSizeRaw, swapRaw] = await Promise.all([
    safeRun('vm_stat', []),
    safeRun('sysctl', ['-n', 'hw.pagesize']),
    safeRun('sysctl', ['-n', 'vm.swapusage']),
  ]);
  const pageSize = Number(pageSizeRaw.stdout) || 4096;
  const used = vmStat.ok ? parseVmStat(vmStat.stdout, pageSize) : total - os.freemem();
  const available = Math.max(0, total - used);
  return {
    mem: {
      totalBytes: total,
      usedBytes: used,
      availableBytes: available,
      pct: total ? Math.round((used / total) * 100) : 0,
    },
    swap: parseSwapUsage(swapRaw.stdout),
  };
}

const APPLE_SYSTEM_VOLUMES = /^\/System\/Volumes\/(VM|Preboot|Update|xarts|iSCPreboot|Hardware)$/;

/** Exported for tests: `df -P -k` на macOS, размеры в килобайтах. */
export function parseDf(stdout: string) {
  return stdout
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 6 && cols[0].startsWith('/dev'))
    .map((cols) => ({
      mount: cols.slice(5).join(' '),
      totalBytes: Number(cols[1]) * 1024,
      usedBytes: Number(cols[2]) * 1024,
      pct: Number(String(cols[4]).replace('%', '')),
    }))
    // Apple монтирует системный том ещё и read-only копией — в панели это
    // выглядит как два одинаковых диска.
    .filter((disk, index, all) => all.findIndex((other) => other.mount === disk.mount) === index)
    // Служебные тома APFS (Preboot, VM, xarts, Hardware) человеку не говорят
    // ничего: они по паре сотен мегабайт и заполнены всегда. Из-за них список
    // дисков превращался в девять строк, где важные — «/» и «Data» — терялись.
    .filter((disk) => !APPLE_SYSTEM_VOLUMES.test(disk.mount));
}

async function disks() {
  const { stdout } = await run('df', ['-P', '-k'], EXEC_OPTS);
  return parseDf(stdout);
}

/** Exported for tests: суммарные счётчики из `netstat -ib`, по одной строке на интерфейс. */
export function parseNetstat(stdout: string) {
  let rx = 0;
  let tx = 0;
  const seen = new Set<string>();
  for (const line of stdout.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    const iface = cols[0];
    if (!iface || seen.has(iface) || /^(lo|utun|gif|stf|awdl|llw|bridge)/.test(iface)) continue;
    // netstat повторяет интерфейс для каждого адреса — байты в этих строках
    // одни и те же, сложить их значит удвоить трафик.
    seen.add(iface);
    const ibytes = Number(cols[6]);
    const obytes = Number(cols[9]);
    if (Number.isFinite(ibytes)) rx += ibytes;
    if (Number.isFinite(obytes)) tx += obytes;
  }
  return { rx, tx };
}

async function netCounters() {
  const { stdout } = await safeRun('netstat', ['-ib']);
  const { rx, tx } = parseNetstat(stdout);
  const now = Date.now();
  const prev = lastNet;
  lastNet = { rx, tx, ts: now };
  const seconds = prev ? (now - prev.ts) / 1000 : 0;
  return {
    rxBytes: rx,
    txBytes: tx,
    rxRate: prev && seconds > 0 ? Math.max(0, Math.round((rx - prev.rx) / seconds)) : 0,
    txRate: prev && seconds > 0 ? Math.max(0, Math.round((tx - prev.tx) / seconds)) : 0,
  };
}

export async function darwinOverview(): Promise<Overview> {
  // Загрузка CPU — величина дельта-типа: первый опрос сравнивать не с чем и он
  // честно отдаёт 0. На Linux панель опрашивается раз в несколько секунд и это
  // незаметно, а тут первый заход в панель показывал бы «0%» при живой машине.
  // Поэтому берём короткую паузу и считаем по двум снимкам.
  if (!lastCpu) {
    cpuPercent();
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const [mem, diskList, net, productName, productVersion, procRaw] = await Promise.all([
    memInfo(),
    disks().catch(() => []),
    netCounters().catch(() => ({ rxBytes: 0, txBytes: 0, rxRate: 0, txRate: 0 })),
    safeRun('sw_vers', ['-productName']),
    safeRun('sw_vers', ['-productVersion']),
    safeRun('sysctl', ['-n', 'kern.num_tasks']),
  ]);
  const load = os.loadavg();

  return {
    hostname: os.hostname(),
    os: [productName.stdout || 'macOS', productVersion.stdout].filter(Boolean).join(' '),
    kernel: `Darwin ${os.release()}`,
    uptimeSec: Math.round(os.uptime()),
    loadavg: [load[0], load[1], load[2]],
    cpuCores: os.cpus().length,
    cpuPct: cpuPercent(),
    ...mem,
    disks: diskList,
    net,
    procCount: Number(procRaw.stdout) || 0,
    ts: Date.now(),
  };
}

// ---------------------------------------------------------------- services

type Plist = Record<string, unknown>;

async function readPlist(file: string): Promise<Plist | null> {
  const { ok, stdout } = await safeRun('plutil', ['-convert', 'json', '-o', '-', file]);
  if (!ok || !stdout) return null;
  try {
    return JSON.parse(stdout) as Plist;
  } catch {
    return null;
  }
}

/** Свои агенты — те, чей plist лежит в ~/Library/LaunchAgents. Их и показываем. */
async function ownAgents(): Promise<Map<string, { file: string; plist: Plist }>> {
  const found = new Map<string, { file: string; plist: Plist }>();
  let entries: string[];
  try {
    entries = await fs.readdir(AGENTS_DIR);
  } catch {
    return found;
  }
  await Promise.all(
    entries
      .filter((name) => name.endsWith('.plist'))
      .map(async (name) => {
        const file = path.join(AGENTS_DIR, name);
        const plist = await readPlist(file);
        const label = typeof plist?.Label === 'string' ? plist.Label : name.replace(/\.plist$/, '');
        if (plist) found.set(label, { file, plist });
      }),
  );
  return found;
}

/** Exported for tests: `launchctl list` — три колонки PID / статус выхода / метка. */
export function parseLaunchctlList(stdout: string) {
  return stdout
    .split('\n')
    .slice(1)
    .map((line) => line.split('\t'))
    .filter((cols) => cols.length >= 3)
    .map((cols) => ({
      pid: cols[0] === '-' ? null : Number(cols[0]),
      lastExit: cols[1] === '-' ? null : Number(cols[1]),
      label: cols[2].trim(),
    }))
    .filter((entry) => LABEL_RE.test(entry.label));
}

export function isControllableLabel(label: string, own: boolean): boolean {
  if (PROTECTED_LABELS.has(label)) return false;
  if (PROTECTED_PREFIXES.some((prefix) => label.startsWith(prefix))) return false;
  return own;
}

/**
 * Exported for tests.
 *
 * У launchd нет «упал/работает» одной строкой: он показывает PID и код
 * последнего выхода. Живой PID — работает; ненулевой код без PID — упал;
 * нулевой код без PID — отработал и вышел, для скрипта по расписанию это норма,
 * а не авария.
 */
export function classifyLaunchdHealth(pid: number | null, lastExit: number | null, keepAlive: boolean): ServiceInfo['health'] {
  if (pid) return 'up';
  if (lastExit !== null && lastExit !== 0) return keepAlive ? 'flapping' : 'failed';
  return keepAlive ? 'down' : 'idle';
}

async function processStats(pids: number[]): Promise<Map<number, { rss: number; startedMs: number | null }>> {
  const stats = new Map<number, { rss: number; startedMs: number | null }>();
  if (pids.length === 0) return stats;
  const { ok, stdout } = await safeRun('ps', ['-o', 'pid=,rss=,lstart=', '-p', pids.join(',')]);
  if (!ok && !stdout) return stats;
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!match) continue;
    const started = Date.parse(match[3]);
    stats.set(Number(match[1]), {
      rss: Number(match[2]) * 1024,
      startedMs: Number.isFinite(started) ? started : null,
    });
  }
  return stats;
}

export async function darwinListServices(): Promise<ServiceInfo[]> {
  const [{ stdout }, agents] = await Promise.all([safeRun('launchctl', ['list']), ownAgents()]);
  const entries = parseLaunchctlList(stdout);

  // Системного мусора у Apple сотни меток; панель показывает свои агенты плюс
  // то, что человек ставил руками (homebrew и прочее), иначе список нечитаем.
  const visible = entries.filter(
    (entry) => agents.has(entry.label) || !entry.label.startsWith('com.apple.'),
  );
  const stats = await processStats(visible.map((entry) => entry.pid).filter((pid): pid is number => Boolean(pid)));

  return visible
    .map((entry): ServiceInfo => {
      const agent = agents.get(entry.label);
      const own = Boolean(agent);
      const keepAlive = Boolean(agent?.plist?.KeepAlive);
      const stat = entry.pid ? stats.get(entry.pid) : undefined;
      const program = Array.isArray(agent?.plist?.ProgramArguments)
        ? (agent?.plist?.ProgramArguments as unknown[]).join(' ')
        : typeof agent?.plist?.Program === 'string'
          ? String(agent?.plist?.Program)
          : '';
      return {
        unit: entry.label,
        name: entry.label.replace(/^(com|io|org)\./, ''),
        description: program || entry.label,
        state: entry.pid ? 'active' : 'inactive',
        sub: entry.pid ? 'running' : entry.lastExit ? 'failed' : 'dead',
        // launchd не различает «включён» и «загружен»: раз метка в списке — она загружена.
        enabled: own ? 'enabled' : 'unknown',
        since: stat?.startedMs ? new Date(stat.startedMs).toISOString() : null,
        uptimeSec: stat?.startedMs ? Math.round((Date.now() - stat.startedMs) / 1000) : null,
        memoryBytes: stat?.rss ?? null,
        pid: entry.pid,
        // Счётчика перезапусков launchd не ведёт — врать нулём честнее, чем
        // рисовать «флапает» из кода выхода.
        restarts: 0,
        own,
        controllable: isControllableLabel(entry.label, own),
        health: classifyLaunchdHealth(entry.pid, entry.lastExit, keepAlive),
      };
    })
    .sort((a, b) => Number(b.own) - Number(a.own) || a.name.localeCompare(b.name));
}

export async function darwinControlService(label: string, action: ServiceAction) {
  if (!LABEL_RE.test(label)) throw new Error('Некорректное имя сервиса');
  const agents = await ownAgents();
  const agent = agents.get(label);
  if (!isControllableLabel(label, Boolean(agent))) {
    throw new Error(
      `Сервисом ${label} нельзя управлять из панели: это системный агент Apple или сам Neo3 ` +
        '(остановив его, вы потеряете доступ к самой панели).',
    );
  }
  if (!agent) throw new Error(`Агент ${label} не найден в ~/Library/LaunchAgents`);

  const target = `${GUI_DOMAIN}/${label}`;
  const commands: Record<ServiceAction, string[]> = {
    // kickstart -k поднимает и уже запущенное, и лежачее — на маке это
    // единственный перезапуск, который не требует сначала выгрузить агента.
    restart: ['kickstart', '-k', target],
    start: ['kickstart', target],
    stop: ['bootout', target],
    enable: ['enable', target],
    disable: ['disable', target],
  };

  try {
    await run('launchctl', commands[action], EXEC_OPTS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Выгруженный агент нельзя kickstart'ить — его сначала надо вернуть в домен.
    if (action === 'start' && /No such process|3: No such process/i.test(message)) {
      await run('launchctl', ['bootstrap', GUI_DOMAIN, agent.file], EXEC_OPTS);
      return { unit: label, action, ok: true };
    }
    throw new Error(`launchctl ${action} ${label}: ${message}`);
  }
  return { unit: label, action, ok: true };
}

// -------------------------------------------------------------------- logs

/** Хвост файла без чтения целиком — лог бота бывает на гигабайт. */
async function tailFile(file: string, maxLines: number): Promise<string[]> {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const window = Math.min(size, 512 * 1024);
    const buffer = Buffer.alloc(window);
    await handle.read(buffer, 0, window, size - window);
    const chunk = buffer.toString('utf8');
    return chunk
      .split('\n')
      .slice(size > window ? 1 : 0)
      .filter(Boolean)
      .slice(-maxLines);
  } finally {
    await handle.close();
  }
}

function toLogLine(text: string): LogLine {
  return { ts: '', level: ERROR_RE.test(text) ? 'error' : WARN_RE.test(text) ? 'warn' : 'info', text };
}

export async function darwinGetLogs(
  label: string,
  { lines = 200, level = 'info' as 'error' | 'warn' | 'info' } = {},
): Promise<{ unit: string; lines: LogLine[]; source: 'journal' | 'file'; path?: string; note?: string }> {
  if (!LABEL_RE.test(label)) throw new Error('Некорректное имя сервиса');
  const safeLines = Math.min(Math.max(Number(lines) || 200, 20), 2000);

  const agents = await ownAgents();
  const plist = agents.get(label)?.plist;
  const files = [plist?.StandardOutPath, plist?.StandardErrorPath]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    // Один и тот же файл под обе трубы — обычная практика, читать его дважды незачем.
    .filter((file, index, all) => all.indexOf(file) === index);

  if (files.length === 0) {
    return {
      unit: label,
      lines: [],
      source: 'file',
      note:
        'У этого агента в plist не указаны StandardOutPath/StandardErrorPath, а системного журнала ' +
        'как на Linux в macOS нет — логи показать неоткуда. Допишите пути в plist, и они появятся.',
    };
  }

  const collected: LogLine[] = [];
  const read: string[] = [];
  const missing: string[] = [];
  for (const file of files) {
    try {
      const tail = await tailFile(file, safeLines);
      collected.push(...tail.map(toLogLine));
      read.push(file);
    } catch {
      missing.push(file);
    }
  }

  const filtered = collected.filter((line) => {
    if (level === 'error') return line.level === 'error';
    if (level === 'warn') return line.level === 'error' || line.level === 'warn';
    return true;
  });

  return {
    unit: label,
    lines: filtered.slice(-safeLines),
    source: 'file',
    path: read[0],
    note:
      read.length === 0
        ? `Файлы логов из plist не читаются: ${missing.join(', ')}`
        : `macOS: логи берутся из файлов агента (${read.join(', ')}), системного журнала здесь нет.`,
  };
}

export async function darwinDiagnose(label: string): Promise<Diagnosis> {
  const services = await darwinListServices();
  const service = services.find((entry) => entry.unit === label);
  if (!service) throw new Error(`Сервис ${label} не найден`);

  const logs = await darwinGetLogs(label, { lines: 400, level: 'info' }).catch(() => null);
  const errorLines = (logs?.lines ?? []).filter((line) => line.level === 'error');
  const lastError = errorLines.length > 0 ? errorLines[errorLines.length - 1].text : null;
  // Правила разбора («сдохла подписка», «нет токена», «порт занят») общие для
  // обеих платформ — на маке они читают ту же ошибку, просто добытую из файла.
  const explained = lastError ? explainFailure(lastError) : null;

  return {
    unit: label,
    enabled: service.enabled,
    result: service.health === 'up' ? null : service.sub,
    // launchd отдаёт код последнего выхода только строкой списка; в момент
    // диагноза берём то, что видно: живой PID = 0, иначе неизвестно.
    exitCode: service.pid ? 0 : null,
    restarts: service.restarts,
    restartSec: null,
    execStart: service.description,
    logPath: logs?.path ?? null,
    lastError,
    reason:
      explained?.reason ??
      (service.health === 'up'
        ? null
        : service.health === 'idle'
          ? 'Отработал и вышел без ошибки — для разового скрипта это норма.'
          : 'Агент не работает, а ошибок в логе нет: скорее всего он выгружен из launchd.'),
    advice:
      explained?.advice ??
      (service.health === 'up' || service.health === 'idle'
        ? null
        : 'Проверьте, загружен ли plist: launchctl print ' + GUI_DOMAIN + '/' + label),
    needsHuman: explained?.needsHuman ?? false,
  };
}

export async function darwinRecentErrors(hours = 24, limit = 400) {
  const safeHours = Math.min(Math.max(Number(hours) || 24, 1), 168);
  const services = await darwinListServices();
  const lines: Array<{ ts: string; source: string; text: string }> = [];

  for (const service of services.filter((entry) => entry.own)) {
    const logs = await darwinGetLogs(service.unit, { lines: 500, level: 'error' }).catch(() => null);
    for (const line of logs?.lines ?? []) {
      // Строки в файлах логов не датированы единым форматом — окно «за сутки»
      // применить не к чему, поэтому отдаём последние ошибки как есть.
      lines.push({ ts: '', source: service.name, text: line.text });
    }
  }

  return { hours: safeHours, total: lines.length, groups: groupErrors(lines).slice(0, limit) };
}

export async function darwinInventory() {
  const [docker, listen, node, python, psql, dockerVersion, top, brew] = await Promise.all([
    safeRun('docker', ['ps', '--format', '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}']),
    safeRun('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN']),
    safeRun('node', ['--version']),
    safeRun('python3', ['--version']),
    safeRun('psql', ['--version']),
    safeRun('docker', ['--version']),
    safeRun('ps', ['-Ao', 'pid,comm,pcpu,rss', '-r']),
    safeRun('sw_vers', ['-buildVersion']),
  ]);

  const containers = docker.stdout
    ? docker.stdout.split('\n').map((line) => {
        const [name, image, status, ports] = line.split('\t');
        return { name, image, status, ports: ports || '' };
      })
    : [];

  const ports = lsofPorts(listen.stdout);

  const topProcesses = top.stdout
    .split('\n')
    .slice(1, 13)
    .map((line) => {
      const cols = line.trim().split(/\s+/);
      return {
        pid: Number(cols[0]),
        name: (cols[1] ?? '').split('/').pop() ?? '',
        cpu: Number(cols[2]),
        rssBytes: Number(cols[3]) * 1024,
      };
    })
    .filter((entry) => entry.pid);

  return {
    containers,
    dockerInstalled: Boolean(dockerVersion.stdout),
    dockerAvailable: docker.ok,
    ports,
    topProcesses,
    // /opt на маке пустой — раскладка по папкам там не про что, и рисовать
    // пустой блок хуже, чем честно сказать «нет данных».
    folders: [],
    foldersAvailable: false,
    runtimes: {
      node: node.stdout || null,
      python: python.stdout || null,
      postgres: psql.stdout || null,
      docker: dockerVersion.stdout || null,
      build: brew.stdout || null,
    },
  };
}

/** Exported for tests: слушающие порты из `lsof -nP -iTCP -sTCP:LISTEN`. */
export function lsofPorts(stdout: string) {
  const seen = new Set<string>();
  const result: Array<{ addr: string; proc: string }> = [];
  for (const line of stdout.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    const proc = cols[0];
    const addr = cols[8];
    if (!proc || !addr) continue;
    const key = `${addr}|${proc}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ addr, proc });
  }
  return result.sort((a, b) => a.addr.localeCompare(b.addr));
}
