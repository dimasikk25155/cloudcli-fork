/**
 * Host scheduler adapters.
 *
 * A schedule row is only a wish; the operating system is what actually wakes up
 * at 09:30. This module is the one place that knows how to turn a row into a
 * real launchd plist (macOS) or systemd user timer (Linux) and back.
 *
 * Both adapters write into a directory that NEO3_SCHEDULE_DIR can override.
 * That override is what keeps tests out of the user's real ~/Library/LaunchAgents:
 * when it is set the adapters also skip launchctl/systemctl entirely, because a
 * unit outside the standard directory is a sandbox artefact, not something the
 * OS should be told about.
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Deliberately different from the night-shift orchestrator's
// `ru.tarariev.claude-run-` prefix so the two never read each other's units.
export const SCHEDULE_LABEL_PREFIX = 'ru.tarariev.neo3-schedule-';

export function scheduleLabel(scheduleId: number): string {
  return `${SCHEDULE_LABEL_PREFIX}${scheduleId}`;
}

export function scheduleIdFromLabel(label: string): number | null {
  if (!label.startsWith(SCHEDULE_LABEL_PREFIX)) return null;
  const parsed = Number.parseInt(label.slice(SCHEDULE_LABEL_PREFIX.length), 10);
  return Number.isInteger(parsed) ? parsed : null;
}

export type ScheduleJob = {
  label: string;
  hour: number;
  minute: number;
  /** Empty = every day. Otherwise 0..6 with 0 = Sunday, matching Date#getDay(). */
  weekdays: number[];
  /** argv of the process the scheduler must run: [executable, ...args]. */
  command: string[];
  environment?: Record<string, string>;
  description?: string;
};

export interface ScheduleHost {
  readonly platform: NodeJS.Platform;
  /** Writes (or rewrites) the unit and activates it. Idempotent. */
  create(job: ScheduleJob): Promise<void>;
  /** Deactivates and deletes the unit. Missing units are not an error. */
  remove(label: string): Promise<void>;
  /** Labels this host currently has units for. */
  list(): Promise<string[]>;
}

export class ScheduleHostUnsupportedError extends Error {
  constructor(platform: NodeJS.Platform) {
    super(`Scheduling is not supported on this platform (${platform}). Supported: macOS, Linux.`);
    this.name = 'ScheduleHostUnsupportedError';
  }
}

type ExecFn = (file: string, args: string[]) => Promise<void>;

type HostOptions = {
  dir?: string;
  logDir?: string;
  exec?: ExecFn;
  /** When false the unit file is written but the OS is never told about it. */
  activate?: boolean;
};

const defaultExec: ExecFn = async (file, args) => {
  await execFileAsync(file, args);
};

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function removeIfExists(filePath: string): Promise<void> {
  await fs.rm(filePath, { force: true });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------------------------------------------------------------------------
// macOS — launchd
// ---------------------------------------------------------------------------

export function renderLaunchdPlist(job: ScheduleJob, logFile: string): string {
  const calendarEntries =
    job.weekdays.length > 0
      ? job.weekdays.map(
          (weekday) =>
            `    <dict><key>Weekday</key><integer>${weekday}</integer><key>Hour</key><integer>${job.hour}</integer><key>Minute</key><integer>${job.minute}</integer></dict>`
        )
      : [`    <dict><key>Hour</key><integer>${job.hour}</integer><key>Minute</key><integer>${job.minute}</integer></dict>`];

  const environment = job.environment ?? {};
  const environmentEntries = Object.entries(environment).map(
    ([key, value]) => `    <key>${escapeXml(key)}</key>\n    <string>${escapeXml(value)}</string>`
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(job.label)}</string>
  <key>ProgramArguments</key>
  <array>
${job.command.map((arg) => `    <string>${escapeXml(arg)}</string>`).join('\n')}
  </array>
  <key>StartCalendarInterval</key>
  <array>
${calendarEntries.join('\n')}
  </array>
  <!-- The job must fire on its calendar entry only; loading it at login (or after
       a reboot) must not trigger an unattended agent run. -->
  <key>RunAtLoad</key>
  <false/>
${environmentEntries.length > 0 ? `  <key>EnvironmentVariables</key>\n  <dict>\n${environmentEntries.join('\n')}\n  </dict>\n` : ''}  <key>StandardOutPath</key>
  <string>${escapeXml(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logFile)}</string>
</dict>
</plist>
`;
}

function createLaunchdHost(options: HostOptions): ScheduleHost {
  const dir = options.dir ?? path.join(os.homedir(), 'Library', 'LaunchAgents');
  const logDir = options.logDir ?? defaultLogDir();
  const exec = options.exec ?? defaultExec;
  const activate = options.activate ?? true;
  const domain = `gui/${typeof process.getuid === 'function' ? process.getuid() : 501}`;

  const plistPath = (label: string) => path.join(dir, `${label}.plist`);

  return {
    platform: 'darwin',

    async create(job) {
      await ensureDir(dir);
      await ensureDir(logDir);
      const file = plistPath(job.label);
      await fs.writeFile(file, renderLaunchdPlist(job, path.join(logDir, `${job.label}.log`)), 'utf8');

      if (!activate) return;

      // `bootstrap`/`bootout` is the supported pair since macOS 10.11 — `load -w`
      // still works but is deprecated and silently no-ops in some sessions.
      // Booting out first makes rewrites idempotent; a not-loaded job makes it fail,
      // which is exactly the case we ignore.
      await exec('/bin/launchctl', ['bootout', `${domain}/${job.label}`]).catch(() => {});
      await exec('/bin/launchctl', ['bootstrap', domain, file]);
    },

    async remove(label) {
      if (activate) {
        await exec('/bin/launchctl', ['bootout', `${domain}/${label}`]).catch(() => {});
      }
      await removeIfExists(plistPath(label));
    },

    async list() {
      return listLabels(dir, '.plist');
    },
  };
}

// ---------------------------------------------------------------------------
// Linux — systemd user timers
// ---------------------------------------------------------------------------

const SYSTEMD_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function renderSystemdOnCalendar(job: ScheduleJob): string {
  const time = `${String(job.hour).padStart(2, '0')}:${String(job.minute).padStart(2, '0')}:00`;
  if (job.weekdays.length === 0) {
    return `*-*-* ${time}`;
  }
  const days = job.weekdays.map((day) => SYSTEMD_WEEKDAYS[day]).join(',');
  return `${days} *-*-* ${time}`;
}

export function renderSystemdService(job: ScheduleJob, logFile: string): string {
  const environment = Object.entries(job.environment ?? {})
    .map(([key, value]) => `Environment="${key}=${value}"`)
    .join('\n');

  // Quoted argv keeps paths with spaces intact — systemd splits ExecStart on
  // whitespace otherwise.
  const execStart = job.command.map((arg) => `"${arg.replace(/"/g, '\\"')}"`).join(' ');

  return `[Unit]
Description=${job.description ?? job.label}

[Service]
Type=oneshot
${environment}${environment ? '\n' : ''}ExecStart=${execStart}
StandardOutput=append:${logFile}
StandardError=append:${logFile}
`;
}

export function renderSystemdTimer(job: ScheduleJob): string {
  return `[Unit]
Description=${job.description ?? job.label} (timer)

[Timer]
OnCalendar=${renderSystemdOnCalendar(job)}
# Run a missed occurrence once the machine is back up instead of skipping the day.
Persistent=true
Unit=${job.label}.service

[Install]
WantedBy=timers.target
`;
}

function createSystemdHost(options: HostOptions): ScheduleHost {
  const dir = options.dir ?? path.join(os.homedir(), '.config', 'systemd', 'user');
  const logDir = options.logDir ?? defaultLogDir();
  const exec = options.exec ?? defaultExec;
  const activate = options.activate ?? true;

  return {
    platform: 'linux',

    async create(job) {
      await ensureDir(dir);
      await ensureDir(logDir);
      await fs.writeFile(
        path.join(dir, `${job.label}.service`),
        renderSystemdService(job, path.join(logDir, `${job.label}.log`)),
        'utf8'
      );
      await fs.writeFile(path.join(dir, `${job.label}.timer`), renderSystemdTimer(job), 'utf8');

      if (!activate) return;

      await exec('systemctl', ['--user', 'daemon-reload']);
      await exec('systemctl', ['--user', 'enable', '--now', `${job.label}.timer`]);
    },

    async remove(label) {
      if (activate) {
        await exec('systemctl', ['--user', 'disable', '--now', `${label}.timer`]).catch(() => {});
      }
      await removeIfExists(path.join(dir, `${label}.timer`));
      await removeIfExists(path.join(dir, `${label}.service`));
      if (activate) {
        await exec('systemctl', ['--user', 'daemon-reload']).catch(() => {});
      }
    },

    async list() {
      return listLabels(dir, '.timer');
    },
  };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

async function listLabels(dir: string, suffix: string): Promise<string[]> {
  let files: string[] = [];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  return files
    .filter((file) => file.startsWith(SCHEDULE_LABEL_PREFIX) && file.endsWith(suffix))
    .map((file) => file.slice(0, -suffix.length))
    .sort();
}

function defaultLogDir(): string {
  return process.env.NEO3_SCHEDULE_LOG_DIR || path.join(os.homedir(), '.cloudcli', 'schedule-logs');
}

/** Explicit factory, so tests can build a host without touching real system paths. */
export function createScheduleHost(platform: NodeJS.Platform, options: HostOptions = {}): ScheduleHost {
  if (platform === 'darwin') return createLaunchdHost(options);
  if (platform === 'linux') return createSystemdHost(options);
  throw new ScheduleHostUnsupportedError(platform);
}

export function isScheduleHostSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'darwin' || platform === 'linux';
}

export function getScheduleHost(): ScheduleHost {
  const overriddenDir = process.env.NEO3_SCHEDULE_DIR;
  return createScheduleHost(process.platform, {
    dir: overriddenDir || undefined,
    activate: !overriddenDir,
  });
}
