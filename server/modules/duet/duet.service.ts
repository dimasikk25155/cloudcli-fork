/**
 * «Дуэт»: следит за ботами и сервисами, пишет первым, чинит только с «Да» Димы.
 *
 * - Проверка парка (без модели) раз в `checkEveryMin`: упал → тревога и решение
 *   с кнопками «Перезапустить / Починить агентом / Не следить»; встал сам →
 *   решение снимается.
 * - Бриф (утром, по кнопке, после аварии критичного сервиса) и обход идей —
 *   прогоны Claude «только чтение». Действия — только через решения.
 * - «Перезапустить» делает сервер (ssh/launchctl), «Починить» и «Сделать идею» —
 *   агент в папке бота с полными правами, но только после одобрения.
 * - Вся работа с моделью идёт по одной в очереди, чтобы не жечь лимит пачкой.
 */

import { createHash, randomBytes } from 'node:crypto';

import {
  buildBriefPrompt,
  buildFixPrompt,
  buildIdeaPrompt,
  buildIdeasPrompt,
  guessProject,
  parseBriefReply,
  parseIdeasReply,
  parseOutcome,
  statusRu,
} from './duet-brain.js';
import {
  buildSnapshot,
  canRestart,
  checkServices,
  diffSnapshots,
  fetchServiceDetail,
  heartbeatServices,
  isBroken,
  parseRegistry,
  restartService,
  type Exec,
  type HeartbeatBot,
} from './duet-fleet.js';
import {
  DEFAULT_SETTINGS,
  emptyState,
  type DuetBriefKind,
  type DuetChoice,
  type DuetDecision,
  type DuetEvent,
  type DuetEventKind,
  type DuetIdea,
  type DuetJob,
  type DuetJobKind,
  type DuetServiceState,
  type DuetSettings,
  type DuetState,
} from './duet.types.js';

export type DuetNoticeKind = 'down' | 'up' | 'brief' | 'done' | 'failed' | 'ideas';

export type DuetNotice = {
  kind: DuetNoticeKind;
  title: string;
  body: string;
  /** Пуш на телефон/компьютер. */
  push: boolean;
  /** Сообщение в Telegram (кнопки решения — только там и в панели). */
  telegram: boolean;
  /** Кнопки решения: выбор → одноразовый токен (сырой, уходит только в кнопку). */
  buttons?: Array<{ choice: DuetChoice; label: string; token: string }>;
};

export type DuetAgentRun = { projectPath: string; prompt: string; readOnly: boolean };

export type DuetDeps = {
  load: () => Promise<DuetState | null>;
  save: (state: DuetState) => Promise<void>;
  readRegistry: () => Promise<string>;
  exec: Exec;
  heartbeats: () => Promise<HeartbeatBot[]>;
  runAgent: (run: DuetAgentRun) => Promise<{ text: string; sessionId: string | null }>;
  /** null — можно; строка — почему прогон придержан (лимит подписки). */
  usageBlocked: () => Promise<string | null>;
  /** Отправить уведомление; вернуть сообщение Telegram, если ушло туда. */
  notify: (notice: DuetNotice) => Promise<{ chatId: string; messageId: number } | null>;
  /** Сообщение Telegram решения больше не нужно с кнопками: дописать итог. */
  closeTelegram: (decision: DuetDecision) => Promise<void>;
  /** Зарегистрированные проекты-кандидаты для привязки ботов. */
  projects: () => string[];
  /** Папка, где Дуэт пишет бриф и чинит то, что ни к чему не привязано. */
  homeProject: () => string;
  now?: () => Date;
  /** Пауза после перезапуска перед перепроверкой (тесты — 0). */
  settleMs?: number;
};

const KEEP_BRIEFS = 30;
const KEEP_EVENTS = 300;
const KEEP_DECISIONS = 120;
const DECISION_TTL_MS = 24 * 3600_000;
const INCIDENT_BRIEF_GAP_MS = 2 * 3600_000;
const MORNING_WINDOW_MS = 6 * 3600_000;
const MSK_OFFSET_MS = 3 * 3600_000;

/** «pulse-bot — Brand-дашборд/пульс, бот» → «pulse-bot». */
export function shortName(label: string): string {
  return label.split(' — ')[0].trim() || label;
}

const QUESTION: Record<Exclude<DuetChoice, 'dismiss'>, (name: string) => string> = {
  restart: (name) => `Перезапустить ${name}?`,
  fix: (name) => `Починить ${name}?`,
  mute: (name) => `Перестать следить за ${name}?`,
};

const CHOICE_LABEL: Record<DuetChoice, string> = {
  restart: 'Перезапустить',
  fix: 'Починить агентом',
  mute: 'Не следить',
  dismiss: 'Не надо',
};

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newId(): string {
  return randomBytes(6).toString('hex');
}

function mskHour(date: Date): number {
  return new Date(date.getTime() + MSK_OFFSET_MS).getUTCHours();
}

/** Сегодняшний момент брифа (`HH:MM` по Москве) в UTC. */
export function briefInstant(now: Date, briefTime: string): Date {
  const [hh, mm] = briefTime.split(':').map(Number);
  const msk = new Date(now.getTime() + MSK_OFFSET_MS);
  return new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate(), hh, mm) - MSK_OFFSET_MS);
}

export function normalizeSettings(raw: Partial<DuetSettings> | null | undefined): DuetSettings {
  const value = raw ?? {};
  const briefTime = typeof value.briefTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.briefTime)
    ? value.briefTime
    : DEFAULT_SETTINGS.briefTime;
  const clamp = (input: unknown, min: number, max: number, fallback: number) => {
    const number = Number(input);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
  };
  const projects: Record<string, string> = {};
  if (value.projects && typeof value.projects === 'object') {
    for (const [id, projectPath] of Object.entries(value.projects)) {
      if (typeof projectPath === 'string' && projectPath.startsWith('/')) projects[id] = projectPath;
    }
  }
  return {
    briefTime,
    checkEveryMin: clamp(value.checkEveryMin, 5, 240, DEFAULT_SETTINGS.checkEveryMin),
    ideasEveryDays: clamp(value.ideasEveryDays, 1, 60, DEFAULT_SETTINGS.ideasEveryDays),
    muted: Array.isArray(value.muted) ? [...new Set(value.muted.filter((id) => typeof id === 'string'))] : [],
    projects,
  };
}

export function createDuetService(deps: DuetDeps) {
  const now = deps.now ?? (() => new Date());
  const settleMs = deps.settleMs ?? 8_000;
  let state: DuetState | null = null;
  let loading: Promise<DuetState> | null = null;
  let checking: Promise<void> | null = null;

  // Очередь работ с моделью: одна за раз.
  const queue: Array<{ kind: DuetJobKind; label: string; run: () => Promise<void> }> = [];
  let job: DuetJob | null = null;
  let draining: Promise<void> | null = null;
  let modelRetryAt = 0;

  async function current(): Promise<DuetState> {
    if (state) return state;
    if (!loading) {
      loading = (async () => {
        const loaded = await deps.load().catch(() => null);
        const base = emptyState();
        const merged: DuetState = loaded ? { ...base, ...loaded, settings: normalizeSettings(loaded.settings) } : base;
        // Работа, оборванная перезапуском Neo3, не будет доделана — честно отметить.
        for (const decision of merged.decisions) {
          if (decision.status === 'running') {
            decision.status = 'failed';
            decision.result = 'Neo3 перезапустился посреди работы';
          }
        }
        for (const idea of merged.ideas) {
          if (idea.status === 'running') {
            idea.status = 'failed';
            idea.result = 'Neo3 перезапустился посреди работы';
          }
        }
        state = merged;
        return merged;
      })();
    }
    return loading;
  }

  async function persist(): Promise<void> {
    if (!state) return;
    state.briefs = state.briefs.slice(-KEEP_BRIEFS);
    state.events = state.events.slice(-KEEP_EVENTS);
    state.decisions = state.decisions.slice(-KEEP_DECISIONS);
    await deps.save(state).catch(() => undefined);
  }

  function addEvent(s: DuetState, kind: DuetEventKind, text: string, serviceId?: string): DuetEvent {
    const event: DuetEvent = { id: newId(), at: now().toISOString(), kind, text, ...(serviceId ? { serviceId } : {}) };
    s.events.push(event);
    return event;
  }

  function findService(s: DuetState, id: string): DuetServiceState | undefined {
    return s.snapshot?.services.find((entry) => entry.id === id);
  }

  function projectFor(s: DuetState, service: Pick<DuetServiceState, 'id' | 'target' | 'label' | 'projectHint'>): { path: string; guessed: boolean } | null {
    const manual = s.settings.projects[service.id];
    if (manual) return { path: manual, guessed: false };
    const known = deps.projects();
    if (service.projectHint && known.includes(service.projectHint)) return { path: service.projectHint, guessed: false };
    const guessed = guessProject(service, known);
    return guessed ? { path: guessed, guessed: true } : null;
  }

  function choicesFor(service: DuetServiceState, first?: DuetChoice): DuetChoice[] {
    // Контейнера нет вовсе — перезапускать нечего.
    const restartable = canRestart(service) && service.status !== 'missing';
    const all: DuetChoice[] = [...(restartable ? ['restart' as const] : []), 'fix', 'mute'];
    if (!first || !all.includes(first)) return all;
    return [first, ...all.filter((choice) => choice !== first)];
  }

  /** Новое решение (если по сервису ещё нет открытого) + уведомление с кнопками. */
  async function openDecision(
    s: DuetState,
    service: DuetServiceState,
    input: { source: DuetDecision['source']; title: string; body: string; first?: DuetChoice; kind: DuetNoticeKind; push: boolean; telegram: boolean },
  ): Promise<DuetDecision | null> {
    if (s.decisions.some((decision) => decision.serviceId === service.id && (decision.status === 'pending' || decision.status === 'running'))) {
      return null;
    }
    const raw = choicesFor(service, input.first).map((choice) => ({ choice, label: CHOICE_LABEL[choice], token: randomBytes(12).toString('hex') }));
    const decision: DuetDecision = {
      id: newId(),
      createdAt: now().toISOString(),
      source: input.source,
      serviceId: service.id,
      title: input.title,
      body: input.body,
      options: raw.map(({ choice, label, token }) => ({ choice, label, tokenHash: hashToken(token) })),
      status: 'pending',
    };
    s.decisions.push(decision);
    const sent = await deps.notify({ kind: input.kind, title: input.title, body: input.body, push: input.push, telegram: input.telegram, buttons: raw }).catch(() => null);
    if (sent) decision.telegram = sent;
    return decision;
  }

  async function finishDecision(decision: DuetDecision, status: DuetDecision['status'], result: string): Promise<void> {
    decision.status = status;
    decision.result = result;
    await deps.closeTelegram(decision).catch(() => undefined);
  }

  // ---------------------------------------------------------------- очередь

  function enqueue(kind: DuetJobKind, label: string, run: () => Promise<void>): void {
    queue.push({ kind, label, run });
    if (!draining) {
      draining = (async () => {
        while (queue.length > 0) {
          const next = queue.shift()!;
          job = { kind: next.kind, label: next.label, startedAt: now().toISOString() };
          try {
            await next.run();
          } catch (error) {
            const s = await current();
            addEvent(s, 'error', `${next.label}: ${(error as Error)?.message ?? String(error)}`);
            await persist();
          }
        }
        job = null;
        draining = null;
      })();
    }
  }

  function queued(kind: DuetJobKind): boolean {
    return job?.kind === kind || queue.some((entry) => entry.kind === kind);
  }

  // ---------------------------------------------------------------- проверка

  async function runCheck(): Promise<void> {
    const s = await current();
    const services = parseRegistry(await deps.readRegistry().catch(() => ''));
    const [statuses, bots] = await Promise.all([
      checkServices(services, deps.exec),
      deps.heartbeats().catch(() => [] as HeartbeatBot[]),
    ]);
    const previous = s.snapshot;
    const snapshot = buildSnapshot(services, statuses, heartbeatServices(bots), previous, now());
    const { fell, recovered } = diffSnapshots(previous, snapshot, s.settings.muted);
    s.snapshot = snapshot;

    for (const entry of recovered) {
      addEvent(s, 'up', `«${shortName(entry.label)}» снова работает`, entry.id);
      for (const decision of s.decisions) {
        if (decision.serviceId === entry.id && decision.status === 'pending') {
          await finishDecision(decision, 'expired', 'Поднялся сам');
        }
      }
      if (entry.crit) {
        await deps.notify({ kind: 'up', title: `Встал: ${shortName(entry.label)}`, body: 'Снова работает, решение снято.', push: false, telegram: true }).catch(() => null);
      }
    }

    const daytime = mskHour(now()) >= 8 && mskHour(now()) < 23;
    for (const entry of fell) {
      addEvent(s, 'down', `«${shortName(entry.label)}» ${statusRu(entry.status)}`, entry.id);
      const detail = await fetchServiceDetail(entry, deps.exec).catch(() => '');
      const lastLine = detail.split('\n').map((line) => line.trim()).filter(Boolean).slice(-2).join('\n');
      await openDecision(s, entry, {
        source: 'watch',
        kind: 'down',
        title: `${entry.crit ? 'Упал' : 'Лежит'}: ${shortName(entry.label)}`,
        body: [`${entry.machine} · ${statusRu(entry.status)}`, lastLine].filter(Boolean).join('\n'),
        // Ночью (23–08 МСК) некритичное не будит: оно ждёт в панели и попадёт в бриф.
        push: daytime || entry.crit,
        telegram: daytime || entry.crit,
      });
    }

    const critFell = fell.some((entry) => entry.crit);
    const lastIncident = s.lastIncidentBriefAt ? Date.parse(s.lastIncidentBriefAt) : 0;
    if (critFell && now().getTime() - lastIncident > INCIDENT_BRIEF_GAP_MS) {
      s.lastIncidentBriefAt = now().toISOString();
      requestBrief('incident');
    }
    await persist();
  }

  /** Одна проверка за раз; повторный вызов ждёт идущую. */
  function check(): Promise<void> {
    if (!checking) {
      checking = runCheck().finally(() => {
        checking = null;
      });
    }
    return checking;
  }

  // ---------------------------------------------------------------- бриф

  function requestBrief(kind: DuetBriefKind): void {
    if (queued('brief')) return;
    enqueue('brief', kind === 'morning' ? 'Утренний бриф' : 'Бриф', () => runBrief(kind));
  }

  async function runBrief(kind: DuetBriefKind): Promise<void> {
    const s = await current();
    if (kind !== 'manual') {
      const blocked = await deps.usageBlocked().catch(() => null);
      if (blocked) {
        addEvent(s, 'skip', `Бриф отложен: ${blocked}`);
        modelRetryAt = now().getTime() + 30 * 60_000;
        await persist();
        return;
      }
    }
    if (kind === 'morning') s.lastBriefAt = now().toISOString();
    if (!s.snapshot) await check();
    const snapshot = s.snapshot;
    if (!snapshot) return;

    const muted = new Set(s.settings.muted);
    const broken = snapshot.services.filter((entry) => isBroken(entry.status) && !muted.has(entry.id)).slice(0, 8);
    const details: Record<string, string> = {};
    await Promise.all(broken.map(async (entry) => {
      details[entry.id] = (await fetchServiceDetail(entry, deps.exec).catch(() => '')) || entry.detail || '';
    }));
    const dayAgo = now().getTime() - 24 * 3600_000;
    const prompt = buildBriefPrompt({
      kind,
      now: now(),
      snapshot,
      muted: s.settings.muted,
      details,
      events: s.events.filter((event) => Date.parse(event.at) >= dayAgo),
      pending: s.decisions.filter((decision) => decision.status === 'pending'),
      ideas: s.ideas,
    });

    const brief = { id: newId(), at: now().toISOString(), kind, text: '', sessionId: null as string | null, error: undefined as string | undefined };
    try {
      const reply = await deps.runAgent({ projectPath: deps.homeProject(), prompt, readOnly: true });
      const parsed = parseBriefReply(reply.text, new Set(snapshot.services.map((entry) => entry.id)));
      brief.text = parsed.brief;
      brief.sessionId = reply.sessionId;
      s.briefs.push(brief);
      addEvent(s, 'brief', kind === 'morning' ? 'Утренний бриф готов' : 'Бриф готов');
      await deps.notify({
        kind: 'brief',
        title: kind === 'morning' ? 'Дуэт: утренний бриф' : kind === 'incident' ? 'Дуэт: разбор аварии' : 'Дуэт: бриф',
        body: parsed.brief,
        push: true,
        telegram: true,
      }).catch(() => null);
      for (const proposal of parsed.proposals) {
        const service = findService(s, proposal.serviceId);
        if (!service || service.status === 'up' || service.status === 'idle') continue;
        await openDecision(s, service, {
          source: 'brief',
          kind: 'down',
          title: QUESTION[proposal.choice](shortName(service.label)),
          body: proposal.why || `${service.machine} · ${statusRu(service.status)}`,
          first: proposal.choice,
          push: false,
          telegram: true,
        });
      }
    } catch (error) {
      brief.error = (error as Error)?.message ?? String(error);
      brief.text = 'Не получилось написать бриф.';
      s.briefs.push(brief);
      addEvent(s, 'error', `Бриф не вышел: ${brief.error}`);
    }
    await persist();
  }

  // ---------------------------------------------------------------- идеи

  function ideaTargets(s: DuetState, onlyId?: string): DuetServiceState[] {
    const muted = new Set(s.settings.muted);
    const home = deps.homeProject();
    const seen = new Set<string>();
    return (s.snapshot?.services ?? []).filter((service) => {
      if (onlyId && service.id !== onlyId) return false;
      if (!onlyId && muted.has(service.id)) return false;
      const project = projectFor(s, service);
      if (!project || project.path === home || seen.has(project.path)) return false;
      seen.add(project.path);
      return true;
    });
  }

  function requestIdeas(onlyId?: string): boolean {
    if (queued('ideas')) return false;
    enqueue('ideas', onlyId ? 'Идеи для бота' : 'Обход идей', () => runIdeas(onlyId));
    return true;
  }

  async function runIdeas(onlyId?: string): Promise<void> {
    const s = await current();
    if (!onlyId) s.lastIdeasAt = now().toISOString();
    if (!s.snapshot) await check();
    let added = 0;
    const bots: string[] = [];
    for (const service of ideaTargets(s, onlyId)) {
      if (!onlyId) {
        const blocked = await deps.usageBlocked().catch(() => null);
        if (blocked) {
          addEvent(s, 'skip', `Обход идей остановлен: ${blocked}`);
          break;
        }
      }
      const project = projectFor(s, service)!;
      const existingTitles = s.ideas.filter((idea) => idea.serviceId === service.id).map((idea) => idea.title);
      try {
        const reply = await deps.runAgent({
          projectPath: project.path,
          prompt: buildIdeasPrompt({ service, projectPath: project.path, existingTitles }),
          readOnly: true,
        });
        const drafts = parseIdeasReply(reply.text, existingTitles);
        for (const draft of drafts) {
          s.ideas.push({ id: newId(), serviceId: service.id, ...draft, status: 'new', createdAt: now().toISOString() });
        }
        if (drafts.length > 0) {
          added += drafts.length;
          bots.push(service.label.split(' — ')[0]);
        }
      } catch (error) {
        addEvent(s, 'error', `Идеи для «${shortName(service.label)}» не вышли: ${(error as Error)?.message ?? String(error)}`, service.id);
      }
      await persist();
    }
    addEvent(s, 'ideas', added > 0 ? `Повесил идеи (${added}): ${bots.join(', ')}` : 'Новых идей нет');
    if (added > 0) {
      const word = added % 10 === 1 && added % 100 !== 11 ? 'идея' : [2, 3, 4].includes(added % 10) && ![12, 13, 14].includes(added % 100) ? 'идеи' : 'идей';
      await deps.notify({ kind: 'ideas', title: `Дуэт: ${added} ${word} для ботов`, body: bots.join(', '), push: false, telegram: true }).catch(() => null);
    }
    await persist();
  }

  // ---------------------------------------------------------------- решения

  async function runFix(decision: DuetDecision, service: DuetServiceState): Promise<void> {
    const s = await current();
    const project = projectFor(s, service)?.path ?? deps.homeProject();
    const detail = await fetchServiceDetail(service, deps.exec).catch(() => '');
    try {
      const reply = await deps.runAgent({ projectPath: project, prompt: buildFixPrompt(service, detail), readOnly: false });
      const outcome = parseOutcome(reply.text);
      decision.sessionId = reply.sessionId;
      await finishDecision(decision, outcome.ok ? 'done' : 'failed', outcome.summary);
    } catch (error) {
      await finishDecision(decision, 'failed', (error as Error)?.message ?? String(error));
    }
    addEvent(s, 'action', `Починка «${shortName(service.label)}»: ${decision.result}`, service.id);
    await deps.notify({
      kind: decision.status === 'done' ? 'done' : 'failed',
      title: `${decision.status === 'done' ? 'Дуэт починил' : 'Дуэт не смог починить'}: ${shortName(service.label)}`,
      body: decision.result ?? '',
      push: true,
      telegram: true,
    }).catch(() => null);
    await persist();
  }

  async function runRestart(decision: DuetDecision, service: DuetServiceState): Promise<void> {
    const s = await current();
    const result = await restartService(service, deps.exec);
    if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs));
    const recheck = (await checkServices([service], deps.exec)).get(service.id) ?? 'unknown';
    const ok = result.code === 0 && (recheck === 'up' || recheck === 'idle');
    const entry = findService(s, service.id);
    if (entry && entry.status !== recheck) {
      entry.status = recheck;
      entry.since = now().toISOString();
    }
    const tail = result.stdout.trim().split('\n').slice(-2).join(' ');
    await finishDecision(decision, ok ? 'done' : 'failed', ok ? 'Перезапустил — работает' : `Не встал: ${statusRu(recheck)}${tail ? ` (${tail})` : ''}`);
    addEvent(s, 'action', `Перезапуск «${shortName(service.label)}»: ${decision.result}`, service.id);
    if (!ok) {
      await deps.notify({ kind: 'failed', title: `Не встал после перезапуска: ${shortName(service.label)}`, body: decision.result ?? '', push: true, telegram: true }).catch(() => null);
    }
    await persist();
  }

  type DecideResult = { ok: true; decision: DuetDecision } | { ok: false; reason: 'not_found' | 'already_decided' | 'bad_choice' };

  async function decide(decisionId: string, choice: DuetChoice, via: 'ui' | 'telegram'): Promise<DecideResult> {
    const s = await current();
    const decision = s.decisions.find((entry) => entry.id === decisionId);
    if (!decision) return { ok: false, reason: 'not_found' };
    if (decision.status !== 'pending') return { ok: false, reason: 'already_decided' };
    if (choice !== 'dismiss' && !decision.options.some((option) => option.choice === choice)) return { ok: false, reason: 'bad_choice' };
    const service = findService(s, decision.serviceId);

    decision.chosen = choice;
    decision.decidedAt = now().toISOString();
    decision.via = via;

    if (choice === 'dismiss' || !service) {
      await finishDecision(decision, 'skipped', service ? 'Дима решил не трогать' : 'Сервиса больше нет в реестре');
    } else if (choice === 'mute') {
      if (!s.settings.muted.includes(service.id)) s.settings.muted.push(service.id);
      await finishDecision(decision, 'done', 'Больше не слежу');
      addEvent(s, 'action', `«${shortName(service.label)}»: больше не слежу`, service.id);
    } else if (choice === 'restart') {
      decision.status = 'running';
      decision.result = 'Перезапускаю…';
      void runRestart(decision, service).catch(() => undefined);
    } else {
      decision.status = 'running';
      decision.result = queue.length > 0 || job ? 'В очереди…' : 'Агент чинит…';
      enqueue('fix', `Починка: ${shortName(service.label)}`, () => runFix(decision, service));
    }
    await persist();
    return { ok: true, decision };
  }

  /** Кнопка из Telegram: токен → решение. */
  async function redeem(token: string): Promise<DecideResult & { label?: string }> {
    const s = await current();
    const hash = hashToken(token);
    for (const decision of s.decisions) {
      const option = decision.options.find((entry) => entry.tokenHash === hash);
      if (!option) continue;
      const result = await decide(decision.id, option.choice, 'telegram');
      return { ...result, label: option.label };
    }
    return { ok: false, reason: 'not_found' };
  }

  async function takeIdea(ideaId: string): Promise<DuetIdea | null> {
    const s = await current();
    const idea = s.ideas.find((entry) => entry.id === ideaId);
    if (!idea || (idea.status !== 'new' && idea.status !== 'failed')) return null;
    const service = findService(s, idea.serviceId);
    const project = service ? projectFor(s, service) : null;
    if (!service || !project) return null;
    idea.status = 'running';
    idea.result = queue.length > 0 || job ? 'В очереди…' : 'Агент делает…';
    enqueue('idea', `Идея: ${idea.title}`, async () => {
      try {
        const reply = await deps.runAgent({ projectPath: project.path, prompt: buildIdeaPrompt(service, idea), readOnly: false });
        const outcome = parseOutcome(reply.text);
        idea.status = outcome.ok ? 'done' : 'failed';
        idea.result = outcome.summary;
        idea.sessionId = reply.sessionId;
      } catch (error) {
        idea.status = 'failed';
        idea.result = (error as Error)?.message ?? String(error);
      }
      addEvent(s, 'action', `Идея «${idea.title}»: ${idea.result}`, service.id);
      await deps.notify({
        kind: idea.status === 'done' ? 'done' : 'failed',
        title: `${idea.status === 'done' ? 'Сделано' : 'Не вышло'}: ${idea.title}`,
        body: idea.result ?? '',
        push: true,
        telegram: true,
      }).catch(() => null);
      await persist();
    });
    await persist();
    return idea;
  }

  async function dismissIdea(ideaId: string): Promise<DuetIdea | null> {
    const s = await current();
    const idea = s.ideas.find((entry) => entry.id === ideaId);
    if (!idea || idea.status === 'running') return null;
    idea.status = 'dismissed';
    await persist();
    return idea;
  }

  async function updateSettings(patch: Partial<DuetSettings> & { mute?: string; unmute?: string; project?: { serviceId: string; path: string | null } }): Promise<DuetSettings> {
    const s = await current();
    const next = normalizeSettings({ ...s.settings, ...patch, muted: patch.muted ?? s.settings.muted, projects: patch.projects ?? s.settings.projects });
    if (patch.mute && !next.muted.includes(patch.mute)) next.muted.push(patch.mute);
    if (patch.unmute) next.muted = next.muted.filter((id) => id !== patch.unmute);
    if (patch.project?.serviceId) {
      if (patch.project.path && deps.projects().includes(patch.project.path)) next.projects[patch.project.serviceId] = patch.project.path;
      else delete next.projects[patch.project.serviceId];
    }
    s.settings = next;
    await persist();
    return next;
  }

  // ---------------------------------------------------------------- расписание

  /** Раз в минуту из сторожа: проверка по интервалу, утренний бриф, обход идей, протухшие решения. */
  async function tick(): Promise<void> {
    const s = await current();
    const at = now();
    const last = s.snapshot ? Date.parse(s.snapshot.checkedAt) : 0;
    if (at.getTime() - last >= s.settings.checkEveryMin * 60_000) await check();

    for (const decision of s.decisions) {
      if (decision.status === 'pending' && at.getTime() - Date.parse(decision.createdAt) > DECISION_TTL_MS) {
        await finishDecision(decision, 'expired', 'Сутки без ответа — снял');
      }
    }

    if (at.getTime() >= modelRetryAt) {
      const instant = briefInstant(at, s.settings.briefTime);
      const lastBrief = s.lastBriefAt ? Date.parse(s.lastBriefAt) : 0;
      if (at >= instant && lastBrief < instant.getTime() && at.getTime() - instant.getTime() < MORNING_WINDOW_MS) {
        requestBrief('morning');
      }
      const lastIdeas = s.lastIdeasAt ? Date.parse(s.lastIdeasAt) : 0;
      const hour = mskHour(at);
      if (at.getTime() - lastIdeas > s.settings.ideasEveryDays * 24 * 3600_000 && hour >= 10 && hour < 22 && !queued('brief')) {
        requestIdeas();
      }
    }
    await persist();
  }

  // ---------------------------------------------------------------- для панели

  async function view() {
    const s = await current();
    const muted = new Set(s.settings.muted);
    const services = (s.snapshot?.services ?? []).map((entry) => ({
      ...entry,
      muted: muted.has(entry.id),
      project: projectFor(s, entry),
      canRestart: canRestart(entry),
      ideas: s.ideas.filter((idea) => idea.serviceId === entry.id && idea.status !== 'dismissed').length,
    }));
    const instant = briefInstant(now(), s.settings.briefTime);
    const nextBrief = instant.getTime() > now().getTime() ? instant : new Date(instant.getTime() + 24 * 3600_000);
    const lastCheck = s.snapshot ? Date.parse(s.snapshot.checkedAt) : now().getTime();
    return {
      settings: s.settings,
      checkedAt: s.snapshot?.checkedAt ?? null,
      nextCheckAt: new Date(lastCheck + s.settings.checkEveryMin * 60_000).toISOString(),
      nextBriefAt: nextBrief.toISOString(),
      lastIdeasAt: s.lastIdeasAt,
      services,
      decisions: s.decisions.slice(-50).reverse().map(({ options, ...rest }) => ({
        ...rest,
        options: options.map(({ choice, label }) => ({ choice, label })),
      })),
      ideas: s.ideas.filter((idea) => idea.status !== 'dismissed'),
      briefs: s.briefs.slice(-10).reverse(),
      events: s.events.slice(-80).reverse(),
      job,
      queue: queue.map((entry) => entry.label),
      checking: Boolean(checking),
      projects: deps.projects(),
    };
  }

  return {
    check,
    tick,
    view,
    decide,
    redeem,
    takeIdea,
    dismissIdea,
    requestBrief,
    requestIdeas,
    updateSettings,
    /** Для тестов: дождаться очереди. */
    async idle(): Promise<void> {
      while (draining || checking) {
        await (draining ?? checking);
      }
    },
  };
}

export type DuetApi = ReturnType<typeof createDuetService>;
export type DuetView = Awaited<ReturnType<DuetApi['view']>>;
