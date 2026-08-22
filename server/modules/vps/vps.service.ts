import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import { promisify } from 'node:util';

import {
  darwinControlService,
  darwinDiagnose,
  darwinGetLogs,
  darwinInventory,
  darwinListServices,
  darwinOverview,
  darwinRecentErrors,
} from '@/modules/vps/vps.darwin.js';

const run = promisify(execFile);

// Панель работает на двух платформах: прод на VPS (systemd) и локальный агент
// на маке. Реализации не смешиваются — каждая публичная функция на macOS сразу
// уходит в vps.darwin.ts, поэтому Linux-ветка ниже читается так же, как раньше.
const IS_DARWIN = process.platform === 'darwin';

// Панель сервера: живое состояние машины, на которой крутится Neo3.
// Всё читается из /proc и systemd — никаких агентов и демонов сверху.
// Управление сервисами идёт через `sudo systemctl`, поэтому юзеру нужен
// узкий sudoers-файл (см. SERVER-PANEL-SETUP.md). Без него панель работает
// в режиме «только смотреть», а не падает.

const EXEC_OPTS = { timeout: 15_000, maxBuffer: 8 * 1024 * 1024 } as const;

// Юниты, которые нельзя трогать из панели: погасив их, Дима отрубит себе
// же доступ к этой самой панели. Смотреть можно, кнопок управления нет.
const PROTECTED_UNITS = new Set([
  'neo3.service',
  'ssh.service',
  'sshd.service',
  'tailscaled.service',
  'docker.service',
  'containerd.service',
  'systemd-journald.service',
  'systemd-logind.service',
  'dbus.service',
]);

const PROTECTED_PREFIXES = ['cloudflared', 'systemd-', 'user@', 'getty@'];

export const UNIT_RE = /^[a-zA-Z0-9@._\-\\:]{1,120}\.service$/;

export type ServiceInfo = {
  unit: string;
  name: string;
  description: string;
  state: string;
  sub: string;
  enabled: string;
  since: string | null;
  uptimeSec: number | null;
  memoryBytes: number | null;
  pid: number | null;
  restarts: number;
  own: boolean;
  controllable: boolean;
  health: 'up' | 'down' | 'failed' | 'flapping' | 'idle';
};

export type Overview = {
  hostname: string;
  os: string;
  kernel: string;
  uptimeSec: number;
  loadavg: [number, number, number];
  cpuCores: number;
  cpuPct: number;
  mem: { totalBytes: number; usedBytes: number; availableBytes: number; pct: number };
  swap: { totalBytes: number; usedBytes: number; pct: number };
  disks: Array<{ mount: string; totalBytes: number; usedBytes: number; pct: number }>;
  net: { rxBytes: number; txBytes: number; rxRate: number; txRate: number };
  procCount: number;
  ts: number;
};

// ---------------------------------------------------------------- helpers

async function readText(path: string): Promise<string> {
  return fs.readFile(path, 'utf8');
}

function toNum(value: string | undefined): number | null {
  if (!value || value === '[not set]' || value === 'infinity') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Разбирает вывод `systemctl show a b c` — блоки через пустую строку. Exported for tests. */
export function parseShowBlocks(stdout: string): Array<Record<string, string>> {
  return stdout
    .split('\n\n')
    .map((block) => {
      const record: Record<string, string> = {};
      for (const line of block.split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) record[line.slice(0, eq)] = line.slice(eq + 1);
      }
      return record;
    })
    .filter((record) => record.Id);
}

// ---------------------------------------------------------------- overview

// CPU и сеть — величины дельта-типа: одно чтение /proc ничего не говорит,
// нужен предыдущий снимок. Держим последний в памяти процесса.
let lastCpu: { idle: number; total: number } | null = null;
let lastNet: { rx: number; tx: number; ts: number } | null = null;

async function cpuPercent(): Promise<number> {
  const line = (await readText('/proc/stat')).split('\n')[0];
  const parts = line.split(/\s+/).slice(1).map(Number);
  const idle = (parts[3] ?? 0) + (parts[4] ?? 0);
  const total = parts.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  const prev = lastCpu;
  lastCpu = { idle, total };
  if (!prev || total <= prev.total) return 0;
  const busy = total - prev.total - (idle - prev.idle);
  return Math.max(0, Math.min(100, Math.round((busy / (total - prev.total)) * 100)));
}

async function memInfo() {
  const raw = await readText('/proc/meminfo');
  const kb: Record<string, number> = {};
  for (const line of raw.split('\n')) {
    const match = /^(\w+):\s+(\d+)/.exec(line);
    if (match) kb[match[1]] = Number(match[2]) * 1024;
  }
  const total = kb.MemTotal ?? 0;
  const available = kb.MemAvailable ?? 0;
  const swapTotal = kb.SwapTotal ?? 0;
  const swapUsed = swapTotal - (kb.SwapFree ?? 0);
  return {
    mem: {
      totalBytes: total,
      usedBytes: total - available,
      availableBytes: available,
      pct: total ? Math.round(((total - available) / total) * 100) : 0,
    },
    swap: {
      totalBytes: swapTotal,
      usedBytes: swapUsed,
      pct: swapTotal ? Math.round((swapUsed / swapTotal) * 100) : 0,
    },
  };
}

async function disks() {
  const { stdout } = await run('df', ['-PB1', '-x', 'tmpfs', '-x', 'devtmpfs', '-x', 'overlay'], EXEC_OPTS);
  return stdout
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 6 && cols[0].startsWith('/dev'))
    .map((cols) => ({
      mount: cols[5],
      totalBytes: Number(cols[1]),
      usedBytes: Number(cols[2]),
      pct: Number(String(cols[4]).replace('%', '')),
    }));
}

async function netCounters() {
  const raw = await readText('/proc/net/dev');
  let rx = 0;
  let tx = 0;
  for (const line of raw.split('\n').slice(2)) {
    const [iface, rest] = line.split(':');
    if (!rest || /^\s*(lo|docker|veth|br-|tailscale)/.test(iface)) continue;
    const cols = rest.trim().split(/\s+/).map(Number);
    rx += cols[0] ?? 0;
    tx += cols[8] ?? 0;
  }
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

async function osName(): Promise<string> {
  try {
    const raw = await readText('/etc/os-release');
    return /PRETTY_NAME="?([^"\n]+)"?/.exec(raw)?.[1] ?? os.type();
  } catch {
    return os.type();
  }
}

export async function getOverview(): Promise<Overview> {
  if (IS_DARWIN) return darwinOverview();
  const [cpuPct, mem, diskList, net, osLabel, loadRaw, procRaw] = await Promise.all([
    cpuPercent(),
    memInfo(),
    disks().catch(() => []),
    netCounters().catch(() => ({ rxBytes: 0, txBytes: 0, rxRate: 0, txRate: 0 })),
    osName(),
    readText('/proc/loadavg'),
    readText('/proc/loadavg'),
  ]);
  const load = loadRaw.split(/\s+/);
  const procCount = Number(procRaw.split(/\s+/)[3]?.split('/')[1] ?? 0);

  return {
    hostname: os.hostname(),
    os: osLabel,
    kernel: os.release(),
    uptimeSec: Math.round(os.uptime()),
    loadavg: [Number(load[0]), Number(load[1]), Number(load[2])],
    cpuCores: os.cpus().length,
    cpuPct,
    ...mem,
    disks: diskList,
    net,
    procCount,
    ts: Date.now(),
  };
}

// ---------------------------------------------------------------- services

/** Столько авто-перезапусков — уже не случайность, а «падает по кругу». */
const FLAPPING_RESTARTS = 3;

/**
 * Exported for tests.
 *
 * Порядок проверок важен. Падающий бот половину времени проводит в
 * `activating/auto-restart` — если сначала смотреть на ActiveState, он в этот
 * момент выглядит просто «выключенным», и авария маскируется под норму.
 * Поэтому число перезапусков перевешивает текущее состояние.
 */
export function classifyHealth(record: Record<string, string>, restarts: number): ServiceInfo['health'] {
  const state = record.ActiveState;
  const sub = record.SubState;
  if (state === 'failed' || sub === 'failed') return 'failed';
  if (restarts >= FLAPPING_RESTARTS || sub === 'auto-restart') return 'flapping';
  if (state === 'active') return sub === 'exited' || sub === 'dead' ? 'idle' : 'up';
  // Обычный старт после команды «запустить» — ещё не проблема.
  if (state === 'activating' || state === 'reloading') return 'up';
  return 'down';
}

/** Exported for tests: the guard that keeps the panel from killing its own host. */
export function isControllable(unit: string, fragmentPath: string): boolean {
  if (PROTECTED_UNITS.has(unit)) return false;
  if (PROTECTED_PREFIXES.some((prefix) => unit.startsWith(prefix))) return false;
  return fragmentPath.startsWith('/etc/systemd/system/');
}

export async function listServices(): Promise<ServiceInfo[]> {
  if (IS_DARWIN) return darwinListServices();
  const { stdout: unitsRaw } = await run(
    'systemctl',
    ['list-units', '--type=service', '--all', '--no-pager', '--no-legend', '--plain'],
    EXEC_OPTS,
  );
  const units = unitsRaw
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((unit) => UNIT_RE.test(unit));
  if (units.length === 0) return [];

  const { stdout } = await run(
    'systemctl',
    [
      'show',
      ...units,
      '--property=Id,Description,ActiveState,SubState,UnitFileState,ExecMainStartTimestampMonotonic,MemoryCurrent,MainPID,NRestarts,FragmentPath,ExecMainStartTimestamp',
    ],
    EXEC_OPTS,
  );

  const bootMs = Date.now() - os.uptime() * 1000;
  return parseShowBlocks(stdout)
    .map((record): ServiceInfo => {
      const unit = record.Id;
      const restarts = toNum(record.NRestarts) ?? 0;
      const startedMono = toNum(record.ExecMainStartTimestampMonotonic);
      const fragmentPath = record.FragmentPath ?? '';
      // Метка старта остаётся и после остановки сервиса — считать по ней
      // аптайм у выключенного юнита значит показывать неправду.
      const startedMs =
        record.ActiveState === 'active' && startedMono && startedMono > 0 ? bootMs + startedMono / 1000 : null;
      return {
        unit,
        name: unit.replace(/\.service$/, ''),
        description: record.Description || unit,
        state: record.ActiveState || 'unknown',
        sub: record.SubState || '',
        enabled: record.UnitFileState || 'unknown',
        since: record.ExecMainStartTimestamp || null,
        uptimeSec: startedMs ? Math.round((Date.now() - startedMs) / 1000) : null,
        memoryBytes: toNum(record.MemoryCurrent),
        pid: toNum(record.MainPID) || null,
        restarts,
        own: fragmentPath.startsWith('/etc/systemd/system/'),
        controllable: isControllable(unit, fragmentPath),
        health: classifyHealth(record, restarts),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Проверяет, что юнит существует и им вообще разрешено управлять. */
async function assertControllable(unit: string): Promise<void> {
  if (!UNIT_RE.test(unit)) {
    throw new Error('Некорректное имя сервиса');
  }
  const { stdout } = await run('systemctl', ['show', unit, '--property=Id,FragmentPath'], EXEC_OPTS);
  const record = parseShowBlocks(stdout)[0];
  if (!record || record.Id !== unit) {
    throw new Error(`Сервис ${unit} не найден`);
  }
  if (!isControllable(unit, record.FragmentPath ?? '')) {
    throw new Error(
      `Сервисом ${unit} нельзя управлять из панели: это системный или защищённый юнит ` +
        '(остановив его, вы потеряете доступ к самой панели).',
    );
  }
}

export type ServiceAction = 'start' | 'stop' | 'restart' | 'enable' | 'disable';

export async function controlService(unit: string, action: ServiceAction) {
  if (IS_DARWIN) return darwinControlService(unit, action);
  await assertControllable(unit);
  try {
    await run('sudo', ['-n', '/usr/bin/systemctl', action, unit], EXEC_OPTS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password is required|sudo:/i.test(message)) {
      throw new Error(
        'Нет прав на управление сервисами. Нужен sudoers-файл для этого пользователя — ' +
          'инструкция в SERVER-PANEL-SETUP.md.',
      );
    }
    throw new Error(`Не удалось выполнить ${action} для ${unit}: ${message}`);
  }
  // systemd отвечает мгновенно, а сервису нужно мгновение, чтобы подняться.
  // enable/disable правят только файл автозапуска — ждать там нечего.
  if (action !== 'enable' && action !== 'disable') {
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  const { stdout } = await run(
    'systemctl',
    ['show', unit, '--property=Id,Description,ActiveState,SubState,UnitFileState,MemoryCurrent,MainPID,NRestarts,FragmentPath,ExecMainStartTimestamp,ExecMainStartTimestampMonotonic'],
    EXEC_OPTS,
  );
  const record = parseShowBlocks(stdout)[0] ?? {};
  return {
    unit,
    action,
    state: record.ActiveState ?? 'unknown',
    sub: record.SubState ?? '',
    enabled: record.UnitFileState ?? 'unknown',
    health: classifyHealth(record, toNum(record.NRestarts) ?? 0),
  };
}

// -------------------------------------------------------------------- logs

export type LogLevel = 'error' | 'warn' | 'info' | 'system';
export type LogLine = { ts: string; level: LogLevel; text: string };

const ERROR_RE = /error|traceback|exception|failed|fatal|critical|panic|refused|denied|unauthorized/i;
const WARN_RE = /warn|deprecat|retry|timeout|slow/i;

/**
 * Разбирает строку `journalctl -o short-iso`. Exported for tests.
 *
 * Отделяет служебные сообщения systemd от вывода самого процесса: у бота с
 * тысячей перезапусков 90% журнала — это «Scheduled restart job, restart
 * counter is at N», и если их не пометить, настоящая ошибка тонет в шуме.
 */
export function parseJournalLine(line: string): LogLine {
  const match = /^(\S+)\s+\S+\s+([^\s:[]+)(?:\[(\d+)\])?:\s?(.*)$/.exec(line);
  const ident = match?.[2] ?? '';
  const text = match?.[4] ?? line;
  if (ident === 'systemd') return { ts: match?.[1] ?? '', level: 'system', text };
  return {
    ts: match?.[1] ?? '',
    level: ERROR_RE.test(text) ? 'error' : WARN_RE.test(text) ? 'warn' : 'info',
    text,
  };
}

/**
 * Куда сервис пишет свой вывод. Exported for tests.
 *
 * `StandardOutput=append:/path` — обычная схема Диминых ботов: в журнале у них
 * пусто, весь лог в файле. Без этого вкладка «Логи» для половины сервисов
 * показывала бы «записей нет», хотя лог есть.
 */
export function parseLogFilePath(unitFileText: string): string | null {
  const match = /^\s*Standard(?:Output|Error)\s*=\s*(?:append|file|truncate):(.+?)\s*$/im.exec(unitFileText);
  return match ? match[1] : null;
}

async function logFilePath(unit: string): Promise<string | null> {
  const { stdout } = await safeRun('systemctl', ['cat', unit]);
  return parseLogFilePath(stdout);
}

/** Хвост текстового файла без чтения его целиком: лог бота бывает на гигабайт. */
async function tailFile(path: string, maxLines: number): Promise<string[]> {
  const handle = await fs.open(path, 'r');
  try {
    const { size } = await handle.stat();
    const window = Math.min(size, 512 * 1024);
    const buffer = Buffer.alloc(window);
    await handle.read(buffer, 0, window, size - window);
    const chunk = buffer.toString('utf8');
    // Первая строка обрезана посередине — выбрасываем, чтобы не показывать огрызок.
    const all = chunk.split('\n').slice(size > window ? 1 : 0).filter(Boolean);
    return all.slice(-maxLines);
  } finally {
    await handle.close();
  }
}

export async function getLogs(
  unit: string,
  { lines = 200, level = 'info' as Exclude<LogLevel, 'system'>, system = true } = {},
): Promise<{ unit: string; lines: LogLine[]; source: 'journal' | 'file'; path?: string; note?: string }> {
  if (IS_DARWIN) return darwinGetLogs(unit, { lines, level });
  if (!UNIT_RE.test(unit)) throw new Error('Некорректное имя сервиса');
  const safeLines = Math.min(Math.max(Number(lines) || 200, 20), 2000);

  // Приоритет журнала (-p) намеренно не используем: боты пишут всё в stdout с
  // уровнем info, и `-p 3` у них не находил ни одной ошибки, хотя журнал полон
  // трассировок. Уровень определяем по тексту — тогда «Только ошибки» работает.
  let stdout = '';
  try {
    ({ stdout } = await run(
      'journalctl',
      ['-u', unit, '-n', String(Math.min(safeLines * 3, 4000)), '-o', 'short-iso', '--no-pager', '-q'],
      EXEC_OPTS,
    ));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Не удалось прочитать логи ${unit}: ${message}`);
  }

  const journal = stdout.split('\n').filter(Boolean).map(parseJournalLine);
  const fromProcess = journal.filter((line) => line.level !== 'system');

  let all = journal;
  let source: 'journal' | 'file' = 'journal';
  let path: string | undefined;
  let note: string | undefined;

  // Процесс молчит в журнале — ищем его собственный лог-файл, он указан в юните.
  if (fromProcess.length === 0) {
    const file = await logFilePath(unit).catch(() => null);
    if (file) {
      try {
        const tail = await tailFile(file, safeLines);
        all = [...tail.map((text) => ({ ts: '', level: ERROR_RE.test(text) ? 'error' : WARN_RE.test(text) ? 'warn' : 'info', text }) as LogLine), ...journal];
        source = 'file';
        path = file;
        note = `Сервис пишет не в системный журнал, а в свой файл — показываю ${file}`;
      } catch {
        note = `Сервис пишет в файл ${file}, но панель не смогла его прочитать (нет прав или файла нет).`;
      }
    }
  }

  const filtered = all.filter((line) => {
    if (line.level === 'system') return system;
    if (level === 'error') return line.level === 'error';
    if (level === 'warn') return line.level === 'error' || line.level === 'warn';
    return true;
  });

  // Пустой ответ читается двояко: либо нет прав на чужой журнал, либо сервис
  // просто ничего не пишет. Спрашиваем журнал целиком и по ответу понимаем,
  // какой это случай — иначе подсказка гонит чинить давно выданные права.
  if (!note && journal.length === 0) {
    const journalReadable = await run('journalctl', ['-n', '1', '--no-pager', '-q'], EXEC_OPTS)
      .then(({ stdout: probe }) => probe.trim().length > 0)
      .catch(() => false);
    note = journalReadable
      ? 'Этот сервис ничего не пишет в системный журнал и своего лог-файла не указал.'
      : 'Записей нет, и системный журнал недоступен: у пользователя панели не хватает прав ' +
        '(нужны группы adm и systemd-journal, см. SERVER-PANEL-SETUP.md).';
  }

  return { unit, lines: filtered.slice(-safeLines), source, path, note };
}

// --------------------------------------------------------------- диагностика

// `transient` — авария, которая рассасывается сама (лимит, сеть, занятая база).
// Всё остальное без человека не оживёт, сколько ни жми «Перезапустить», и панель
// обязана сказать это прямо: иначе бот копит по 20 000 бессмысленных рестартов.
type Rule = { re: RegExp; reason: string; advice: string; transient?: boolean };

// Причины, реально встреченные на этой машине и в прошлых авариях. Порядок
// важен: первое совпадение выигрывает, поэтому конкретное — выше общего.
const RULES: Rule[] = [
  {
    re: /AuthKeyDuplicatedError|authorization key .* two different IP/i,
    reason: 'Telegram отозвал сессию: один и тот же файл сессии работал с двух машин сразу.',
    advice: 'Нужен новый вход: удалить .session этого бота и залогиниться заново — и держать его только на одной машине.',
  },
  {
    re: /TelegramUnauthorizedError|Unauthorized.*bot|bot.*Unauthorized|401.*Unauthorized/i,
    reason: 'Telegram не принимает токен бота — токен отозван или неверный.',
    advice: 'Взять новый токен у @BotFather и вписать его в .env сервиса.',
  },
  {
    re: /Conflict: terminated by other getUpdates/i,
    reason: 'Тот же бот запущен ещё где-то — два процесса тянут одни и те же сообщения.',
    advice: 'Оставить один экземпляр: погасить копию на другой машине.',
  },
  {
    re: /FloodWaitError|Too Many Requests|429/i,
    reason: 'Внешний сервис временно ограничил частоту запросов.',
    advice: 'Подождать и снизить частоту — перезапуск здесь не поможет.',
    transient: true,
  },
  {
    re: /ModuleNotFoundError: No module named ['"]([^'"]+)['"]/i,
    reason: 'Не хватает библиотеки Python — $1.',
    advice: 'Установить её в окружение сервиса: pip install $1.',
  },
  {
    re: /Cannot find module ['"]([^'"]+)['"]/i,
    reason: 'Не хватает пакета Node — $1.',
    advice: 'Выполнить npm install в папке сервиса.',
  },
  {
    re: /EADDRINUSE|Address already in use/i,
    reason: 'Порт уже занят другим процессом.',
    advice: 'Найти, кто держит порт (вкладка «Что установлено» → открытые порты), и погасить лишнее.',
  },
  {
    re: /out of memory|oom-kill|Killed process/i,
    reason: 'Съел всю память, и ядро убило процесс.',
    advice: 'Ограничить аппетит сервиса или добавить памяти — перезапуск даст тот же результат.',
  },
  {
    re: /ECONNREFUSED|Connection refused/i,
    reason: 'Не достучался до другого сервиса — тот не отвечает на своём порту.',
    advice: 'Проверить, поднят ли сервис, к которому он ходит (база, API, туннель).',
    transient: true,
  },
  {
    re: /ENOTFOUND|getaddrinfo|Temporary failure in name resolution/i,
    reason: 'Не резолвится домен — нет сети или DNS.',
    advice: 'Проверить сеть машины и адрес, к которому он обращается.',
    transient: true,
  },
  {
    re: /EACCES|Permission denied/i,
    reason: 'Не хватает прав на файл или папку.',
    advice: 'Проверить владельца файлов сервиса и пользователя, под которым он запущен.',
  },
  {
    re: /ENOENT|No such file or directory/i,
    reason: 'Не найден файл или папка, которые он ждёт.',
    advice: 'Проверить пути в юните и на месте ли рабочая папка сервиса.',
  },
  {
    re: /database is locked|SQLITE_BUSY/i,
    reason: 'База данных занята другим процессом.',
    advice: 'Убедиться, что базу не держит вторая копия сервиса.',
    transient: true,
  },
  {
    re: /invalid.?(api.?)?key|API key|Forbidden|403/i,
    reason: 'Внешний сервис не принимает ключ доступа.',
    advice: 'Проверить, не протух ли ключ в .env сервиса.',
  },
  {
    re: /EOFError|EOF when reading a line|stdin is not a tty/i,
    reason: 'Сервис ждёт ввода с клавиатуры — например код подтверждения, а вводить его некому.',
    advice: 'Запустить его руками в терминале один раз, пройти вход, и только потом включать сервисом.',
  },
  {
    re: /Traceback|SyntaxError|TypeError|ValueError|KeyError|ReferenceError/i,
    reason: 'Ошибка в коде сервиса — он падает на старте.',
    advice: 'Смотреть трассировку ниже: она показывает файл и строку.',
  },
];

/**
 * Переводит последнюю ошибку в человеческую причину. Exported for tests.
 *
 * Никаких моделей: обычные правила по тексту. Панель должна отвечать мгновенно
 * и одинаково — а не сочинять каждый раз новое объяснение.
 */
export function explainFailure(
  text: string,
  { result, exitCode }: { result?: string; exitCode?: number | null } = {},
): { reason: string; advice: string; needsHuman: boolean } | null {
  for (const rule of RULES) {
    const match = rule.re.exec(text);
    if (match) {
      const fill = (template: string) => template.replace(/\$1/g, match[1] ?? '');
      return { reason: fill(rule.reason), advice: fill(rule.advice), needsHuman: !rule.transient };
    }
  }
  if (result === 'oom-kill') {
    return {
      reason: 'Съел всю память, и ядро убило процесс.',
      advice: 'Ограничить аппетит сервиса или добавить памяти.',
      needsHuman: true,
    };
  }
  if (result === 'timeout') {
    return {
      reason: 'Не уложился в отведённое время запуска.',
      advice: 'Увеличить TimeoutStartSec в юните или разобраться, что он так долго делает на старте.',
      needsHuman: true,
    };
  }
  if (exitCode === 203) {
    return {
      reason: 'Программа не запустилась: неверный путь в ExecStart.',
      advice: 'Проверить, существует ли файл, указанный в юните, и исполняемый ли он.',
      needsHuman: true,
    };
  }
  if (exitCode === 127) {
    return {
      reason: 'Команда не найдена.',
      advice: 'Проверить путь к интерпретатору в ExecStart.',
      needsHuman: true,
    };
  }
  return null;
}

export type Diagnosis = {
  unit: string;
  enabled: string;
  result: string | null;
  exitCode: number | null;
  restarts: number;
  restartSec: string | null;
  execStart: string | null;
  logPath: string | null;
  lastError: string | null;
  reason: string | null;
  advice: string | null;
  /** Правило знает: сам не поднимется, нужен человек (новый вход, токен, код). */
  needsHuman: boolean;
};

/** «Почему упал» одним запросом: состояние юнита + последняя ошибка + разбор. */
export async function diagnose(unit: string): Promise<Diagnosis> {
  if (IS_DARWIN) return darwinDiagnose(unit);
  if (!UNIT_RE.test(unit)) throw new Error('Некорректное имя сервиса');

  const [showRaw, logs] = await Promise.all([
    safeRun('systemctl', [
      'show',
      unit,
      '--property=Id,UnitFileState,Result,ExecMainStatus,NRestarts,RestartUSec,ExecStart',
    ]),
    getLogs(unit, { lines: 400, level: 'info', system: false }).catch(() => null),
  ]);

  const record = parseShowBlocks(showRaw.stdout)[0] ?? {};
  const exitCode = toNum(record.ExecMainStatus);
  const errorLines = (logs?.lines ?? []).filter((line) => line.level === 'error');
  // Трассировка Python: последние строки перед падением информативнее первой.
  const lastError = errorLines.length > 0 ? errorLines[errorLines.length - 1].text : null;
  // Ищем причину по всему хвосту, а не только по последней строке: настоящая
  // ошибка часто на строку выше, чем финальное «Failed with result».
  const haystack = (logs?.lines ?? []).slice(-60).map((line) => line.text).join('\n');
  const explained = explainFailure(haystack, { result: record.Result, exitCode });

  return {
    unit,
    enabled: record.UnitFileState ?? 'unknown',
    result: record.Result ?? null,
    exitCode,
    restarts: toNum(record.NRestarts) ?? 0,
    restartSec: /RestartUSec=(.+)/.exec(showRaw.stdout)?.[1]?.trim() ?? null,
    execStart: /path=([^\s;]+)\s*;\s*argv\[\]=([^;]+);/.exec(record.ExecStart ?? '')?.[2]?.trim() ?? null,
    logPath: logs?.path ?? null,
    lastError,
    reason: explained?.reason ?? null,
    advice: explained?.advice ?? null,
    needsHuman: explained?.needsHuman ?? false,
  };
}

export type ErrorGroup = { source: string; text: string; count: number; lastTs: string };

/**
 * Схлопывает повторы одной и той же ошибки. Exported for tests.
 *
 * Падающий бот за сутки пишет одну строку тысячу раз. Списком это нечитаемо —
 * человеку нужно «вот эта ошибка, 840 раз», а не 840 одинаковых строк.
 */
export function groupErrors(lines: Array<{ ts: string; source: string; text: string }>): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  for (const line of lines) {
    // Числа, адреса и id меняются от повтора к повтору — по ним не группируем.
    const shape = line.text
      .replace(/0x[0-9a-f]+/gi, '#')
      .replace(/\b[0-9a-f]{8,}\b/gi, '#')
      .replace(/\d+/g, '#')
      .slice(0, 200);
    const key = `${line.source}|${shape}`;
    const found = groups.get(key);
    if (found) {
      found.count += 1;
      if (line.ts > found.lastTs) {
        found.lastTs = line.ts;
        found.text = line.text;
      }
    } else {
      groups.set(key, { source: line.source, text: line.text, count: 1, lastTs: line.ts });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.lastTs.localeCompare(a.lastTs));
}

/** Последние ошибки по всем сервисам сразу — «что сломалось» одним взглядом. */
export async function getRecentErrors(hours = 24, limit = 400) {
  if (IS_DARWIN) return darwinRecentErrors(hours, limit);
  const safeHours = Math.min(Math.max(Number(hours) || 24, 1), 168);
  try {
    const { stdout } = await run(
      'journalctl',
      ['-p', '3', '--since', `-${safeHours}h`, '-o', 'short-iso', '--no-pager', '-q', '-n', String(limit)],
      EXEC_OPTS,
    );
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const match = /^(\S+)\s+\S+\s+(\S+?)(?:\[\d+\])?:\s?(.*)$/.exec(line);
        return {
          ts: match?.[1] ?? '',
          source: match?.[2] ?? '',
          text: match?.[3] ?? line,
        };
      });
    return { hours: safeHours, total: lines.length, groups: groupErrors(lines) };
  } catch {
    return { hours: safeHours, total: 0, groups: [] as ErrorGroup[] };
  }
}

// --------------------------------------------------------------- inventory

/**
 * Запускает команду и не падает, если её нет или прав не хватило.
 * `ok` отличает «команда отработала и вернула пусто» от «команда не смогла» —
 * без этого пустой docker ps выглядит как «контейнеров нет», хотя на деле
 * пользователю просто отказали в доступе к сокету.
 */
async function safeRun(cmd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  try {
    const { stdout } = await run(cmd, args, EXEC_OPTS);
    return { ok: true, stdout: stdout.trim() };
  } catch (error) {
    // du и ps отдают ненулевой код из-за пары недоступных папок, но всё
    // остальное уже посчитали — этот вывод терять жалко.
    const partial = (error as { stdout?: string })?.stdout;
    return { ok: false, stdout: typeof partial === 'string' ? partial.trim() : '' };
  }
}

export async function getInventory() {
  if (IS_DARWIN) return darwinInventory();
  const [docker, listen, node, python, psql, dockerVersion, top, opt] = await Promise.all([
    safeRun('docker', ['ps', '--format', '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}']),
    safeRun('ss', ['-tlnpH']),
    safeRun('node', ['--version']),
    safeRun('python3', ['--version']),
    safeRun('psql', ['--version']),
    safeRun('docker', ['--version']),
    safeRun('ps', ['-eo', 'pid,comm,pcpu,rss', '--sort=-rss']),
    // без -s: GNU du отказывается совмещать summarize с --max-depth
    safeRun('du', ['-BM', '--max-depth=1', '/opt']),
  ]);

  const listenRaw = listen.stdout;
  const topRaw = top.stdout;
  const optRaw = opt.stdout;

  const containers = docker.stdout
    ? docker.stdout.split('\n').map((line) => {
        const [name, image, status, ports] = line.split('\t');
        return { name, image, status, ports: ports || '' };
      })
    : [];

  const ports = listenRaw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const cols = line.trim().split(/\s+/);
      const addr = cols[3] ?? '';
      const proc = /users:\(\("([^"]+)"/.exec(line)?.[1] ?? '';
      return { addr, proc };
    })
    .filter((entry) => entry.addr)
    .sort((a, b) => a.addr.localeCompare(b.addr));

  const topProcesses = topRaw
    .split('\n')
    .slice(1, 13)
    .map((line) => {
      const cols = line.trim().split(/\s+/);
      return {
        pid: Number(cols[0]),
        name: cols[1] ?? '',
        cpu: Number(cols[2]),
        rssBytes: Number(cols[3]) * 1024,
      };
    })
    .filter((entry) => entry.pid);

  const folders = optRaw
    .split('\n')
    .map((line) => {
      const [size, path] = line.split('\t');
      return { path, sizeMb: Number(String(size).replace('M', '')) };
    })
    .filter((entry) => entry.path && entry.path !== '/opt')
    .sort((a, b) => b.sizeMb - a.sizeMb)
    .slice(0, 15);

  return {
    containers,
    // Установлен — ещё не значит доступен: без группы docker сокет закрыт.
    dockerInstalled: Boolean(dockerVersion.stdout),
    dockerAvailable: docker.ok,
    ports,
    topProcesses,
    folders,
    foldersAvailable: folders.length > 0,
    runtimes: {
      node: node.stdout || null,
      python: python.stdout || null,
      postgres: psql.stdout || null,
      docker: dockerVersion.stdout || null,
    },
  };
}

// ----------------------------------------------------------------- windows

// Windows-машина сама шлёт отчёт в «Пульт жизни» (/opt/pulse). Панель просто
// показывает последний отчёт — своего агента на Windows заводить не нужно.
const WINDOWS_REPORT = '/opt/pulse/data/windows.json';

export async function getWindows() {
  try {
    const raw = await readText(WINDOWS_REPORT);
    const report = JSON.parse(raw) as Record<string, unknown> & { ts_epoch?: number };
    const ageSec = report.ts_epoch ? Math.round(Date.now() / 1000 - report.ts_epoch) : null;
    return {
      available: true,
      // Больше 10 минут тишины — машина либо выключена, либо репортёр умер.
      stale: ageSec === null ? true : ageSec > 600,
      ageSec,
      report,
    };
  } catch {
    return { available: false, stale: true, ageSec: null, report: null };
  }
}
