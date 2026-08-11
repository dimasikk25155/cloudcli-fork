import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { appConfigDb } from '@/modules/database/index.js';

// Отчёты о других машинах (Windows, вторые VPS). Машина не может залогиниться
// по JWT, поэтому шлёт отчёт с общим токеном — как в «Пульте жизни», откуда
// эта схема и переехала.
//
// Читаем из двух мест сразу: сначала свои отчёты, потом legacy-файлы Пульса
// (/opt/pulse/data). Пока Пульс жив, данные идут оттуда; как только репортёр
// на Windows переключат на Neo3, начнут приходить свои. Момента «всё сломалось,
// потому что Пульс выключили» не существует.

const REPORTS_DIR = path.join(os.homedir(), '.cloudcli', 'vps-reports');
const LEGACY_PULSE_DIR = '/opt/pulse/data';
const TOKEN_KEY = 'vps_ingest_token';

/** Сколько машина может молчать, прежде чем это считается проблемой. */
export const STALE_AFTER_SEC = 600;

export type HostReport = {
  host: string;
  label: string;
  cpuPct: number | null;
  ramPct: number | null;
  diskPct: number | null;
  gpuPct: number | null;
  services: Array<{ name: string; up: boolean }>;
  problems: string[];
  ageSec: number | null;
  stale: boolean;
  source: 'neo3' | 'pulse';
  raw: Record<string, unknown>;
};

/** Токен для репортёров. Создаётся сам при первом обращении. */
export function getIngestToken(): string {
  let token = appConfigDb.get(TOKEN_KEY);
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    appConfigDb.set(TOKEN_KEY, token);
  }
  return token;
}

export function ingestTokenMatches(candidate: string | undefined): boolean {
  if (!candidate) return false;
  const expected = getIngestToken();
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  // Длины разные — timingSafeEqual бросает, поэтому сравниваем отдельно.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const HOST_RE = /^[a-zA-Z0-9._-]{1,64}$/;

export async function saveReport(body: Record<string, unknown>): Promise<{ host: string }> {
  const host = String(body.host ?? '').trim();
  if (!HOST_RE.test(host)) {
    throw new Error('Некорректное имя хоста в отчёте');
  }
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const stamped = { ...body, ts_epoch: Date.now() / 1000 };
  const target = path.join(REPORTS_DIR, `${host}.json`);
  const tmp = `${target}.tmp`;
  // Пишем через временный файл: читатель никогда не увидит половину отчёта.
  await fs.writeFile(tmp, JSON.stringify(stamped), 'utf8');
  await fs.rename(tmp, target);
  return { host };
}

function normalize(raw: Record<string, unknown>, source: HostReport['source']): HostReport {
  const num = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const tsEpoch = num(raw.ts_epoch);
  const ageSec = tsEpoch ? Math.max(0, Math.round(Date.now() / 1000 - tsEpoch)) : null;
  const services = Array.isArray(raw.services)
    ? (raw.services as Array<Record<string, unknown>>)
        .filter((entry) => entry && typeof entry.name === 'string')
        .map((entry) => ({ name: String(entry.name), up: Boolean(entry.up) }))
    : [];

  return {
    host: String(raw.host ?? 'unknown'),
    label: String(raw.label ?? raw.host ?? 'Машина'),
    cpuPct: num(raw.cpu_pct),
    ramPct: num(raw.ram_pct),
    diskPct: num(raw.disk_pct),
    gpuPct: num(raw.gpu_util),
    services,
    problems: Array.isArray(raw.problems) ? raw.problems.map(String) : [],
    ageSec,
    stale: ageSec === null || ageSec > STALE_AFTER_SEC,
    source,
    raw,
  };
}

async function readDir(dir: string, source: HostReport['source']): Promise<HostReport[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const reports: HostReport[] = [];
  for (const name of names) {
    // Служебные файлы Пульса начинаются с подчёркивания.
    if (!name.endsWith('.json') || name.startsWith('_')) continue;
    try {
      const raw = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as Record<string, unknown>;
      reports.push(normalize(raw, source));
    } catch {
      // Битый или недописанный файл — просто пропускаем эту машину.
    }
  }
  return reports;
}

/**
 * Все машины, кроме этой. Свой отчёт побеждает legacy: если Windows уже шлёт
 * в Neo3, устаревший файл Пульса не должен перебивать свежие данные.
 */
export async function listRemoteHosts(): Promise<HostReport[]> {
  const [own, legacy] = await Promise.all([
    readDir(REPORTS_DIR, 'neo3'),
    readDir(LEGACY_PULSE_DIR, 'pulse'),
  ]);
  const byHost = new Map<string, HostReport>();
  for (const report of legacy) byHost.set(report.host, report);
  for (const report of own) byHost.set(report.host, report);
  // Мак давно не используется — не показываем его карточку, даже если
  // в /opt/pulse ещё лежит последний отчёт с закрытой крышки.
  return [...byHost.values()]
    .filter((report) => report.host !== 'mac' && report.host !== 'vps-nl')
    .sort((a, b) => a.host.localeCompare(b.host));
}
