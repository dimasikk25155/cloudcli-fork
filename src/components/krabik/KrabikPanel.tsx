import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FileText, Loader2, MessageSquare, Power, Send, Square } from 'lucide-react';

import { cn } from '../../lib/utils';
import { authenticatedFetch } from '../../utils/api';
import MarkdownPreview from '../code-editor/view/subcomponents/markdown/MarkdownPreview';
import PixelCrab from '../crabs/PixelCrab';
import { readJson } from '../server/shared';

import {
  krabikSubtitle,
  mergePoll,
  krabikView,
  pollDelayMs,
  QUICK_TASKS,
  reportDay,
  reportTitle,
  shortWhen,
  type KrabikMessage,
  type KrabikReport,
  type KrabikStateResponse,
  type KrabikStatus,
} from './krabikModel';

// Окно «Агент крабик»: разговор с Claude-агентом на VPS NL (Herdr) как в
// обычном чате, его статус, готовые задачи и отчёты. Данные — /api/krabik.

type Tab = 'chat' | 'reports';
type Feedback = { ok: boolean; text: string } | null;

async function postJson(url: string, body?: unknown) {
  const response = await authenticatedFetch(url, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || `Запрос не прошёл (${response.status})`);
  return data?.data ?? data;
}

const TONE_CLASS: Record<string, string> = {
  ok: 'text-success',
  busy: 'text-primary',
  warning: 'text-amber-600 dark:text-amber-400',
  muted: 'text-muted-foreground',
};

function ToolLine({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const lines = text.split('\n');
  const shown = open ? lines : lines.slice(-2);
  const hidden = lines.length - shown.length;
  return (
    <div className="flex justify-start">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="max-w-[85%] rounded-lg px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted/60"
      >
        {hidden > 0 && <div className="opacity-70">ещё {hidden} шаг{hidden === 1 ? '' : hidden < 5 ? 'а' : 'ов'}…</div>}
        {shown.map((line, index) => (
          <div key={index} className="truncate">
            🦀 {line}
          </div>
        ))}
      </button>
    </div>
  );
}

function Bubble({ message }: { message: KrabikMessage }) {
  if (message.role === 'tool') return <ToolLine text={message.text} />;
  const mine = message.role === 'user';
  return (
    <div className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
          mine ? 'whitespace-pre-wrap bg-primary text-primary-foreground' : 'bg-muted text-foreground',
        )}
      >
        {mine ? (
          message.text
        ) : (
          <div className="prose prose-sm max-w-none break-words dark:prose-invert prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5">
            <MarkdownPreview content={message.text} />
          </div>
        )}
        {message.at && (
          <div className={cn('mt-1 text-right text-[10px]', mine ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
            {shortWhen(message.at)}
          </div>
        )}
      </div>
    </div>
  );
}

function ReportsTab() {
  const [reports, setReports] = useState<KrabikReport[] | null>(null);
  const [open, setOpen] = useState<{ name: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    readJson('/api/krabik/reports')
      .then((data) => setReports(data?.reports ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const openReport = useCallback(async (name: string) => {
    try {
      const data = await readJson(`/api/krabik/reports/${encodeURIComponent(name)}`);
      setOpen({ name, text: String(data?.text ?? '') });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  if (open) {
    return (
      <div className="px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen(null)}
          className="mb-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-accent"
        >
          <ArrowLeft className="h-4 w-4" /> Все отчёты
        </button>
        <div className="prose prose-sm max-w-none break-words dark:prose-invert">
          <MarkdownPreview content={open.text} />
        </div>
      </div>
    );
  }

  if (error) return <div className="px-4 py-6 text-sm text-destructive">{error}</div>;
  if (!reports) {
    return (
      <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Загружаю отчёты…
      </div>
    );
  }
  if (reports.length === 0) {
    return <div className="px-4 py-6 text-sm text-muted-foreground">Отчётов пока нет. Дай Крабику задачу — он запишет итог.</div>;
  }
  return (
    <ul className="divide-y divide-border">
      {reports.map((report) => (
        <li key={report.name}>
          <button
            type="button"
            onClick={() => void openReport(report.name)}
            className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent/50"
          >
            <span
              className={cn(
                'mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full',
                report.status === 'ok' && 'bg-success',
                report.status === 'problem' && 'bg-destructive',
                report.status === 'none' && 'bg-muted-foreground/40',
              )}
              aria-label={report.status === 'ok' ? 'всё хорошо' : report.status === 'problem' ? 'есть проблема' : 'без статуса'}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium text-foreground">{reportTitle(report.name, report.title)}</span>
                <span className="flex-shrink-0 text-xs text-muted-foreground">{reportDay(report.name) || shortWhen(report.mtime)}</span>
              </span>
              {report.summary && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{report.summary}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function KrabikPanel() {
  const [tab, setTab] = useState<Tab>('chat');
  const [state, setState] = useState<KrabikStateResponse | null>(null);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const mounted = useRef(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastCount = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const failures = useRef(0);
  const refresh = useCallback(async () => {
    let next: KrabikStateResponse;
    try {
      next = (await readJson('/api/krabik/state')) as KrabikStateResponse;
    } catch (err) {
      next = {
        reachable: false,
        status: 'unknown',
        title: '',
        completionSeq: 0,
        messages: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
    failures.current = next.reachable ? 0 : failures.current + 1;
    if (!mounted.current) return null;
    setState((prev) => {
      const merged = mergePoll(prev, next, failures.current);
      // Без связи переписку не стираем — показываем последнюю известную.
      return merged.reachable || !prev ? merged : { ...merged, messages: prev.messages };
    });
    return next;
  }, []);

  // Опрос: чаще, пока Крабик работает; со скрытой вкладки — пауза.
  const statusRef = useRef<KrabikStatus | undefined>(undefined);
  statusRef.current = state?.status;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const loop = async () => {
      if (stopped) return;
      if (!document.hidden) await refresh();
      if (stopped) return;
      timer = setTimeout(() => void loop(), pollDelayMs(statusRef.current));
    };
    void loop();
    const onVisibility = () => {
      if (!document.hidden) {
        if (timer) clearTimeout(timer);
        void loop();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  const messages = useMemo(() => state?.messages ?? [], [state]);

  // Убираем «отправляется», когда сообщение появилось в переписке.
  useEffect(() => {
    if (pending && messages.some((message) => message.role === 'user' && message.text === pending.trim())) {
      setPending(null);
    }
  }, [messages, pending]);

  // Новое сообщение — прокрутка вниз.
  useEffect(() => {
    const count = messages.length + (pending ? 1 : 0);
    if (count !== lastCount.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    lastCount.current = count;
  }, [messages.length, pending]);

  const send = useCallback(
    async (text: string) => {
      const prompt = text.trim();
      if (!prompt || busy) return;
      setBusy(true);
      setFeedback(null);
      setPending(prompt);
      try {
        await postJson('/api/krabik/prompt', { text: prompt });
        setDraft('');
        setTab('chat');
        setTimeout(() => void refresh(), 1200);
      } catch (err) {
        setPending(null);
        setFeedback({ ok: false, text: err instanceof Error ? err.message : String(err) });
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [busy, refresh],
  );

  const act = useCallback(
    async (path: 'stop' | 'wake') => {
      setBusy(true);
      setFeedback(null);
      try {
        const data = await postJson(`/api/krabik/${path}`);
        setFeedback({
          ok: true,
          text: path === 'stop' ? 'Остановил' : data?.result === 'started' ? 'Крабик проснулся' : 'Крабик и так на месте',
        });
        await refresh();
      } catch (err) {
        setFeedback({ ok: false, text: err instanceof Error ? err.message : String(err) });
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [refresh],
  );

  const view = krabikView(state);
  const waiting = state?.reachable && state.status === 'blocked';

  return (
    <div className="flex h-full flex-col" data-krabik-panel>
      {/* Шапка: краб, что делает, кнопки */}
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <span className={cn('flex h-12 w-14 items-center justify-center', view.crab === 'running' && 'crab-wander', waiting && 'krabik-waiting')}>
          <PixelCrab tint="sonnet" state={view.crab} holding={view.crab === 'running' ? '🔧' : undefined} scale={3} />
        </span>
        <div className="min-w-0 flex-1">
          <div className={cn('text-sm font-semibold', TONE_CLASS[view.tone])}>{view.label}</div>
          <div className="truncate text-xs text-muted-foreground">
            {krabikSubtitle(state)}
          </div>
        </div>
        {view.canStop && (
          <button
            type="button"
            onClick={() => void act('stop')}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            <Square className="h-3.5 w-3.5" /> Стоп
          </button>
        )}
        {view.canWake && (
          <button
            type="button"
            onClick={() => void act('wake')}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Power className="h-3.5 w-3.5" /> Разбудить
          </button>
        )}
      </div>

      {/* Вкладки */}
      <div className="flex flex-shrink-0 gap-1 border-b border-border px-3 py-1.5">
        {([
          ['chat', 'Разговор', MessageSquare],
          ['reports', 'Отчёты', FileText],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm',
              tab === key ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/50',
            )}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {waiting && (
        <div className="flex-shrink-0 border-b border-amber-300/60 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
          Крабик ждёт твоего ответа — напиши его ниже.
        </div>
      )}

      {tab === 'reports' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ReportsTab />
        </div>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
          {messages.length === 0 && !pending && (
            <div className="mx-auto mt-6 max-w-sm text-center text-sm text-muted-foreground">
              <div className="mb-3 flex justify-center">
                <PixelCrab tint="sonnet" state="done" scale={4} />
              </div>
              Крабик живёт на сервере и доводит задачи до конца, даже когда мак спит или пропал VPN.
              Выбери задачу ниже или напиши свою.
            </div>
          )}
          {messages.map((message) => (
            <Bubble key={message.id} message={message} />
          ))}
          {pending && (
            <div className="flex justify-end">
              <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl bg-primary/70 px-3.5 py-2.5 text-sm text-primary-foreground">
                {pending}
                <div className="mt-1 text-right text-[10px] text-primary-foreground/70">отправляется…</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Низ: готовые задачи и поле ввода */}
      <div className="flex-shrink-0 border-t border-border bg-background px-3 pb-3 pt-2" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        {feedback && (
          <div className={cn('mb-2 text-xs', feedback.ok ? 'text-success' : 'text-destructive')}>{feedback.text}</div>
        )}
        <div className="no-scrollbar -mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1">
          {QUICK_TASKS.map((task) => (
            <button
              key={task.label}
              type="button"
              disabled={busy}
              onClick={() => void send(task.prompt)}
              className="flex-shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-accent disabled:opacity-50"
            >
              {task.label}
            </button>
          ))}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) {
                event.preventDefault();
                void send(draft);
              }
            }}
            rows={1}
            placeholder={waiting ? 'Ответ Крабику…' : 'Что сделать на сервере?'}
            className="max-h-36 min-h-10 flex-1 resize-none rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40"
            aria-label="Отправить"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
      </div>
    </div>
  );
}
