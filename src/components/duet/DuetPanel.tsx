import React, { useMemo, useState } from 'react';
import { BellOff, Bell, ChevronDown, Lightbulb, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';

import { cn } from '../../lib/utils';
import MarkdownPreview from '../code-editor/view/subcomponents/markdown/MarkdownPreview';

import DuetDecisionCard from './DuetDecisionCard';
import { checkNow, dismissIdea, saveSettings, sweepIdeas, takeIdea, type DuetSettingsPatch } from './duetApi';
import {
  activeDecisions,
  briefTitle,
  describe,
  EFFORT_LABEL,
  groupByMachine,
  ideasFor,
  isBroken,
  projectName,
  shortName,
  STATUS_META,
  summarize,
  summaryLine,
  untilText,
  whenAgo,
  type DuetIdea,
  type DuetServiceRow,
  type DuetStateResponse,
} from './duetModel';
import { useDuetState } from './useDuetState';

// Окно «Дуэт»: напарник по ботам и сервисам (свой Claude Duet). Сегодня —
// что ждёт решения и свежий бриф; Боты — парк и идеи на каждом; Журнал —
// прошлые брифы, события и настройки. Данные — /api/duet.

type Tab = 'today' | 'bots' | 'journal';

function Pill({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'bad' | 'warn' | 'idea' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none',
        tone === 'bad' && 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
        tone === 'warn' && 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
        tone === 'idea' && 'bg-yellow-400/20 text-yellow-700 dark:text-yellow-300',
        tone === 'muted' && 'bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>
      {aside}
    </div>
  );
}

function Header({ state, onCheck, busy }: { state: DuetStateResponse | null; onCheck: () => void; busy: boolean }) {
  const summary = summarize(state?.services ?? []);
  const tone = summary.broken > 0 ? 'bg-rose-500' : summary.unreachable > 0 ? 'bg-amber-400' : summary.total > 0 ? 'bg-emerald-500' : 'bg-muted-foreground/40';
  const working = busy || Boolean(state?.checking);
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative flex h-3 w-3 flex-shrink-0">
            {summary.broken > 0 && <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', tone)} />}
            <span className={cn('relative inline-flex h-3 w-3 rounded-full', tone)} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">{summaryLine(summary)}</div>
            <div className="text-xs leading-relaxed text-muted-foreground">
              {state?.checkedAt ? `проверил ${whenAgo(state.checkedAt)}` : 'ещё не проверял'}
              {state && ` · следующая ${untilText(state.nextCheckAt)} · бриф ${untilText(state.nextBriefAt)}`}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onCheck}
          disabled={working}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', working && 'animate-spin')} />
          <span className="hidden sm:inline">Проверить сейчас</span>
          <span className="sm:hidden">Проверить</span>
        </button>
      </div>
      {state?.job && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span className="min-w-0 flex-1 truncate">
            {state.job.label}…
            {state.queue.length > 0 && <span className="text-primary/70"> · дальше ещё {state.queue.length}</span>}
          </span>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Сегодня

function TodayTab({ state, refresh }: { state: DuetStateResponse; refresh: () => void }) {
  const open = activeDecisions(state);
  const recent = state.decisions.filter((decision) => decision.status === 'done' || decision.status === 'failed').slice(0, 4);
  const brief = state.briefs[0];
  return (
    <div className="space-y-5">
      <section>
        <SectionTitle aside={brief ? <span className="text-[11px] text-muted-foreground">{whenAgo(brief.at)}</span> : null}>
          {brief ? briefTitle(brief) : 'Бриф'}
        </SectionTitle>
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
          {brief ? (
            <>
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <MarkdownPreview content={brief.text} />
              </div>
              {brief.error && <div className="mt-2 text-xs text-rose-600 dark:text-rose-400">{brief.error}</div>}
            </>
          ) : (
            <div className="text-xs text-muted-foreground">
              Брифа ещё не было. Первый придёт в {state.settings.briefTime} по Москве — или нажми «Проверить сейчас».
            </div>
          )}
        </div>
      </section>

      <section>
        <SectionTitle aside={open.length > 0 ? <Pill tone="bad">{open.length}</Pill> : null}>Ждёт тебя</SectionTitle>
        {open.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-3.5 py-4 text-center text-xs text-muted-foreground">
            Решать нечего. Если что-то упадёт — напишу сюда, в пуш и в Telegram.
          </div>
        ) : (
          <div className="space-y-2">
            {open.map((decision) => (
              <DuetDecisionCard key={decision.id} decision={decision} onChanged={refresh} />
            ))}
          </div>
        )}
      </section>

      {recent.length > 0 && (
        <section>
          <SectionTitle>Недавно сделано</SectionTitle>
          <div className="space-y-2">
            {recent.map((decision) => (
              <DuetDecisionCard key={decision.id} decision={decision} onChanged={refresh} compact />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Боты

function IdeaCard({ idea, canRun, onChanged }: { idea: DuetIdea; canRun: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const open = (idea.status === 'new' || idea.status === 'failed') && canRun;
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Lightbulb className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-yellow-500" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-foreground">{idea.title}</span>
            <Pill>{EFFORT_LABEL[idea.effort]}</Pill>
          </div>
          <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{idea.why}</div>
          {idea.result && (
            <div className={cn('mt-1.5 text-xs', idea.status === 'failed' ? 'text-rose-600 dark:text-rose-400' : idea.status === 'done' ? 'text-emerald-600 dark:text-emerald-400' : 'text-primary')}>
              {idea.status === 'running' && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
              {idea.result}
            </div>
          )}
          {open && (
            <div className="mt-2 flex gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => void act(() => takeIdea(idea.id))}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {idea.status === 'failed' ? 'Ещё раз' : 'Сделать'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void act(() => dismissIdea(idea.id))}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/60 disabled:opacity-50"
              >
                <X className="h-3 w-3" />
                Не надо
              </button>
            </div>
          )}
          {error && <div className="mt-1 text-xs text-rose-600 dark:text-rose-400">{error}</div>}
        </div>
      </div>
    </div>
  );
}

function ServiceRow({
  service,
  state,
  open,
  onToggle,
  onChanged,
}: {
  service: DuetServiceRow;
  state: DuetStateResponse;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const meta = STATUS_META[service.status];
  const ideas = ideasFor(state.ideas, service.id);
  const fresh = ideas.filter((idea) => idea.status === 'new').length;
  const about = describe(service.label);

  const patch = async (body: DuetSettingsPatch) => {
    setBusy(true);
    try {
      await saveSettings(body);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const askIdeas = async () => {
    setBusy(true);
    setNote(null);
    try {
      const result = await sweepIdeas(service.id);
      setNote(result.queued ? 'Смотрю код и придумываю — пара минут' : 'Уже придумываю идеи, подожди');
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn('rounded-xl border bg-card', open ? 'border-primary/40' : 'border-border', service.muted && 'opacity-60')}>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left">
        <span className={cn('h-2 w-2 flex-shrink-0 rounded-full', service.muted ? 'bg-muted-foreground/40' : meta.dot)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">{shortName(service.label)}</span>
            {service.crit && <Pill tone="warn">важный</Pill>}
            {service.muted && <Pill>не слежу</Pill>}
          </div>
          <div className={cn('truncate text-xs', service.muted ? 'text-muted-foreground' : meta.text)}>
            {meta.label}
            {(isBroken(service.status) || service.status === 'unreachable') && ` · ${whenAgo(service.since)}`}
          </div>
        </div>
        {fresh > 0 && (
          <Pill tone="idea">
            <Lightbulb className="h-2.5 w-2.5" />
            {fresh}
          </Pill>
        )}
        <ChevronDown className={cn('h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="space-y-3 border-t border-border px-3.5 py-3">
          {about && <div className="text-xs text-muted-foreground">{about}</div>}
          <div className="font-mono text-[11px] text-muted-foreground/80">
            {service.method} · {service.target}
          </div>
          {service.detail && <div className="text-xs text-muted-foreground">{service.detail}</div>}

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              Папка
              <select
                value={service.project?.path ?? ''}
                disabled={busy}
                onChange={(event) => void patch({ project: { serviceId: service.id, path: event.target.value || null } })}
                className="max-w-56 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
              >
                <option value="">— не привязан —</option>
                {state.projects.map((projectPath) => (
                  <option key={projectPath} value={projectPath}>{projectName(projectPath)}</option>
                ))}
              </select>
            </label>
            {service.project?.guessed && <span className="text-[11px] text-muted-foreground/80">угадал по имени</span>}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void patch(service.muted ? { unmute: service.id } : { mute: service.id })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-muted/60 disabled:opacity-50"
            >
              {service.muted ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
              {service.muted ? 'Снова следить' : 'Не следить'}
            </button>
            {service.project && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void askIdeas()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-muted/60 disabled:opacity-50"
              >
                <Lightbulb className="h-3.5 w-3.5 text-yellow-500" />
                Придумать идеи
              </button>
            )}
          </div>
          {note && <div className="text-xs text-primary">{note}</div>}
          {!service.project && (
            <div className="text-[11px] text-muted-foreground">Привяжи папку проекта — тогда Дуэт сможет читать код бота, предлагать идеи и чинить в нужном месте.</div>
          )}

          {ideas.length > 0 && (
            <div className="space-y-2">
              {ideas.map((idea) => (
                <IdeaCard key={idea.id} idea={idea} canRun={Boolean(service.project)} onChanged={onChanged} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BotsTab({ state, refresh }: { state: DuetStateResponse; refresh: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const groups = useMemo(() => groupByMachine(state.services), [state.services]);
  const freshIdeas = state.ideas.filter((idea) => idea.status === 'new').length;

  const sweep = async () => {
    setNote(null);
    try {
      const result = await sweepIdeas();
      setNote(result.queued ? 'Обхожу ботов — по паре минут на каждого. Идеи появятся у ботов.' : 'Уже обхожу, подожди');
      refresh();
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    }
  };

  if (state.services.length === 0) {
    return <div className="py-8 text-center text-sm text-muted-foreground">Парк ещё не проверен — нажми «Проверить сейчас».</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-yellow-400/40 bg-yellow-400/10 px-3.5 py-2.5">
        <div className="min-w-0 text-xs text-foreground">
          <span className="font-medium">Идеи для ботов: {freshIdeas}</span>
          <span className="text-muted-foreground"> · обход {state.lastIdeasAt ? whenAgo(state.lastIdeasAt) : 'ещё не делал'}, раз в {state.settings.ideasEveryDays} дн.</span>
        </div>
        <button
          type="button"
          onClick={() => void sweep()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-yellow-400/90 px-2.5 py-1.5 text-xs font-medium text-yellow-950 hover:bg-yellow-400"
        >
          <Lightbulb className="h-3.5 w-3.5" />
          Обойти всех
        </button>
      </div>
      {note && <div className="-mt-3 text-xs text-primary">{note}</div>}

      {groups.map((group) => (
        <section key={group.machine}>
          <SectionTitle aside={<span className="text-[11px] text-muted-foreground">{group.services.length}</span>}>{group.title}</SectionTitle>
          <div className="space-y-1.5">
            {group.services.map((service) => (
              <ServiceRow
                key={service.id}
                service={service}
                state={state}
                open={openId === service.id}
                onToggle={() => setOpenId((current) => (current === service.id ? null : service.id))}
                onChanged={refresh}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Журнал

const EVENT_ICON: Record<string, string> = {
  down: '🔴',
  up: '🟢',
  brief: '🎻',
  action: '🛠',
  ideas: '💡',
  skip: '⏸',
  error: '⚠️',
};

function JournalTab({ state, refresh }: { state: DuetStateResponse; refresh: () => void }) {
  const [openBrief, setOpenBrief] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: DuetSettingsPatch) => {
    setSaving(true);
    setError(null);
    try {
      await saveSettings(patch);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const select = 'rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground';

  return (
    <div className="space-y-5">
      <section>
        <SectionTitle aside={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}>Настройки</SectionTitle>
        <div className="grid gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3 text-xs text-muted-foreground sm:grid-cols-3">
          <label className="flex items-center justify-between gap-2 sm:flex-col sm:items-start">
            Утренний бриф (МСК)
            <input
              type="time"
              defaultValue={state.settings.briefTime}
              onBlur={(event) => event.target.value !== state.settings.briefTime && void save({ briefTime: event.target.value })}
              className={select}
            />
          </label>
          <label className="flex items-center justify-between gap-2 sm:flex-col sm:items-start">
            Проверять ботов
            <select value={state.settings.checkEveryMin} onChange={(event) => void save({ checkEveryMin: Number(event.target.value) })} className={select}>
              {[5, 10, 15, 30, 60].map((minutes) => <option key={minutes} value={minutes}>каждые {minutes} мин</option>)}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2 sm:flex-col sm:items-start">
            Обход идей
            <select value={state.settings.ideasEveryDays} onChange={(event) => void save({ ideasEveryDays: Number(event.target.value) })} className={select}>
              {[3, 7, 14, 30].map((days) => <option key={days} value={days}>раз в {days} дн.</option>)}
            </select>
          </label>
        </div>
        {error && <div className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">{error}</div>}
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Бриф и идеи — анализ только на чтение через Codex или Claude, по одному заданию за раз.
          Codex получает снимок исходников без ключей и не запускает команды.
          Чинит и делает идеи Дуэт только после твоего «Да». Расход виден в «Аудит и деньги» (автор «Дуэт»).
        </p>
      </section>

      <section>
        <SectionTitle>Брифы</SectionTitle>
        {state.briefs.length === 0 ? (
          <div className="text-xs text-muted-foreground">Пока ни одного.</div>
        ) : (
          <div className="space-y-1.5">
            {state.briefs.map((brief) => (
              <div key={brief.id} className="rounded-xl border border-border bg-card">
                <button
                  type="button"
                  onClick={() => setOpenBrief((current) => (current === brief.id ? null : brief.id))}
                  className="flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-sm"
                >
                  <span className="text-foreground">{briefTitle(brief)}</span>
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    {whenAgo(brief.at)}
                    <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', openBrief === brief.id && 'rotate-180')} />
                  </span>
                </button>
                {openBrief === brief.id && (
                  <div className="prose prose-sm max-w-none border-t border-border px-4 py-3 dark:prose-invert">
                    <MarkdownPreview content={brief.text} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>События</SectionTitle>
        {state.events.length === 0 ? (
          <div className="text-xs text-muted-foreground">Тихо.</div>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {state.events.slice(0, 40).map((event) => (
              <div key={event.id} className="flex items-start gap-2.5 px-3.5 py-2 text-xs">
                <span className="w-4 flex-shrink-0 text-center">{EVENT_ICON[event.kind] ?? '•'}</span>
                <span className="min-w-0 flex-1 break-words text-foreground">{event.text}</span>
                <span className="flex-shrink-0 text-[11px] text-muted-foreground">{whenAgo(event.at)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ окно

export default function DuetPanel() {
  const { state, error, refresh, apply } = useDuetState(true, 'panel');
  const [tab, setTab] = useState<Tab>('today');
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const onCheck = async () => {
    setChecking(true);
    setCheckError(null);
    try {
      apply(await checkNow());
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  };

  const reload = () => void refresh();
  const openCount = activeDecisions(state).length;
  const ideaCount = state?.ideas.filter((idea) => idea.status === 'new').length ?? 0;
  const tabs: Array<{ key: Tab; label: string; badge?: number }> = [
    { key: 'today', label: 'Сегодня', badge: openCount },
    { key: 'bots', label: 'Боты', badge: ideaCount },
    { key: 'journal', label: 'Журнал' },
  ];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <Header state={state} onCheck={() => void onCheck()} busy={checking} />
      {(error || checkError) && (
        <div className="rounded-xl border border-rose-300/60 bg-rose-50 px-3.5 py-2 text-xs text-rose-700 dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-300">
          {checkError ?? error}
        </div>
      )}

      <div className="flex gap-1 rounded-xl bg-muted/60 p-1">
        {tabs.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setTab(entry.key)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors',
              tab === entry.key ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {entry.label}
            {entry.badge ? (
              <span className={cn('rounded-full px-1.5 text-[10px] font-semibold leading-4', entry.key === 'today' ? 'bg-rose-600 text-white' : 'bg-yellow-400 text-yellow-950')}>
                {entry.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {!state ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Подключаюсь…
        </div>
      ) : tab === 'today' ? (
        <TodayTab state={state} refresh={reload} />
      ) : tab === 'bots' ? (
        <BotsTab state={state} refresh={reload} />
      ) : (
        <JournalTab state={state} refresh={reload} />
      )}
    </div>
  );
}
