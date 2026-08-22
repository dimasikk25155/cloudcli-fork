import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  Loader2,
  Rocket,
  Server,
  ShieldCheck,
} from 'lucide-react';

import { authenticatedFetch } from '../../utils/api';

// Мастер установки Neo3 на сервер клиента.
//
// Смысл вкладки: человек, который не откроет терминал, вводит адрес сервера,
// пароль root и домен — и получает работающий Neo3 по HTTPS. Три шага, потом
// живой лог, потом ссылка.
//
// Главное требование к этому экрану — не молчать. Установка идёт 5–10 минут, и
// всё это время должно быть видно, что происходит: шаг, подпись фазы, строки
// лога. Молчащий прогресс люди воспринимают как «зависло».
//
// Установку ведёт сервер, а не эта вкладка (см. vps-install.service.ts): её
// можно закрыть, уснуть телефоном, потерять связь — по возвращении мастер
// доиграет лог с начала через /api/vps/install/stream.

type StepId = 'connect' | 'preflight' | 'dns' | 'upload' | 'install' | 'verify';
type StepState = 'run' | 'ok' | 'fail' | 'skip';

type InstallEvent =
  | { type: 'step'; id: StepId; state: StepState; text: string }
  | { type: 'phase'; text: string }
  | { type: 'log'; text: string }
  | { type: 'error'; message: string; hint?: string }
  | {
      type: 'done';
      url: string;
      domain: string;
      ip: string;
      dns: 'created' | 'updated' | 'ok' | 'manual' | 'failed';
      terminal: boolean;
      httpsReady: boolean;
    }
  | { type: 'end' };

type DomainCheck = { domain: string; zone: string | null; currentIps: string[]; managed: boolean; hint: string };

const STEP_ORDER: StepId[] = ['connect', 'preflight', 'dns', 'upload', 'install', 'verify'];
const STEP_TITLE: Record<StepId, string> = {
  connect: 'Подключение',
  preflight: 'Проверка сервера',
  dns: 'Домен в DNS',
  upload: 'Установщик на сервере',
  install: 'Установка',
  verify: 'Проверка по HTTPS',
};

const LOG_LIMIT = 1500;
const INPUT = 'min-h-[38px] w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary';

function StepRow({ id, state, text }: { id: StepId; state?: StepState; text?: string }) {
  const icon =
    state === 'ok' ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
    ) : state === 'fail' ? (
      <AlertTriangle className="h-4 w-4 text-red-500" />
    ) : state === 'skip' ? (
      <AlertTriangle className="h-4 w-4 text-amber-500" />
    ) : state === 'run' ? (
      <Loader2 className="h-4 w-4 animate-spin text-primary" />
    ) : (
      <span className="h-4 w-4 rounded-full border border-border" />
    );
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="mt-0.5 flex-shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className={state ? 'text-foreground' : 'text-muted-foreground'}>{STEP_TITLE[id]}</span>
        {text && <span className="ml-1.5 text-muted-foreground">— {text}</span>}
      </span>
    </div>
  );
}

export default function InstallTab() {
  const [wizardStep, setWizardStep] = useState(1);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [authMode, setAuthMode] = useState<'password' | 'key'>('password');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [domain, setDomain] = useState('');
  const [enableTerminal, setEnableTerminal] = useState(false);
  const [domainCheck, setDomainCheck] = useState<DomainCheck | null>(null);

  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Partial<Record<StepId, { state: StepState; text: string }>>>({});
  const [phase, setPhase] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<Extract<InstallEvent, { type: 'done' }> | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const logRef = useRef<HTMLDivElement | null>(null);
  const attached = useRef(false);

  // Автопрокрутка, но не силой: если человек отлистал лог вверх читать ошибку,
  // новые строки не должны утаскивать его обратно вниз.
  useEffect(() => {
    const box = logRef.current;
    if (!box) return;
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 120) box.scrollTop = box.scrollHeight;
  }, [log]);

  const apply = useCallback((event: InstallEvent) => {
    if (event.type === 'step') {
      setSteps((prev) => ({ ...prev, [event.id]: { state: event.state, text: event.text } }));
    } else if (event.type === 'phase') {
      setPhase(event.text);
    } else if (event.type === 'log') {
      setLog((prev) => (prev.length > LOG_LIMIT ? [...prev.slice(-LOG_LIMIT), event.text] : [...prev, event.text]));
    } else if (event.type === 'done') {
      setResult(event);
      setPhase('');
      setRunning(false);
    } else if (event.type === 'error') {
      setError({ message: event.message, hint: event.hint });
      setPhase('');
      setRunning(false);
    }
  }, []);

  /** Читает SSE-поток установки. Повтор с начала — это норма: сервер отдаёт весь буфер. */
  const consume = useCallback(
    async (response: Response) => {
      setSteps({});
      setLog([]);
      setResult(null);
      setError(null);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Браузер не отдал поток установки');
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;
      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          const line = block.split('\n').find((entry) => entry.startsWith('data: '));
          if (!line) continue; // ": ping" — подтверждение жизни соединения
          const event = JSON.parse(line.slice(6)) as InstallEvent;
          if (event.type === 'end') finished = true;
          else apply(event);
        }
      }
      return finished;
    },
    [apply],
  );

  /**
   * Вернуться к идущей установке: телефон уснул, вкладку закрыли, связь моргнула.
   * Поток мог оборваться на середине — тогда `running` остаётся включённым, и мы
   * подцепимся заново, когда вкладка снова станет видимой.
   */
  const reattach = useCallback(async () => {
    if (attached.current) return;
    attached.current = true;
    try {
      const status = await authenticatedFetch('/api/vps/install/status').then((response) => response.json());
      if (status?.data?.run?.status !== 'running') {
        setRunning(false);
        return;
      }
      setRunning(true);
      const stream = await authenticatedFetch('/api/vps/install/stream');
      if (stream.ok) await consume(stream);
    } catch {
      // Не достучались — оставляем экран как есть: установка на сервере идёт сама.
    } finally {
      attached.current = false;
    }
  }, [consume]);

  useEffect(() => {
    void reattach();
    const onVisible = () => {
      if (!document.hidden) void reattach();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reattach]);

  // Живая проверка домена — как у конкурента «Available» у поддомена, только
  // честнее: сразу говорим, поставим ли запись сами или её ставит клиент.
  useEffect(() => {
    if (wizardStep !== 2 || !/^[a-z0-9-]+\.[a-z0-9.-]+\.[a-z]{2,}$|^[a-z0-9-]+\.[a-z]{2,}$/.test(domain)) {
      setDomainCheck(null);
      return;
    }
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ domain, ...(host ? { ip: host } : {}) });
      void authenticatedFetch(`/api/vps/install/domain-check?${params.toString()}`)
        .then((response) => response.json())
        .then((body) => setDomainCheck(body?.data ?? null))
        .catch(() => setDomainCheck(null));
    }, 600);
    return () => clearTimeout(timer);
  }, [domain, host, wizardStep]);

  const start = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    attached.current = true;
    try {
      const response = await authenticatedFetch('/api/vps/install', {
        method: 'POST',
        body: JSON.stringify({
          host: host.trim(),
          port: Number(port) || 22,
          user: 'root',
          ...(authMode === 'password' ? { password } : { privateKey, passphrase }),
          domain,
          enableTerminal,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message || 'Сервер не принял форму установки');
      }
      // Пароль дальше не нужен — в состоянии вкладки ему тоже не место.
      setPassword('');
      setPassphrase('');
      setPrivateKey('');
      await consume(response);
    } catch (streamError) {
      setError({
        message: streamError instanceof Error ? streamError.message : String(streamError),
        hint: 'Если установка уже началась, она идёт на сервере сама — вернитесь на эту вкладку через несколько минут.',
      });
      setRunning(false);
    } finally {
      attached.current = false;
    }
  }, [authMode, consume, domain, enableTerminal, host, passphrase, password, port, privateKey]);

  const copyLog = useCallback(() => {
    void navigator.clipboard?.writeText(log.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [log]);

  const canGoToDomain = host.trim().length > 0 && (authMode === 'password' ? password.length > 0 : privateKey.length > 0);
  const canStart = canGoToDomain && domain.includes('.');
  const started = running || result || error;

  // -------------------------------------------------------------- лог и итог

  if (started) {
    return (
      <div className="space-y-4">
        {result && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3.5">
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              Neo3 установлен на {result.ip || result.domain}
            </div>
            <a
              href={result.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-primary/50 bg-primary/10 px-3 py-2 text-sm font-medium text-foreground hover:bg-primary/20"
            >
              <ExternalLink className="h-4 w-4" />
              {result.url}
            </a>

            <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">Что клиенту сделать первым делом:</div>
              <div>
                1. Открыть ссылку и зарегистрироваться — <b className="text-foreground">первый вошедший становится
                администратором</b>, пароль он придумывает сам.
              </div>
              <div>
                2. Настройки → Агенты → Claude → «Войти снова» — подключить{' '}
                <b className="text-foreground">свою подписку Claude</b>. Без этого интерфейс откроется, а работать
                агент не сможет: подписка живёт на его сервере и нам не видна.
              </div>
              {!result.httpsReady && (
                <div className="text-amber-600 dark:text-amber-300">
                  Сертификат ещё выпускается — если ссылка не открылась, подождите пару минут и обновите страницу.
                </div>
              )}
              {(result.dns === 'manual' || result.dns === 'failed') && (
                <div className="text-amber-600 dark:text-amber-300">
                  DNS не наш: добавьте у регистратора A-запись {result.domain} → {result.ip}, иначе HTTPS не поднимется.
                </div>
              )}
              {result.terminal && <div>Вкладка «Терминал» оставлена включённой — у клиента есть доступ к shell.</div>}
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-3.5">
            <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span className="min-w-0">{error.message}</span>
            </div>
            {error.hint && <div className="mt-1.5 pl-6 text-xs text-muted-foreground">{error.hint}</div>}
          </div>
        )}

        <div className="rounded-xl border border-border bg-card p-3.5">
          <div className="mb-2.5 flex items-center gap-2 text-sm font-medium text-foreground">
            {running ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <Rocket className="h-4 w-4" />}
            {running ? phase || 'Ставлю Neo3' : 'Установка завершена'}
          </div>
          <div className="space-y-1.5">
            {STEP_ORDER.map((id) => (
              <StepRow key={id} id={id} state={steps[id]?.state} text={steps[id]?.text} />
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-3.5">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
            Лог установки
            <span className="text-xs font-normal text-muted-foreground">{log.length} строк</span>
            <button
              className="ml-auto flex min-h-[30px] items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={copyLog}
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? 'Скопировано' : 'Скопировать лог'}
            </button>
          </div>
          <div
            ref={logRef}
            className="max-h-80 overflow-y-auto rounded-lg bg-muted/60 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground"
          >
            {log.length === 0 ? (
              <div>Жду первых строк…</div>
            ) : (
              log.map((line, index) => (
                <div key={index} className="whitespace-pre-wrap break-all">
                  {line || ' '}
                </div>
              ))
            )}
          </div>
        </div>

        {!running && (
          <button
            className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => {
              setResult(null);
              setError(null);
              setLog([]);
              setSteps({});
              setWizardStep(1);
            }}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Поставить на другой сервер
          </button>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------- три шага

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5 text-xs">
        {['Сервер', 'Домен', 'Проверка'].map((label, index) => (
          <div key={label} className="flex items-center gap-1.5">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                wizardStep === index + 1
                  ? 'bg-primary/20 text-foreground'
                  : wizardStep > index + 1
                    ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              {index + 1}
            </span>
            <span className={wizardStep === index + 1 ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
            {index < 2 && <span className="mx-1 text-muted-foreground">→</span>}
          </div>
        ))}
      </div>

      {wizardStep === 1 && (
        <div className="rounded-xl border border-border bg-card p-3.5">
          <div className="mb-2.5 flex items-center gap-2 text-sm font-medium text-foreground">
            <Server className="h-4 w-4 text-muted-foreground" />
            Куда ставим
          </div>
          <div className="space-y-3">
            <label className="block text-xs">
              <span className="mb-1 block text-muted-foreground">IP сервера — тот, что прислал хостинг</span>
              <input
                className={INPUT}
                placeholder="203.0.113.10"
                value={host}
                onChange={(event) => setHost(event.target.value.trim())}
                autoComplete="off"
              />
            </label>

            <div className="flex gap-1.5">
              {(
                [
                  ['password', 'Пароль root'],
                  ['key', 'SSH-ключ'],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => setAuthMode(mode)}
                  className={`min-h-[32px] rounded-lg px-3 py-1 text-xs transition-colors ${
                    authMode === mode ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {authMode === 'password' ? (
              <label className="block text-xs">
                <span className="mb-1 block text-muted-foreground">Пароль root</span>
                <input
                  className={INPUT}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                />
              </label>
            ) : (
              <>
                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">
                    Приватный ключ целиком (файл id_ed25519 или id_rsa)
                  </span>
                  <textarea
                    className={`${INPUT} h-24 font-mono text-[11px]`}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    value={privateKey}
                    onChange={(event) => setPrivateKey(event.target.value)}
                  />
                </label>
                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">Пароль ключа, если он есть</span>
                  <input
                    className={INPUT}
                    type="password"
                    value={passphrase}
                    onChange={(event) => setPassphrase(event.target.value)}
                    autoComplete="new-password"
                  />
                </label>
              </>
            )}

            <details>
              <summary className="cursor-pointer list-none text-[11px] text-muted-foreground underline-offset-2 hover:underline">
                Нестандартный порт SSH
              </summary>
              <input
                className={`${INPUT} mt-1.5 max-w-32`}
                value={port}
                inputMode="numeric"
                onChange={(event) => setPort(event.target.value.replace(/\D/g, ''))}
              />
            </details>
          </div>

          <div className="mt-3 flex items-start gap-2 rounded-lg bg-muted/60 px-2.5 py-2 text-[11px] text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>
              Нужен чистый VPS с Ubuntu 22.04 или 24.04 и вход под root. Пароль никуда не сохраняется: он живёт только
              на время установки и в лог не попадает.
            </span>
          </div>

          <div className="mt-3 flex justify-end">
            <button
              disabled={!canGoToDomain}
              onClick={() => setWizardStep(2)}
              className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-primary/20 disabled:opacity-40"
            >
              Дальше
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {wizardStep === 2 && (
        <div className="rounded-xl border border-border bg-card p-3.5">
          <div className="mb-2.5 flex items-center gap-2 text-sm font-medium text-foreground">
            <Globe className="h-4 w-4 text-muted-foreground" />
            По какому адресу это откроется
          </div>

          <label className="block text-xs">
            <span className="mb-1 block text-muted-foreground">Домен или поддомен</span>
            <input
              className={INPUT}
              placeholder="client.neo3.ru"
              value={domain}
              onChange={(event) => setDomain(event.target.value.toLowerCase().replace(/\s+/g, ''))}
              onBlur={(event) =>
                setDomain(
                  event.target.value
                    .toLowerCase()
                    .replace(/^https?:\/\//, '')
                    .replace(/\/.*$/, '')
                    .replace(/\.$/, ''),
                )
              }
              autoComplete="off"
            />
          </label>

          <div className="mt-2 min-h-[32px] text-[11px]">
            {domainCheck ? (
              <div
                className={`flex items-start gap-1.5 ${
                  domainCheck.managed ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'
                }`}
              >
                {domainCheck.managed ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                )}
                <span>{domainCheck.hint}</span>
              </div>
            ) : (
              <span className="text-muted-foreground">
                Домен, который клиент будет открывать. A-запись поставлю сам, если домен в нашем Cloudflare.
              </span>
            )}
          </div>

          <label className="mt-3 flex cursor-pointer items-start gap-2 border-t border-border pt-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={enableTerminal}
              onChange={(event) => setEnableTerminal(event.target.checked)}
            />
            <span className="min-w-0 text-xs">
              <span className="block text-foreground">Оставить вкладку «Терминал»</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                Обычному клиенту она не нужна и опасна — это полный доступ к его серверу. Включайте, если ставите
                технарю.
              </span>
            </span>
          </label>

          <div className="mt-3 flex justify-between">
            <button
              onClick={() => setWizardStep(1)}
              className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Назад
            </button>
            <button
              disabled={!canStart}
              onClick={() => setWizardStep(3)}
              className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-primary/20 disabled:opacity-40"
            >
              Дальше
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {wizardStep === 3 && (
        <div className="rounded-xl border border-border bg-card p-3.5">
          <div className="mb-2.5 flex items-center gap-2 text-sm font-medium text-foreground">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            Проверьте и запускайте
          </div>

          <div className="space-y-1.5 text-xs">
            {(
              [
                ['Сервер', `${host}${port !== '22' ? `:${port}` : ''} · root`],
                ['Вход', authMode === 'password' ? 'по паролю' : 'по SSH-ключу'],
                ['Адрес', `https://${domain}`],
                ['DNS', domainCheck?.managed ? 'A-запись поставлю сам' : 'A-запись ставит владелец домена'],
                ['Терминал', enableTerminal ? 'оставляем' : 'выключен (так безопаснее)'],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex gap-2">
                <span className="w-20 flex-shrink-0 text-muted-foreground">{label}</span>
                <span className="min-w-0 break-all text-foreground">{value}</span>
              </div>
            ))}
          </div>

          <div className="mt-3 rounded-lg bg-muted/60 px-2.5 py-2 text-[11px] text-muted-foreground">
            Установка занимает 5–10 минут и меняет сервер целиком: ставит пакеты, Node, Caddy и автозапуск. Вкладку
            можно закрыть — я доведу до конца и покажу лог, когда вернётесь.
          </div>

          <div className="mt-3 flex justify-between">
            <button
              onClick={() => setWizardStep(2)}
              className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Назад
            </button>
            <button
              onClick={() => void start()}
              className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-primary/50 bg-primary/10 px-3.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-primary/20"
            >
              <Rocket className="h-4 w-4" />
              Установить Neo3
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
