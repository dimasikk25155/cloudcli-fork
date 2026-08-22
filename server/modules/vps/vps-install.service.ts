import { randomUUID } from 'node:crypto';
import { promises as dns } from 'node:dns';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client, type ConnectConfig } from 'ssh2';

import { ensureARecord, type DnsStatus } from '@/modules/vps/vps-dns.service.js';
import { AppError } from '@/shared/utils.js';

// Мастер установки Neo3 на сервер клиента.
//
// Всю работу делает install.sh, который уже проверен вживую. Здесь — только
// обёртка: подключиться по ssh, положить скрипт, запустить и показать вывод в
// браузере. Смысл в том, чтобы человек, который не откроет терминал, всё равно
// получил свой сервер.
//
// Два решения, которые стоит понимать при правках:
//
// 1. Установка запускается ОТЦЕПЛЕННОЙ (setsid + лог в файл), а браузер смотрит
//    `tail -f`. Дима работает с телефона: экран гаснет, вкладка засыпает, связь
//    рвётся — установка обязана дойти до конца сама. Оборвалась только картинка,
//    а не работа.
// 2. Прогон живёт в памяти сервера, а не в запросе. Вкладку можно закрыть и
//    вернуться — лог доиграется с начала (см. /api/vps/install/stream).
//
// Пароль root не пишется ни в базу, ни в лог: он живёт в замыкании прогона и
// умирает вместе с ним.

const REMOTE_SCRIPT = '/root/neo3-install.sh';
const REMOTE_RUNNER = '/root/neo3-run.sh';
const REMOTE_LOG = '/root/neo3-install.log';

/** Метка, по которой стрим понимает, что отцепленная установка закончилась. */
export const EXIT_SENTINEL = '__NEO3_INSTALL_EXIT:';

const CONNECT_TIMEOUT_MS = 20_000;
const INSTALL_TIMEOUT_MS = 40 * 60_000;
const HTTPS_TRIES = 8;
const HTTPS_DELAY_MS = 15_000;

/** Сколько строк лога держим в памяти для повторного показа. */
const LOG_BUFFER = 2000;

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const HOSTNAME_RE = /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

export type StepId = 'connect' | 'preflight' | 'dns' | 'upload' | 'install' | 'verify';
export type StepState = 'run' | 'ok' | 'fail' | 'skip';

export type InstallEvent =
  | { type: 'step'; id: StepId; state: StepState; text: string }
  | { type: 'phase'; text: string }
  | { type: 'log'; text: string }
  | { type: 'error'; message: string; hint?: string }
  | {
      type: 'done';
      url: string;
      domain: string;
      ip: string;
      dns: DnsStatus;
      terminal: boolean;
      httpsReady: boolean;
    };

export type InstallParams = {
  host: string;
  port: number;
  user: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  domain: string;
  enableTerminal: boolean;
};

export type InstallRun = {
  id: string;
  host: string;
  domain: string;
  startedAt: number;
  finishedAt: number | null;
  status: 'running' | 'ok' | 'failed';
  events: InstallEvent[];
  listeners: Set<(event: InstallEvent) => void>;
};

// ----------------------------------------------------------------- разбор ввода

function bad(message: string): AppError {
  return new AppError(message, { code: 'VPS_INSTALL_BAD_REQUEST', statusCode: 400 });
}

export function normalizeInstallRequest(body: Record<string, unknown>): InstallParams {
  const host = String(body.host ?? '').trim();
  if (!host) throw bad('Укажите адрес сервера — IP, который прислал хостинг.');
  if (!net.isIP(host) && !HOSTNAME_RE.test(host)) {
    throw bad(`«${host}» не похож на адрес сервера. Нужен IP вида 185.199.197.210 или имя хоста.`);
  }

  const port = body.port == null || body.port === '' ? 22 : Number(body.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw bad('Порт SSH — целое число от 1 до 65535 (обычно 22).');
  }

  const user = String(body.user ?? 'root').trim() || 'root';
  if (user !== 'root') {
    throw bad(
      'Мастер ставит Neo3 только от root: install.sh ставит пакеты, Caddy и systemd-юнит. ' +
        'Зайдите под root или попросите у хостинга root-доступ.',
    );
  }

  const password = String(body.password ?? '').trim() || undefined;
  const privateKey = String(body.privateKey ?? '').trim() || undefined;
  if (!password && !privateKey) {
    throw bad('Нужен пароль root или приватный SSH-ключ — иначе на сервер не зайти.');
  }
  if (privateKey && !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(privateKey)) {
    throw bad('Это не похоже на приватный ключ: он начинается со строки «-----BEGIN ... PRIVATE KEY-----».');
  }

  const domain = String(body.domain ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
  if (!DOMAIN_RE.test(domain)) {
    throw bad(`«${domain || 'домен'}» не похож на домен. Нужно вида client.neo3.ru — без http:// и без слэшей.`);
  }

  return {
    host,
    port,
    user,
    password,
    privateKey,
    passphrase: String(body.passphrase ?? '').trim() || undefined,
    domain,
    enableTerminal: Boolean(body.enableTerminal),
  };
}

// ------------------------------------------------------------------ мелкие помощники

/** Одинарные кавычки для bash: домен уже проверен регуляркой, но правило есть правило. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Из текста лога убираем всё, что похоже на пароль: он не должен утечь в буфер. */
export function scrubSecrets(text: string, secrets: Array<string | undefined>): string {
  let result = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) result = result.split(secret).join('***');
  }
  return result;
}

export function parseExitSentinel(line: string): number | null {
  const match = line.match(new RegExp(`${EXIT_SENTINEL}(\\d+)`));
  return match ? Number(match[1]) : null;
}

/**
 * `==> npm install` из install.sh → человеческая подпись текущего шага.
 * Ровно то, чего не хватало: пять минут тишины превращаются в понятный прогресс.
 */
export function phaseLabel(line: string): string | null {
  const match = line.match(/^==>\s*(.+?)\s*$/);
  if (!match) return null;
  const raw = match[1].toLowerCase();
  const table: Array<[string, string]> = [
    ['base packages', 'Базовые пакеты'],
    ['node 22', 'Node 22'],
    ['claude code engine', 'Движок Claude Code'],
    ['caddy reverse proxy', 'Домен и HTTPS-сертификат'],
    ['caddy', 'Веб-сервер Caddy'],
    ['cloudcli user', 'Пользователь приложения'],
    ['npm install', 'Установка зависимостей — самый долгий шаг, 3–6 минут'],
    ['npm run build', 'Сборка интерфейса'],
    ['.env', 'Настройки'],
    ['workspace folder', 'Рабочая папка'],
    ['project memory', 'Память проекта'],
    ['systemd service', 'Автозапуск'],
  ];
  for (const [needle, label] of table) {
    if (raw.startsWith(needle)) return label;
  }
  return match[1];
}

/** Понятная причина вместо стектрейса ssh2. */
export function humanizeSshError(error: unknown, params: { host: string; port: number }): string {
  const text = error instanceof Error ? error.message : String(error);
  const where = `${params.host}:${params.port}`;
  if (/All configured authentication methods failed/i.test(text)) {
    return `Сервер ${where} не принял пароль или ключ. Проверьте пароль root (или что ключ добавлен на сервер).`;
  }
  if (/Cannot parse privateKey|Unsupported key format|bad passphrase|Encrypted private OpenSSH key/i.test(text)) {
    return 'Не смог прочитать приватный ключ. Нужен полный текст файла id_rsa/id_ed25519; если ключ с паролем — укажите его.';
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(text)) {
    return `Адрес ${params.host} не находится в DNS. Проверьте, что вписали IP сервера без опечатки.`;
  }
  if (/ECONNREFUSED/i.test(text)) {
    return `Сервер ${where} отказал в подключении: SSH там не слушает этот порт (или его закрыл файрвол).`;
  }
  if (/ETIMEDOUT|Timed out while waiting for handshake|EHOSTUNREACH|ENETUNREACH/i.test(text)) {
    return `Сервер ${where} не отвечает. Он включён? Порт SSH открыт наружу?`;
  }
  if (/ECONNRESET|Connection lost/i.test(text)) {
    return `Связь с ${where} оборвалась. Сама установка на сервере при этом продолжается — откройте страницу через несколько минут.`;
  }
  return text;
}

/** Адреса самой этой машины: ставить Neo3 поверх себя — верный способ убить панель. */
export async function isSelfTarget(host: string): Promise<boolean> {
  const local = new Set<string>(['127.0.0.1', '::1', '0.0.0.0']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const entry of list ?? []) local.add(entry.address);
  }
  const candidates = net.isIP(host) ? [host] : await dns.resolve4(host).catch(() => [] as string[]);
  return candidates.some((ip) => local.has(ip) || ip.startsWith('127.'));
}

/** install.sh лежит в корне репозитория — ищем вверх, чтобы работало и из dist-server. */
export async function findInstallScript(): Promise<string> {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 7; depth += 1) {
    const candidate = path.join(dir, 'install.sh');
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      dir = path.dirname(dir);
    }
  }
  throw new AppError('Не нашёл install.sh рядом с приложением — установка невозможна.', {
    code: 'VPS_INSTALL_NO_SCRIPT',
    statusCode: 500,
  });
}

/**
 * Скрипт-запускалка на стороне клиента. Отдельным файлом, а не однострочником в
 * ssh: так вывод целиком уходит в лог, а код возврата — в метку, и всё это
 * переживает обрыв соединения.
 */
export function buildRunnerScript(domain: string, enableTerminal: boolean): string {
  const args = [shellQuote(domain), '--clone', enableTerminal ? '--enable-terminal' : ''].filter(Boolean).join(' ');
  return [
    '#!/bin/bash',
    `bash ${REMOTE_SCRIPT} ${args} > ${REMOTE_LOG} 2>&1`,
    `echo "${EXIT_SENTINEL}$?" >> ${REMOTE_LOG}`,
    '',
  ].join('\n');
}

export function buildStreamCommand(): string {
  // Установка отцепляется от ssh-сессии, поэтому обрыв связи её не убивает.
  return `rm -f ${REMOTE_LOG}; setsid bash ${REMOTE_RUNNER} </dev/null >/dev/null 2>&1 & sleep 1; tail -n +1 -f ${REMOTE_LOG}`;
}

// ------------------------------------------------------------------ ssh

function connect(params: InstallParams): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const config: ConnectConfig = {
      host: params.host,
      port: params.port,
      username: params.user,
      readyTimeout: CONNECT_TIMEOUT_MS,
      keepaliveInterval: 15_000,
      // Свежий VPS видим впервые — ключа в known_hosts взяться неоткуда.
      // Ведём себя как `ssh -o StrictHostKeyChecking=accept-new`.
      hostVerifier: () => true,
    };
    if (params.privateKey) {
      config.privateKey = params.privateKey;
      if (params.passphrase) config.passphrase = params.passphrase;
    } else {
      config.password = params.password;
    }
    conn.once('ready', () => resolve(conn));
    conn.once('error', (error) => reject(error));
    conn.connect(config);
  });
}

function exec(conn: Client, command: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (error, stream) => {
      if (error) return reject(error);
      let out = '';
      let code = 0;
      stream.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
      stream.stderr.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
      stream.on('close', (exitCode: number | null) => {
        code = exitCode ?? 0;
        resolve({ code, out: out.trim() });
      });
    });
  });
}

function upload(conn: Client, remotePath: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.sftp((error, sftp) => {
      if (error) return reject(error);
      sftp.writeFile(remotePath, content, { mode: 0o700 }, (writeError) => {
        sftp.end();
        if (writeError) reject(writeError);
        else resolve();
      });
    });
  });
}

/** Гоняет установку и отдаёт строки лога наружу. Резолвится кодом возврата. */
function streamInstall(conn: Client, onLine: (line: string) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    conn.exec(buildStreamCommand(), (error, stream) => {
      if (error) return reject(error);
      let carry = '';
      let settled = false;
      const finish = (code: number) => {
        if (settled) return;
        settled = true;
        stream.close();
        resolve(code);
      };
      const onChunk = (chunk: Buffer) => {
        carry += chunk.toString('utf8');
        const lines = carry.split('\n');
        carry = lines.pop() ?? '';
        for (const line of lines) {
          const exitCode = parseExitSentinel(line);
          if (exitCode != null) return finish(exitCode);
          onLine(line);
        }
      };
      stream.on('data', onChunk);
      stream.stderr.on('data', onChunk);
      stream.on('close', () => {
        // Канал закрылся без метки — связь оборвалась, а установка на сервере идёт.
        if (!settled) {
          settled = true;
          reject(new Error('Connection lost'));
        }
      });
    });
  });
}

// ------------------------------------------------------------------ прогон

let current: InstallRun | null = null;

export function getCurrentRun(): InstallRun | null {
  return current;
}

export function subscribe(run: InstallRun, listener: (event: InstallEvent) => void): () => void {
  run.listeners.add(listener);
  return () => {
    run.listeners.delete(listener);
  };
}

function emit(run: InstallRun, event: InstallEvent): void {
  run.events.push(event);
  if (run.events.length > LOG_BUFFER) {
    // Шаги и итог оставляем всегда — режем только середину простыни npm install.
    const index = run.events.findIndex((entry) => entry.type === 'log');
    if (index >= 0) run.events.splice(index, 1);
  }
  for (const listener of run.listeners) {
    try {
      listener(event);
    } catch {
      // Отвалившийся слушатель (закрытая вкладка) не должен ронять установку.
    }
  }
}

async function waitForHttps(domain: string, onTry: (attempt: number) => void): Promise<boolean> {
  for (let attempt = 1; attempt <= HTTPS_TRIES; attempt += 1) {
    onTry(attempt);
    try {
      const response = await fetch(`https://${domain}/api/auth/status`, { signal: AbortSignal.timeout(10_000) });
      if (response.ok) return true;
    } catch {
      // Сертификата ещё нет или DNS не разъехался — это норма первые пару минут.
    }
    if (attempt < HTTPS_TRIES) await new Promise((resolve) => setTimeout(resolve, HTTPS_DELAY_MS));
  }
  return false;
}

async function execute(run: InstallRun, params: InstallParams): Promise<void> {
  const secrets = [params.password, params.passphrase, params.privateKey];
  const log = (text: string) => emit(run, { type: 'log', text: scrubSecrets(text, secrets) });
  const step = (id: StepId, state: StepState, text: string) => emit(run, { type: 'step', id, state, text });
  const fail = (message: string, hint?: string) => {
    // Первая причина — настоящая. Обрыв ssh, который пойдёт следом (мы сами
    // рвём соединение), не должен затирать её на экране.
    if (run.status !== 'running') return;
    run.status = 'failed';
    run.finishedAt = Date.now();
    emit(run, { type: 'error', message: scrubSecrets(message, secrets), hint });
  };

  let conn: Client | null = null;
  const timeout = setTimeout(() => {
    if (run.status === 'running') {
      fail('Установка идёт больше 40 минут — это ненормально, обрываю показ.', 'Загляните на сервер: журнал лежит в /root/neo3-install.log');
      conn?.end();
    }
  }, INSTALL_TIMEOUT_MS);

  try {
    // 1. Подключение
    step('connect', 'run', `Подключаюсь к ${params.host}:${params.port}`);
    if (await isSelfTarget(params.host)) {
      throw new AppError(
        'Это адрес того самого сервера, где Neo3 уже работает. Установка поверх себя убьёт эту панель — укажите адрес нового VPS.',
        { code: 'VPS_INSTALL_SELF', statusCode: 400 },
      );
    }
    conn = await connect(params);
    step('connect', 'ok', `Подключился к ${params.host} под ${params.user}`);

    // 2. Проверки до того, как что-то менять
    step('preflight', 'run', 'Проверяю сервер');
    const whoami = await exec(conn, 'id -u');
    if (whoami.out.trim() !== '0') {
      throw new AppError('Зашли не под root. install.sh ставит пакеты и systemd-юнит — без root он не отработает.', {
        code: 'VPS_INSTALL_NOT_ROOT',
        statusCode: 400,
      });
    }
    const osInfo = await exec(
      conn,
      '. /etc/os-release 2>/dev/null; echo "${ID:-unknown}|${VERSION_ID:-?}|${PRETTY_NAME:-?}"',
    );
    const [osId, osVersion, osPretty] = osInfo.out.split('|');
    if (osId !== 'ubuntu' || !['22.04', '24.04'].includes(osVersion)) {
      throw new AppError(
        `Нужна чистая Ubuntu 22.04 или 24.04, а на сервере ${osPretty || osId}. Пересоздайте VPS с нужным образом — это одна кнопка у хостинга.`,
        { code: 'VPS_INSTALL_BAD_OS', statusCode: 400 },
      );
    }
    const existing = await exec(conn, 'test -f /etc/systemd/system/cloudcli.service && echo present || true');
    if (existing.out.includes('present')) {
      throw new AppError(
        'На этом сервере Neo3 уже стоит. Мастер рассчитан на чистый сервер и перезаписал бы настройки — обновляйте через «Обновиться» внутри самого Neo3.',
        { code: 'VPS_INSTALL_OCCUPIED', statusCode: 400 },
      );
    }
    const ipAnswer = await exec(conn, `curl -s -4 --max-time 10 ifconfig.me || hostname -I | awk '{print $1}'`);
    const serverIp = ipAnswer.out.trim().split(/\s+/)[0] || (net.isIP(params.host) ? params.host : '');
    step('preflight', 'ok', `${osPretty || 'Ubuntu'}, внешний адрес ${serverIp || 'не определился'}`);

    // 3. DNS — ДО установки: Caddy просит сертификат сразу, и к этому моменту
    //    домен уже должен указывать на сервер, иначе Let's Encrypt уйдёт в backoff.
    step('dns', 'run', `Настраиваю DNS для ${params.domain}`);
    const dnsResult = serverIp
      ? await ensureARecord(params.domain, serverIp)
      : ({ status: 'manual', zone: null, message: 'Не смог определить внешний IP сервера — поставьте A-запись вручную.' } as const);
    step('dns', dnsResult.status === 'manual' || dnsResult.status === 'failed' ? 'skip' : 'ok', dnsResult.message);
    log(dnsResult.message);

    // 4. Заливка скрипта
    step('upload', 'run', 'Кладу установщик на сервер');
    const scriptPath = await findInstallScript();
    await upload(conn, REMOTE_SCRIPT, await fs.readFile(scriptPath, 'utf8'));
    await upload(conn, REMOTE_RUNNER, buildRunnerScript(params.domain, params.enableTerminal));
    step('upload', 'ok', 'Установщик на месте');

    // 5. Собственно установка
    step('install', 'run', 'Ставлю Neo3 — это 5–10 минут');
    const exitCode = await streamInstall(conn, (line) => {
      const phase = phaseLabel(line);
      if (phase) emit(run, { type: 'phase', text: phase });
      log(line);
    });
    if (exitCode !== 0) {
      throw new AppError(
        `Установщик остановился с ошибкой (код ${exitCode}). Последние строки лога выше — в них причина.`,
        { code: 'VPS_INSTALL_FAILED', statusCode: 500 },
      );
    }
    step('install', 'ok', 'Neo3 установлен и запущен');

    // 6. Проверка снаружи: DNS + сертификат + приложение разом
    step('verify', 'run', 'Жду, пока выпустится сертификат');
    const httpsReady = await waitForHttps(params.domain, (attempt) =>
      log(`Проверка https://${params.domain} — попытка ${attempt} из ${HTTPS_TRIES}`),
    );
    step(
      'verify',
      httpsReady ? 'ok' : 'skip',
      httpsReady
        ? `https://${params.domain} отвечает`
        : 'Сертификат ещё не выпустился — Caddy добьёт его сам, обычно за пару минут',
    );

    run.status = 'ok';
    run.finishedAt = Date.now();
    emit(run, {
      type: 'done',
      url: `https://${params.domain}`,
      domain: params.domain,
      ip: serverIp,
      dns: dnsResult.status,
      terminal: params.enableTerminal,
      httpsReady,
    });
  } catch (error) {
    const message =
      error instanceof AppError ? error.message : humanizeSshError(error, { host: params.host, port: params.port });
    fail(
      message,
      /Connection lost|оборвалась/.test(message)
        ? 'Установка на сервере продолжается сама — откройте адрес через 10 минут.'
        : undefined,
    );
  } finally {
    clearTimeout(timeout);
    conn?.end();
    if (run.status === 'running') {
      run.status = 'failed';
      run.finishedAt = Date.now();
    }
  }
}

export function startInstall(params: InstallParams): InstallRun {
  if (current?.status === 'running') {
    throw new AppError('Одна установка уже идёт. Дождитесь её окончания — параллельно ставить нельзя.', {
      code: 'VPS_INSTALL_BUSY',
      statusCode: 409,
    });
  }
  const run: InstallRun = {
    id: randomUUID(),
    host: params.host,
    domain: params.domain,
    startedAt: Date.now(),
    finishedAt: null,
    status: 'running',
    events: [],
    listeners: new Set(),
  };
  current = run;
  void execute(run, params);
  return run;
}
