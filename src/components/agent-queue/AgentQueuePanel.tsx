import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, ListChecks, Loader2, MessageSquare, Pause, Play, Plus, RotateCcw, Square, Trash2 } from 'lucide-react';

import { cn } from '../../lib/utils';
import { fetchAgents } from '../agents/agentsApi';
import type { AgentItem } from '../agents/agentsModel';

import { AgentQueueApiError, createQueue, deleteQueue, markItemOk, runQueueCommand, type QueueCommand } from './agentQueueApi';
import {
  attemptsLabel,
  canMarkOk,
  countsLine,
  emptyQueueForm,
  itemsFromText,
  itemStatusLabel,
  progressPercent,
  QUEUE_ATTEMPTS_MAX,
  QUEUE_PARALLEL_MAX,
  queueActions,
  queueStatusLabel,
  templateNote,
  toQueuePayload,
  validateQueueForm,
  type QueueAction,
  type QueueForm,
  type QueueFormErrors,
  type QueueFormField,
  type QueueItem,
  type QueueStatus,
  type QueueSummary,
  type QueueView,
} from './agentQueueModel';
import { useQueue, useQueues } from './useAgentQueue';

// Панель «Конвейер»: очередь пунктов, которую разбирает агент (1–3 параллельно),
// с вердиктом каждого ответа, браком и «Ещё проходом». Данные — /api/agent-queue
// (админ, мод modAgentQueue); пока панель открыта, обновляется раз в 5 с.

const INPUT = 'w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring';
const BUTTON = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50';
const PRIMARY = `${BUTTON} bg-primary text-primary-foreground hover:bg-primary/90`;
const SECONDARY = `${BUTTON} border border-border text-foreground hover:bg-accent/60`;

type View = { kind: 'list' } | { kind: 'form' } | { kind: 'detail'; id: string };

const STATUS_TONE: Record<QueueStatus, string> = {
  running: 'bg-primary/15 text-primary',
  paused: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  stopped: 'bg-muted text-muted-foreground',
  done: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
};

const ITEM_TONE: Record<QueueItem['status'], string> = {
  pending: 'text-muted-foreground',
  running: 'text-primary',
  ok: 'text-emerald-600 dark:text-emerald-400',
  rejected: 'text-destructive',
};

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function Field({ label, hint, error, children }: { label: string; hint?: string | null; error?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-muted-foreground/80">{hint}</span>}
      {error && <span role="alert" className="block text-xs text-destructive">{error}</span>}
    </label>
  );
}

function StatusBadge({ status }: { status: QueueStatus }) {
  return <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_TONE[status])}>{queueStatusLabel(status)}</span>;
}

function Progress({ queue }: { queue: QueueSummary }) {
  const percent = progressPercent(queue.counts);
  return (
    // Spans only: the list renders it inside a <button>.
    <span className="block space-y-1">
      <span className="block h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <span className="block h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
      </span>
      <span className="block text-xs text-muted-foreground">{countsLine(queue.counts)} · всего {queue.counts.total}</span>
    </span>
  );
}

const FIELD_OF_CODE: Record<string, QueueFormField> = {
  AGENT_REQUIRED: 'agentId',
  AGENT_NOT_FOUND: 'agentId',
  NO_ITEMS: 'items',
  TOO_MANY_ITEMS: 'items',
  ITEM_TOO_LONG: 'items',
  TEMPLATE_TOO_LONG: 'template',
};

function QueueFormView({ onCancel, onCreated }: { onCancel: () => void; onCreated: (queue: QueueView) => void }) {
  const [agents, setAgents] = useState<AgentItem[] | null>(null);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [form, setForm] = useState<QueueForm>(() => emptyQueueForm(''));
  const [errors, setErrors] = useState<QueueFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAgents()
      .then((list) => {
        if (cancelled) return;
        setAgents(list);
        setForm((current) => (current.agentId ? current : { ...current, agentId: list[0]?.id ?? '' }));
      })
      .catch((error) => { if (!cancelled) setAgentsError(errorText(error, 'Не удалось загрузить агентов')); });
    return () => { cancelled = true; };
  }, []);

  const set = <K extends keyof QueueForm>(key: K, value: QueueForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const itemCount = useMemo(() => itemsFromText(form.itemsText).length, [form.itemsText]);

  const submit = async () => {
    const local = validateQueueForm(form);
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length > 0) return;
    setSaving(true);
    try {
      onCreated(await createQueue(toQueuePayload(form)));
    } catch (error) {
      const message = errorText(error, 'Не удалось запустить конвейер');
      const field = error instanceof AgentQueueApiError && error.code ? FIELD_OF_CODE[error.code] : undefined;
      if (field) setErrors({ [field]: message });
      else setFormError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <button type="button" className={SECONDARY} onClick={onCancel}><ArrowLeft className="h-4 w-4" />Назад</button>
        <h3 className="text-sm font-semibold">Новая очередь</h3>
      </div>

      {agentsError && <p role="alert" className="text-sm text-destructive">{agentsError}</p>}
      {agents && agents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Агентов пока нет. Создай агента в панели «Агенты» — конвейер раздаёт пункты ему.
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Агент" error={errors.agentId}>
              <select className={INPUT} value={form.agentId} onChange={(event) => set('agentId', event.target.value)} disabled={!agents}>
                {!agents && <option value="">Загружаю…</option>}
                {agents?.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select>
            </Field>
            <Field label="Название" hint="Пусто — по имени агента.">
              <input className={INPUT} value={form.title} maxLength={120} onChange={(event) => set('title', event.target.value)} placeholder="Например, Pirelli — карточки" />
            </Field>
          </div>

          <Field label="Шаблон задания" hint={templateNote(form.template) ?? 'Вместо {{item}} встанет пункт.'} error={errors.template}>
            <textarea
              className={cn(INPUT, 'min-h-24')}
              value={form.template}
              onChange={(event) => set('template', event.target.value)}
              placeholder="Сделай карточку шины {{item}}: проверь размер на этикетке"
            />
          </Field>

          <Field label={`Пункты — по одному в строке${itemCount ? ` (${itemCount})` : ''}`} hint="До 500 пунктов, каждый до 2000 знаков." error={errors.items}>
            <textarea className={cn(INPUT, 'min-h-32 font-mono text-xs')} value={form.itemsText} onChange={(event) => set('itemsText', event.target.value)} />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Параллельно" hint="Сколько пунктов агент делает одновременно." error={errors.parallel}>
              <select className={INPUT} value={form.parallel} onChange={(event) => set('parallel', Number(event.target.value))}>
                {Array.from({ length: QUEUE_PARALLEL_MAX }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </Field>
            <Field label="Попыток на пункт" hint="FAIL переделывается, после последней — брак." error={errors.maxAttempts}>
              <select className={INPUT} value={form.maxAttempts} onChange={(event) => set('maxAttempts', Number(event.target.value))}>
                {Array.from({ length: QUEUE_ATTEMPTS_MAX }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </Field>
          </div>

          {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
          <div className="flex gap-2">
            <button type="button" className={PRIMARY} onClick={() => void submit()} disabled={saving || !agents}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Запустить
            </button>
            <button type="button" className={SECONDARY} onClick={onCancel} disabled={saving}>Отмена</button>
          </div>
        </>
      )}
    </div>
  );
}

const ACTION_BUTTON: Record<Exclude<QueueAction, 'delete'>, { label: string; icon: typeof Pause; command: QueueCommand }> = {
  pause: { label: 'Пауза', icon: Pause, command: 'pause' },
  resume: { label: 'Продолжить', icon: Play, command: 'resume' },
  stop: { label: 'Стоп', icon: Square, command: 'stop' },
  retry: { label: 'Ещё проход по браку', icon: RotateCcw, command: 'retry-rejected' },
};

function ItemRow({ item, maxAttempts, busy, onMarkOk, onOpenChat }: {
  item: QueueItem;
  maxAttempts: number;
  busy: boolean;
  onMarkOk: () => void;
  onOpenChat?: (sessionId: string) => void;
}) {
  return (
    <li className="space-y-1 rounded-lg border border-border px-2.5 py-2 text-sm">
      <div className="flex items-start gap-2">
        <span className="w-6 flex-shrink-0 text-right text-xs text-muted-foreground">{item.position}.</span>
        <span className="min-w-0 flex-1 break-words">{item.input}</span>
        <span className={cn('flex-shrink-0 text-xs font-medium', ITEM_TONE[item.status])}>{itemStatusLabel(item)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-8 text-xs text-muted-foreground">
        <span>{attemptsLabel(item, maxAttempts)}</span>
        {item.verdict && <span>вердикт: {item.verdict === 'ok' ? 'OK' : 'FAIL'}</span>}
        {item.sessionId && onOpenChat && (
          <button type="button" className="inline-flex items-center gap-1 hover:text-foreground hover:underline" onClick={() => onOpenChat(item.sessionId!)}>
            <MessageSquare className="h-3 w-3" />чат
          </button>
        )}
        {canMarkOk(item) && (
          <button type="button" className="inline-flex items-center gap-1 text-foreground hover:underline disabled:opacity-50" disabled={busy} onClick={onMarkOk}>
            <Check className="h-3 w-3" />Отметить OK
          </button>
        )}
      </div>
      {item.reason && item.status !== 'ok' && <p className="pl-8 text-xs text-destructive/90">Причина: {item.reason}</p>}
      {item.excerpt && (
        <details className="pl-8 text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Выдержка ответа</summary>
          <p className="mt-1 whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 text-muted-foreground">{item.excerpt}</p>
        </details>
      )}
    </li>
  );
}

function QueueDetail({ id, onBack, onOpenChat }: { id: string; onBack: () => void; onOpenChat?: (sessionId: string) => void }) {
  const { data: queue, loading, error, set, reload } = useQueue(id);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const act = async (action: () => Promise<QueueView>) => {
    setBusy(true);
    setActionError(null);
    try {
      set(await action());
    } catch (failure) {
      setActionError(errorText(failure, 'Не получилось'));
      void reload();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteQueue(id);
      onBack();
    } catch (failure) {
      setActionError(errorText(failure, 'Не удалось удалить очередь'));
      setBusy(false);
    }
  };

  if (!queue) {
    return (
      <div className="space-y-3 p-4">
        <button type="button" className={SECONDARY} onClick={onBack}><ArrowLeft className="h-4 w-4" />Назад</button>
        {loading && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Загружаю…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  const actions = queueActions(queue);
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={SECONDARY} onClick={onBack}><ArrowLeft className="h-4 w-4" />Назад</button>
        <h3 className="min-w-0 flex-1 truncate text-base font-semibold">{queue.title}</h3>
        <StatusBadge status={queue.status} />
      </div>
      <p className="text-xs text-muted-foreground">
        Агент: {queue.agentName ?? 'удалён'} · параллельно {queue.parallel} · попыток {queue.maxAttempts}
      </p>
      <Progress queue={queue} />

      <div className="flex flex-wrap gap-2">
        {actions.filter((action): action is Exclude<QueueAction, 'delete'> => action !== 'delete').map((action) => {
          const { label, icon: Icon, command } = ACTION_BUTTON[action];
          return (
            <button key={action} type="button" className={SECONDARY} disabled={busy} onClick={() => void act(() => runQueueCommand(queue.id, command))}>
              <Icon className="h-4 w-4" />{label}
            </button>
          );
        })}
        {actions.includes('delete') && (confirmDelete ? (
          <>
            <button type="button" className={`${BUTTON} bg-destructive text-destructive-foreground`} disabled={busy} onClick={() => void remove()}>Точно удалить</button>
            <button type="button" className={SECONDARY} onClick={() => setConfirmDelete(false)}>Нет</button>
          </>
        ) : (
          <button type="button" className={SECONDARY} disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" />Удалить</button>
        ))}
      </div>
      {queue.status === 'stopped' && <p className="text-xs text-muted-foreground">Очередь остановлена насовсем: новые пункты не берутся.</p>}
      {(actionError || error) && <p role="alert" className="text-sm text-destructive">{actionError || error}</p>}

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Шаблон задания</summary>
        <p className="mt-1 whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 text-muted-foreground">{queue.template}</p>
      </details>

      <ul className="space-y-1.5">
        {queue.items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            maxAttempts={queue.maxAttempts}
            busy={busy}
            onMarkOk={() => void act(() => markItemOk(item.id))}
            onOpenChat={onOpenChat}
          />
        ))}
      </ul>
    </div>
  );
}

export default function AgentQueuePanel({ onOpenChat }: { onOpenChat?: (sessionId: string) => void }) {
  const queues = useQueues();
  const [view, setView] = useState<View>({ kind: 'list' });

  if (view.kind === 'form') {
    return (
      <div className="h-full overflow-y-auto">
        <QueueFormView
          onCancel={() => setView({ kind: 'list' })}
          onCreated={(queue) => { void queues.reload(); setView({ kind: 'detail', id: queue.id }); }}
        />
      </div>
    );
  }

  if (view.kind === 'detail') {
    return (
      <div className="h-full overflow-y-auto">
        <QueueDetail id={view.id} onBack={() => { void queues.reload(); setView({ kind: 'list' }); }} onOpenChat={onOpenChat} />
      </div>
    );
  }

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Список пунктов разбирает агент: каждый ответ с вердиктом, брак — на ещё один проход.</p>
        <button type="button" className={PRIMARY} onClick={() => setView({ kind: 'form' })}><Plus className="h-4 w-4" />Новая очередь</button>
      </div>
      {queues.loading && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Загружаю…</p>}
      {queues.error && <p role="alert" className="text-sm text-destructive">{queues.error}</p>}
      {!queues.loading && !queues.error && queues.data.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          <ListChecks className="mx-auto mb-2 h-6 w-6" />
          Очередей пока нет. Создай первую: агент, шаблон с {'{{item}}'} и пункты по строке.
        </div>
      )}
      <ul className="space-y-2">
        {queues.data.map((queue) => (
          <li key={queue.id}>
            <button
              type="button"
              className="w-full space-y-2 rounded-xl border border-border px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
              onClick={() => setView({ kind: 'detail', id: queue.id })}
            >
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{queue.title}</span>
                <StatusBadge status={queue.status} />
              </span>
              <span className="block text-[11px] text-muted-foreground">Агент: {queue.agentName ?? 'удалён'}</span>
              <Progress queue={queue} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
