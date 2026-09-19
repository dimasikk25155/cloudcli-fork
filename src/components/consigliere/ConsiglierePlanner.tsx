import { useEffect, useState, type ReactNode } from 'react';
import { Check, ExternalLink, Loader2, RefreshCw, Repeat, Wallet } from 'lucide-react';

import { useWebPush } from '../../hooks/useWebPush';
import { authenticatedFetch } from '../../utils/api';
import { notifyPlannerChanged, type PlannerKind } from './plannerAttention';
import { refreshPlannerAttention, usePlannerAttention } from './usePlannerAttention';

type DesktopBridge = {
  getState: () => Promise<{ desktopNotifications?: { enabled?: boolean; lastError?: string | null } }>;
  update: (settings: { enabled: boolean }) => Promise<{ desktopNotifications?: { enabled?: boolean; lastError?: string | null } }>;
};

function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  return ((window as any).cloudcliDesktopNotifications as DesktopBridge) || null;
}

async function markDesktopPrefOn(): Promise<void> {
  const res = await authenticatedFetch('/api/settings/notification-preferences');
  const data = await res.json().catch(() => ({}));
  const prefs = data.preferences || {};
  await authenticatedFetch('/api/settings/notification-preferences', {
    method: 'PUT',
    body: JSON.stringify({
      ...prefs,
      channels: { ...prefs.channels, desktop: true },
    }),
  });
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const json = await response.json();
    return json?.error?.message || json?.error || fallback;
  } catch {
    return fallback;
  }
}

function kindLabel(kind: PlannerKind): string {
  if (kind === 'overdue') return 'просрочено';
  if (kind === 'due') return 'сегодня';
  return 'скоро';
}

function kindClass(kind: PlannerKind): string {
  if (kind === 'overdue') return 'text-rose-600 dark:text-rose-400';
  if (kind === 'due') return 'text-amber-700 dark:text-amber-300';
  return 'text-muted-foreground';
}

export default function ConsiglierePlanner() {
  const push = useWebPush();
  const desktop = desktopBridge();
  const isDesktopApp = Boolean(desktop);
  const { items, loading } = usePlannerAttention();
  const [desktopOn, setDesktopOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!desktop) return undefined;
    let live = true;
    desktop.getState().then((state) => {
      if (live) setDesktopOn(Boolean(state?.desktopNotifications?.enabled));
    }).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [desktop]);

  const pushOn = isDesktopApp ? desktopOn : push.isSubscribed;
  const showPushBanner = !pushOn && push.permission !== 'denied';

  async function enablePushes() {
    setPushBusy(true);
    setPushError(null);
    try {
      if (desktop) {
        const state = await desktop.update({ enabled: true });
        const next = Boolean(state?.desktopNotifications?.enabled);
        setDesktopOn(next);
        if (state?.desktopNotifications?.lastError) {
          setPushError(state.desktopNotifications.lastError);
        } else if (!next) {
          setPushError('Мак не включил уведомления. Проверь Системные настройки → Уведомления → Neo3.');
        } else {
          await markDesktopPrefOn().catch(() => undefined);
        }
        return;
      }
      await push.subscribe();
    } catch (err) {
      setPushError(err instanceof Error ? err.message : String(err));
    } finally {
      setPushBusy(false);
    }
  }

  async function markDone(kind: 'event' | 'sub', row: number) {
    const key = `${kind}:${row}`;
    setBusyKey(key);
    setError(null);
    try {
      const response = await authenticatedFetch('/api/sticky-push/planner/done', {
        method: 'POST',
        body: JSON.stringify({ kind, row }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, 'Не удалось отметить'));
      }
      setHidden((current) => new Set(current).add(key));
      notifyPlannerChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отметить');
    } finally {
      setBusyKey(null);
    }
  }

  const visible = items.filter((item) => !hidden.has(item.key));
  const events = visible.filter((item) => item.kind === 'event');
  const subs = visible.filter((item) => item.kind === 'sub');
  const empty = !loading && visible.length === 0;

  return (
    <div className="flex min-h-full flex-col">
      {showPushBanner && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-amber-300/50 bg-amber-50 px-4 py-3 dark:border-amber-700/40 dark:bg-amber-950/40">
          <p className="min-w-0 flex-1 text-sm text-amber-900 dark:text-amber-200">
            {isDesktopApp
              ? 'Это приложение Neo3 на маке — браузерный пуш тут не работает. Кнопка включает системные уведомления мака.'
              : 'Пуши выключены — поэтому шторка молчит. Включи один раз, дальше задачи канцелярии сами висят, пока не нажмёшь «Сделал».'}
          </p>
          <button
            type="button"
            disabled={pushBusy || (!isDesktopApp && push.permission === 'denied')}
            onClick={() => {
              void enablePushes();
            }}
            className="rounded-lg bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50"
          >
            {pushBusy ? 'Включаю…' : 'Включить пуши'}
          </button>
        </div>
      )}
      {pushOn && (
        <p className="flex-shrink-0 border-b border-border px-4 py-2 text-xs text-muted-foreground">
          {isDesktopApp
            ? 'Уведомления мака включены. Если задача всё равно не прилетает — рестарт Neo3 с панели «Сервер».'
            : 'Пуши включены. Просроченное будет висеть, пока не отметишь.'}
        </p>
      )}
      {pushError && (
        <p className="flex-shrink-0 border-b border-rose-300/40 bg-rose-50 px-4 py-2 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
          {pushError}
        </p>
      )}

      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
        <p className="text-xs text-muted-foreground">Просроченное и ближайшие три дня. Карты — на полном сайте.</p>
        <button
          type="button"
          onClick={() => {
            void refreshPlannerAttention();
          }}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Обновить
        </button>
      </div>

      {error && (
        <p className="mx-4 mt-3 rounded-lg border border-rose-300/40 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      )}

      {loading && items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center gap-2 px-4 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Смотрю ближайшие дела…
        </div>
      ) : empty ? (
        <div className="px-4 py-16 text-center text-sm text-muted-foreground">
          В ближайшие три дня чисто — ни событий, ни подписок.
        </div>
      ) : (
        <div className="space-y-5 p-4">
          <Section title="События" icon={Wallet} count={events.length}>
            {events.map((item) => (
              <Row
                key={item.key}
                title={item.title}
                detail={item.detail}
                kind={item.urgency}
                busy={busyKey === item.key}
                onDone={() => markDone('event', item.row)}
              />
            ))}
            {events.length === 0 && <Empty text="Событий в окне нет." />}
          </Section>

          <Section title="Подписки" icon={Repeat} count={subs.length}>
            {subs.map((item) => (
              <Row
                key={item.key}
                title={item.title}
                detail={item.detail}
                kind={item.urgency}
                busy={busyKey === item.key}
                onDone={() => markDone('sub', item.row)}
              />
            ))}
            {subs.length === 0 && <Empty text="Подписок в окне нет." />}
          </Section>
        </div>
      )}

      <div className="mt-auto border-t border-border px-4 py-3">
        <a
          href="https://ai.neo3.ru"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Полный сайт канцелярии
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  count,
  children,
}: {
  title: string;
  icon: typeof Wallet;
  count: number;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-foreground">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {title}
        <span className="text-xs font-normal text-muted-foreground">{count}</span>
      </div>
      <div className="rounded-xl border border-border bg-card px-3">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="py-3 text-sm text-muted-foreground">{text}</div>;
}

function Row({
  title,
  detail,
  kind,
  extra,
  busy,
  onDone,
}: {
  title: string;
  detail: string;
  kind: PlannerKind;
  extra?: string;
  busy: boolean;
  onDone: () => void;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-border/60 py-2.5 last:border-0">
      <button
        type="button"
        disabled={busy}
        onClick={onDone}
        title="Сделал"
        className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:border-emerald-500 hover:text-emerald-600 disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{title}</div>
        {detail && <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>}
      </div>
      <span className={`flex-shrink-0 text-xs ${kindClass(kind)}`}>
        {extra || kindLabel(kind)}
      </span>
    </div>
  );
}
