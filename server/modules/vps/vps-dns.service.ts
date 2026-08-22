import { promises as dns } from 'node:dns';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Авто-DNS для мастера установки: A-запись домена клиента на IP его VPS.
//
// Зачем вообще: Caddy на свежем сервере просит сертификат у Let's Encrypt сразу
// после старта. Если A-записи ещё нет — валидация не проходит, Caddy уходит в
// backoff, и клиент видит «сайт не открывается» несколько минут после того, как
// установка отчиталась «готово». Поэтому запись создаётся ДО запуска install.sh.
//
// Токен берётся только из окружения (CF_API_TOKEN_DNS). Значений в коде нет и
// быть не может — см. скилл secrets-hygiene.

const API = 'https://api.cloudflare.com/client/v4';
const TIMEOUT_MS = 10_000;

/** Записи ставим короткими: домен только что создан, TTL по умолчанию тут вреден. */
const TTL_SEC = 60;

export type DnsStatus = 'created' | 'updated' | 'ok' | 'manual' | 'failed';

export type DnsOutcome = {
  status: DnsStatus;
  /** Зона Cloudflare, в которой нашёлся домен (null — не наш домен). */
  zone: string | null;
  /** Человеческая формулировка для лога установки. */
  message: string;
};

export type DomainCheck = {
  domain: string;
  /** Зона Cloudflare, если домен наш и токен на месте. */
  zone: string | null;
  /** Куда домен смотрит прямо сейчас (пусто — записи нет). */
  currentIps: string[];
  /** Сможем ли мы сами создать запись. */
  managed: boolean;
  hint: string;
};

type CfZone = { id: string; name: string };
type CfRecord = { id: string; name: string; content: string };

/**
 * Файл со всеми ключами Димы — запасной путь, когда systemd-юниту переменную
 * ещё не прописали. Вытаскиваем ОДИН ключ, а не грузим 200 чужих в процесс.
 */
async function readTokenFromSecretsFile(): Promise<string | null> {
  const file = process.env.NEO3_SECRETS_FILE || path.join(os.homedir(), 'Antigravity Project', '.secrets.env');
  try {
    const raw = await fs.readFile(file, 'utf8');
    const line = raw.split('\n').find((entry) => entry.startsWith('CF_API_TOKEN_DNS='));
    if (!line) return null;
    const value = line.slice('CF_API_TOKEN_DNS='.length).trim().replace(/^['"]|['"]$/g, '');
    return value || null;
  } catch {
    return null;
  }
}

export async function readCloudflareToken(): Promise<string | null> {
  const fromEnv = process.env.CF_API_TOKEN_DNS?.trim();
  if (fromEnv) return fromEnv;
  return readTokenFromSecretsFile();
}

/**
 * Какая из зон Cloudflare владеет доменом. `sub.client.neo3.ru` может подходить
 * и под `neo3.ru`, и под `client.neo3.ru` — выигрывает самая длинная (точная).
 */
export function pickZone(domain: string, zoneNames: string[]): string | null {
  const target = domain.toLowerCase().replace(/\.$/, '');
  const matches = zoneNames
    .map((zone) => zone.toLowerCase().replace(/\.$/, ''))
    .filter((zone) => target === zone || target.endsWith(`.${zone}`));
  return matches.sort((a, b) => b.length - a.length)[0] ?? null;
}

async function cf<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${url}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => null)) as
    | { success?: boolean; result?: T; errors?: Array<{ message?: string }> }
    | null;
  if (!response.ok || !body?.success) {
    const reason = body?.errors?.map((error) => error.message).filter(Boolean).join('; ');
    throw new Error(reason || `Cloudflare ответил ${response.status}`);
  }
  return body.result as T;
}

async function findZone(token: string, domain: string): Promise<CfZone | null> {
  const zones = await cf<CfZone[]>(token, '/zones?per_page=50&status=active');
  const name = pickZone(domain, zones.map((zone) => zone.name));
  return zones.find((zone) => zone.name.toLowerCase() === name) ?? null;
}

/** Куда домен смотрит по мнению публичного DNS (а не по мнению Cloudflare). */
export async function resolveIps(domain: string): Promise<string[]> {
  try {
    return await dns.resolve4(domain);
  } catch {
    return [];
  }
}

/**
 * Создать/поправить A-запись. Никогда не бросает: DNS — это удобство, а не
 * условие установки. Не смогли — мастер скажет клиенту, какую запись добавить.
 */
export async function ensureARecord(domain: string, ip: string): Promise<DnsOutcome> {
  const token = await readCloudflareToken();
  if (!token) {
    return {
      status: 'manual',
      zone: null,
      message: `Токена Cloudflare нет в окружении — добавьте A-запись сами: ${domain} → ${ip}`,
    };
  }

  try {
    const zone = await findZone(token, domain);
    if (!zone) {
      return {
        status: 'manual',
        zone: null,
        message: `${domain} не в наших зонах Cloudflare — добавьте A-запись у своего регистратора: ${domain} → ${ip}`,
      };
    }

    const records = await cf<CfRecord[]>(
      token,
      `/zones/${zone.id}/dns_records?type=A&name=${encodeURIComponent(domain)}`,
    );
    const existing = records[0];

    // proxied: false обязательно. С оранжевым облаком Cloudflare сам терминирует
    // TLS, HTTP-01 до Caddy не доходит, и сертификат не выпустится никогда.
    const payload = { type: 'A', name: domain, content: ip, ttl: TTL_SEC, proxied: false };

    if (!existing) {
      await cf(token, `/zones/${zone.id}/dns_records`, { method: 'POST', body: JSON.stringify(payload) });
      return { status: 'created', zone: zone.name, message: `A-запись создана: ${domain} → ${ip}` };
    }
    if (existing.content === ip) {
      return { status: 'ok', zone: zone.name, message: `A-запись уже на месте: ${domain} → ${ip}` };
    }
    await cf(token, `/zones/${zone.id}/dns_records/${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return {
      status: 'updated',
      zone: zone.name,
      message: `A-запись переставлена: ${domain} ${existing.content} → ${ip}`,
    };
  } catch (error) {
    return {
      status: 'failed',
      zone: null,
      message: `Cloudflare не дался (${error instanceof Error ? error.message : String(error)}). Добавьте A-запись сами: ${domain} → ${ip}`,
    };
  }
}

/** Живая проверка домена для шага мастера — аналог их «Available» у поддомена. */
export async function checkDomain(domain: string, targetIp?: string): Promise<DomainCheck> {
  const currentIps = await resolveIps(domain);
  const token = await readCloudflareToken();
  let zone: string | null = null;
  if (token) {
    try {
      zone = (await findZone(token, domain))?.name ?? null;
    } catch {
      zone = null;
    }
  }

  const managed = Boolean(zone);
  const pointsToTarget = Boolean(targetIp) && currentIps.includes(String(targetIp));
  const hint = pointsToTarget
    ? 'Домен уже смотрит на этот сервер — ничего менять не нужно.'
    : managed
      ? `Домен наш (зона ${zone}) — A-запись создам сам${currentIps.length ? `, сейчас смотрит на ${currentIps.join(', ')}` : ''}.`
      : currentIps.length
        ? `Домен не в наших зонах Cloudflare, сейчас смотрит на ${currentIps.join(', ')} — A-запись придётся поставить вручную.`
        : 'Домен не в наших зонах Cloudflare и никуда не смотрит — A-запись придётся поставить вручную.';

  return { domain, zone, currentIps, managed, hint };
}
