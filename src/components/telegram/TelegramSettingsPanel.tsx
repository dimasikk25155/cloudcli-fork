import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  Plug,
  PlugZap,
  RefreshCw,
  Trash2,
} from 'lucide-react';

import { authenticatedFetch } from '../../utils/api';

// Telegram binding panel. Strings are inline in Russian on purpose — the shared
// i18n bundles are owned elsewhere and this panel ships as one self-contained
// piece the orchestrator can mount wherever it wants.
//
// The panel is the whole setup path: an admin pastes a BotFather token here and
// the server stores it, so nobody has to edit .env and restart Neo3.

type TelegramBinding = {
  id: number;
  chatId: string;
  telegramUsername: string | null;
  projectPath: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type TelegramStatus = {
  configured: boolean;
  webhookSecretConfigured: boolean;
  botUsername: string | null;
  botReachable: boolean;
  botError: string | null;
  tokenSource: 'db' | 'env' | 'none';
  canManageBot: boolean;
  webhookUrl: string | null;
  webhookPending: number;
  webhookError: string | null;
  bindings: TelegramBinding[];
};

type ProjectChoice = {
  path: string;
  name: string;
};

type LinkCode = {
  code: string;
  expiresInSeconds: number;
  botUsername: string | null;
};

async function readJson(response: Response): Promise<any> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `Ошибка ${response.status}`);
  }
  return payload;
}

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, '0')}`;
}

/** The origin this page is served from — the address Telegram has to reach too. */
function currentOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

const sectionClass = 'rounded-lg border border-border/50 bg-card p-3';
const titleClass = 'mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground';
const primaryButtonClass =
  'flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const ghostButtonClass =
  'flex items-center justify-center gap-2 rounded-lg border border-border/50 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50';
const inputClass =
  'min-w-0 flex-1 rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/60';

export default function TelegramSettingsPanel() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [projects, setProjects] = useState<ProjectChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [linkCode, setLinkCode] = useState<LinkCode | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [publicUrl, setPublicUrl] = useState('');
  const [botToken, setBotToken] = useState('');

  const reload = useCallback(async () => {
    try {
      const [statusPayload, projectsPayload] = await Promise.all([
        authenticatedFetch('/api/telegram/status').then(readJson),
        authenticatedFetch('/api/telegram/projects').then(readJson),
      ]);
      setStatus({
        configured: Boolean(statusPayload.configured),
        webhookSecretConfigured: Boolean(statusPayload.webhookSecretConfigured),
        botUsername: statusPayload.botUsername ?? null,
        botReachable: Boolean(statusPayload.botReachable),
        botError: statusPayload.botError ?? null,
        tokenSource: statusPayload.tokenSource ?? 'none',
        canManageBot: Boolean(statusPayload.canManageBot),
        webhookUrl: statusPayload.webhookUrl ?? null,
        webhookPending: Number(statusPayload.webhookPending) || 0,
        webhookError: statusPayload.webhookError ?? null,
        bindings: Array.isArray(statusPayload.bindings) ? statusPayload.bindings : [],
      });
      setProjects(Array.isArray(projectsPayload.projects) ? projectsPayload.projects : []);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить статус');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Pre-fill the webhook field with whatever is already live, falling back to the
  // address the browser used to get here — that is the right answer in almost
  // every install, and typing it by hand is the part people got wrong.
  useEffect(() => {
    if (!status) return;
    setPublicUrl((previous) => {
      if (previous) return previous;
      if (status.webhookUrl) return status.webhookUrl.replace(/\/api\/telegram-webhook\/?$/, '');
      return currentOrigin();
    });
  }, [status]);

  // The code is short-lived, so the panel counts it down instead of letting the
  // user paste something the server has already forgotten.
  useEffect(() => {
    if (!linkCode) return;
    setSecondsLeft(linkCode.expiresInSeconds);
    const timer = setInterval(() => {
      setSecondsLeft((previous) => {
        if (previous <= 1) {
          clearInterval(timer);
          setLinkCode(null);
          return 0;
        }
        return previous - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [linkCode]);

  const runAction = useCallback(
    async (key: string, action: () => Promise<void>) => {
      setPending(key);
      setError(null);
      setNotice(null);
      try {
        await action();
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : 'Не получилось');
      } finally {
        setPending(null);
      }
    },
    []
  );

  const connectBot = () =>
    runAction('bot', async () => {
      const payload = await authenticatedFetch('/api/telegram/bot', {
        method: 'POST',
        body: JSON.stringify({ token: botToken.trim() }),
      }).then(readJson);
      setBotToken('');
      setNotice(
        payload.botUsername
          ? `Бот @${payload.botUsername} подключён. Осталось установить вебхук.`
          : 'Бот подключён. Осталось установить вебхук.'
      );
      await reload();
    });

  const disconnectBot = () =>
    runAction('bot-off', async () => {
      await authenticatedFetch('/api/telegram/bot', { method: 'DELETE' }).then(readJson);
      setLinkCode(null);
      setNotice('Бот отключён. Привязанные чаты остались — они оживут после подключения нового бота.');
      await reload();
    });

  const requestLinkCode = () =>
    runAction('link', async () => {
      const payload = await authenticatedFetch('/api/telegram/link-code', { method: 'POST' }).then(readJson);
      setLinkCode({
        code: payload.code,
        expiresInSeconds: Number(payload.expiresInSeconds) || 0,
        botUsername: payload.botUsername ?? null,
      });
      setCopied(false);
    });

  const unlink = (chatId: string) =>
    runAction(`unlink:${chatId}`, async () => {
      await authenticatedFetch(`/api/telegram/bindings/${encodeURIComponent(chatId)}`, {
        method: 'DELETE',
      }).then(readJson);
      setNotice('Чат отвязан.');
      await reload();
    });

  const selectProject = (chatId: string, projectPath: string) =>
    runAction(`project:${chatId}`, async () => {
      await authenticatedFetch(`/api/telegram/bindings/${encodeURIComponent(chatId)}/project`, {
        method: 'PUT',
        body: JSON.stringify({ projectPath }),
      }).then(readJson);
      setNotice('Проект чата обновлён, сессия начата заново.');
      await reload();
    });

  const installWebhook = () =>
    runAction('webhook', async () => {
      const payload = await authenticatedFetch('/api/telegram/webhook', {
        method: 'POST',
        body: JSON.stringify({ publicUrl: publicUrl.trim() }),
      }).then(readJson);
      setNotice(`Вебхук установлен: ${payload.webhookUrl}`);
      await reload();
    });

  const copyCode = async () => {
    if (!linkCode) return;
    try {
      await navigator.clipboard.writeText(`/start ${linkCode.code}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Загружаю настройки Telegram...
      </div>
    );
  }

  const botConfigured = Boolean(status?.configured);
  const botHandle = linkCode?.botUsername || status?.botUsername || null;
  const canManage = Boolean(status?.canManageBot);
  const webhookLive = Boolean(status?.webhookUrl);
  const httpsUrl = /^https:\/\//i.test(publicUrl.trim());
  const busy = pending !== null;

  return (
    <div className="space-y-4 p-4">
      {/* Title lives in the modal chrome; only the tagline and reload stay here. */}
      <header className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Пишите агенту прямо в Telegram — ответы приходят в тот же чат.
        </p>
        <button
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-accent disabled:opacity-50"
          onClick={() => void reload()}
          disabled={busy}
          aria-label="Обновить"
          title="Обновить"
        >
          <RefreshCw className="h-4 w-4 text-muted-foreground" />
        </button>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-foreground">
          {notice}
        </div>
      )}

      {/* --- 1. Bot ---------------------------------------------------------- */}
      <section className={sectionClass}>
        <h3 className={titleClass}>Шаг 1 · Бот</h3>

        {botConfigured ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${status?.botReachable ? 'bg-emerald-500' : 'bg-red-500'}`}
              />
              {botHandle ? (
                <a
                  className="flex min-w-0 items-center gap-1 truncate text-sm font-medium text-foreground hover:text-primary hover:underline"
                  href={`https://t.me/${botHandle}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  @{botHandle}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              ) : (
                <span className="text-sm text-foreground">токен задан</span>
              )}
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                {status?.botReachable ? 'на связи' : 'Telegram не отвечает'}
              </span>
            </div>

            {status?.botError && <p className="text-xs text-destructive">{status.botError}</p>}

            {canManage && status?.tokenSource === 'db' && (
              <button
                className={ghostButtonClass}
                onClick={() => void disconnectBot()}
                disabled={busy}
              >
                {pending === 'bot-off' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                Отключить бота
              </button>
            )}
            {status?.tokenSource === 'env' && (
              <p className="text-[11px] text-muted-foreground">
                Токен задан в окружении сервера — сменить его можно только там.
              </p>
            )}
          </div>
        ) : canManage ? (
          <div className="space-y-3">
            <ol className="space-y-1 text-xs text-muted-foreground">
              <li>
                1. Откройте{' '}
                <a
                  className="text-primary hover:underline"
                  href="https://t.me/BotFather"
                  target="_blank"
                  rel="noreferrer"
                >
                  @BotFather
                </a>{' '}
                и отправьте <code className="font-mono">/newbot</code>.
              </li>
              <li>2. Придумайте имя — он пришлёт токен вида 123456:AA...</li>
              <li>3. Вставьте токен сюда:</li>
            </ol>
            <div className="flex items-center gap-2">
              <input
                className={`${inputClass} font-mono`}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="123456789:AAExample-Token"
                value={botToken}
                onChange={(event) => setBotToken(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && botToken.trim() && !busy) void connectBot();
                }}
              />
              <button
                className={primaryButtonClass}
                onClick={() => void connectBot()}
                disabled={!botToken.trim() || busy}
              >
                {pending === 'bot' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
                Подключить
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Токен проверяется в Telegram и хранится на сервере. Перезапуск Neo3 не нужен.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Бот ещё не подключён. Попросите администратора Neo3 добавить токен бота.
          </p>
        )}
      </section>

      {/* --- 2. Webhook ------------------------------------------------------ */}
      <section className={sectionClass}>
        <h3 className={titleClass}>Шаг 2 · Вебхук</h3>
        <p className="mb-2 text-xs text-muted-foreground">
          Публичный HTTPS-адрес этого сервера. Telegram будет слать сюда сообщения.
        </p>

        {webhookLive && (
          <div className="mb-2 flex items-start gap-2 text-xs text-foreground">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
            <span className="min-w-0 break-all font-mono">{status?.webhookUrl}</span>
          </div>
        )}
        {status?.webhookError && (
          <p className="mb-2 text-xs text-destructive">Telegram жалуется: {status.webhookError}</p>
        )}

        <div className="flex items-center gap-2">
          <input
            className={inputClass}
            placeholder="https://neo3.example.ru"
            value={publicUrl}
            onChange={(event) => setPublicUrl(event.target.value)}
            disabled={!botConfigured}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && botConfigured && httpsUrl && !busy) void installWebhook();
            }}
          />
          <button
            className={webhookLive ? ghostButtonClass : primaryButtonClass}
            onClick={() => void installWebhook()}
            disabled={!botConfigured || !httpsUrl || busy}
          >
            {pending === 'webhook' && <Loader2 className="h-4 w-4 animate-spin" />}
            {webhookLive ? 'Обновить' : 'Установить'}
          </button>
        </div>

        {!botConfigured ? (
          <p className="mt-2 text-[11px] text-muted-foreground">Сначала подключите бота на шаге 1.</p>
        ) : !httpsUrl ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Нужен адрес на https:// — Telegram не умеет слать сообщения на http или на localhost.
          </p>
        ) : null}

        {botConfigured && !status?.webhookSecretConfigured && (
          <p className="mt-2 text-[11px] text-destructive">
            Секрет вебхука не создан — переподключите бота на шаге 1.
          </p>
        )}
      </section>

      {/* --- 3. Link a chat -------------------------------------------------- */}
      <section className={sectionClass}>
        <h3 className={titleClass}>Шаг 3 · Привязка чата</h3>
        {linkCode ? (
          <div className="space-y-2">
            <p className="text-sm text-foreground">
              Откройте {botHandle ? `@${botHandle}` : 'вашего бота'} в Telegram и отправьте:
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted/40 px-3 py-2 font-mono text-sm text-foreground">
                /start {linkCode.code}
              </code>
              <button
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/50 transition-colors hover:bg-accent"
                onClick={() => void copyCode()}
                aria-label="Скопировать команду"
                title="Скопировать команду"
              >
                {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4 text-muted-foreground" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Код действует {formatCountdown(secondsLeft)}. Одноразовый: после привязки перестаёт работать.
            </p>
            <div className="flex items-center gap-2">
              {botHandle && (
                <a
                  className={primaryButtonClass}
                  href={`https://t.me/${botHandle}?start=${linkCode.code}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="h-4 w-4" />
                  Открыть чат с ботом
                </a>
              )}
              <button className={ghostButtonClass} onClick={() => void reload()} disabled={busy}>
                Я отправил — проверить
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              className={primaryButtonClass}
              onClick={() => void requestLinkCode()}
              disabled={!botConfigured || busy}
            >
              {pending === 'link' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Привязать Telegram
            </button>
            {!botConfigured && (
              <p className="mt-2 text-[11px] text-muted-foreground">Сначала подключите бота на шаге 1.</p>
            )}
          </>
        )}
      </section>

      {/* --- 4. Linked chats ------------------------------------------------- */}
      <section className={sectionClass}>
        <h3 className={titleClass}>Привязанные чаты</h3>
        {(status?.bindings.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground/70">
            Пока ни одного чата. Привязанный чат появится здесь сразу после команды /start.
          </p>
        ) : (
          <div className="space-y-2">
            {status?.bindings.map((binding) => (
              <div key={binding.chatId} className="rounded-lg border border-border/50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {binding.telegramUsername ? `@${binding.telegramUsername}` : 'без имени'}
                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">{binding.chatId}</span>
                  </span>
                  <button
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-accent disabled:opacity-50"
                    onClick={() => void unlink(binding.chatId)}
                    disabled={busy}
                    aria-label="Отвязать чат"
                    title="Отвязать чат"
                  >
                    {pending === `unlink:${binding.chatId}` ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                </div>
                <label className="mt-2 block text-[11px] text-muted-foreground">
                  Проект по умолчанию
                  <select
                    className="mt-1 w-full rounded-lg border border-border/50 bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary/60 disabled:opacity-50"
                    value={binding.projectPath ?? ''}
                    disabled={pending === `project:${binding.chatId}`}
                    onChange={(event) => {
                      if (event.target.value) void selectProject(binding.chatId, event.target.value);
                    }}
                  >
                    <option value="">— не выбран —</option>
                    {projects.map((project) => (
                      <option key={project.path} value={project.path}>
                        {project.name} — {project.path}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
