import type { ChatMessage, SubagentState } from '../chat/types/types';

/**
 * Subagents as crabs: one crab per Agent/Task call, coloured by its model,
 * holding what it is doing right now, back with a tick when done. Everything
 * the human reads here is Russian and non-technical — the subagent's English
 * prompt and result stay behind «Подробности».
 */

export type CrabTint = 'haiku' | 'sonnet' | 'opus' | 'fable' | 'grok' | 'other';

/**
 * running — out working; done — back with a result; failed — came back
 * with an error or was stopped; lost — the run is over and it never reported
 * back (its process went with the run).
 */
export type CrabState = 'running' | 'done' | 'failed' | 'lost';

export type CrabActivity = { verb: string; icon: string };

export type Crab = {
  id: string;
  title: string;
  tint: CrabTint;
  state: CrabState;
  /** What it is doing now; null when nothing is known yet or it is back. */
  activity: CrabActivity | null;
  toolsUsed: number;
  /** Epoch ms. */
  startedAt?: number;
  /** Known time spent: reported by the agent, or measured. */
  durationMs?: number;
};

export type CrabContext = {
  /** The chat's run is still going (crabs without a report may still return). */
  isRunActive: boolean;
  /** Last tool of live background agents, by the Agent call that started them. */
  backgroundLastTool?: ReadonlyMap<string, string | undefined>;
};

export const CRAB_TINT_COLOR: Record<CrabTint, string> = {
  haiku: '#38bdf8',
  sonnet: '#fb923c',
  opus: '#a78bfa',
  fable: '#34d399',
  grok: '#f87171',
  other: '#94a3b8',
};

export const CRAB_TINT_LABEL: Record<CrabTint, string> = {
  haiku: 'Haiku',
  sonnet: 'Sonnet',
  opus: 'Opus',
  fable: 'Fable',
  grok: 'Grok',
  other: 'модель сессии',
};

export function tintForModel(model: string | undefined): CrabTint {
  const name = (model || '').toLowerCase();
  if (name.includes('haiku')) return 'haiku';
  if (name.includes('sonnet')) return 'sonnet';
  if (name.includes('opus')) return 'opus';
  if (name.includes('fable')) return 'fable';
  if (name.includes('grok')) return 'grok';
  return 'other';
}

const THINKING: CrabActivity = { verb: 'думает', icon: '💭' };

/** Grok's own tool names, read as the Claude tool doing the same job. */
const GROK_TOOL_ALIASES: Record<string, string> = {
  read_file: 'Read',
  grep: 'Grep',
  list_dir: 'LS',
  search_tool: 'Grep',
  run_terminal_command: 'Bash',
  monitor: 'Bash',
  get_command_or_subagent_output: 'Bash',
  search_replace: 'Edit',
  write: 'Write',
  web_fetch: 'WebFetch',
  spawn_subagent: 'Agent',
};

export function activityFor(rawToolName: string | undefined): CrabActivity {
  if (!rawToolName) return THINKING;
  const toolName = GROK_TOOL_ALIASES[rawToolName] ?? rawToolName;
  if (toolName.startsWith('image_') || toolName.endsWith('_to_video')) return { verb: 'рисует', icon: '🎨' };
  if (toolName === 'use_tool') return { verb: 'в сервисе', icon: '🔌' };
  if (toolName === 'Read' || toolName === 'NotebookRead') return { verb: 'читает', icon: '📖' };
  if (toolName === 'Grep' || toolName === 'Glob' || toolName === 'LS') return { verb: 'ищет', icon: '🔍' };
  if (toolName === 'Bash' || toolName === 'BashOutput' || toolName === 'PowerShell') return { verb: 'запускает', icon: '⚙️' };
  if (toolName === 'Edit' || toolName === 'Write' || toolName === 'MultiEdit' || toolName === 'NotebookEdit' || toolName === 'ApplyPatch') {
    return { verb: 'пишет', icon: '✏️' };
  }
  if (toolName === 'WebFetch' || toolName === 'WebSearch' || toolName.startsWith('mcp__playwright')) {
    return { verb: 'в интернете', icon: '🌐' };
  }
  if (toolName === 'Task' || toolName === 'Agent') return { verb: 'зовёт помощника', icon: '🦀' };
  if (toolName.startsWith('mcp__')) return { verb: 'в сервисе', icon: '🔌' };
  return THINKING;
}

const TYPE_NAMES: Record<string, string> = {
  explore: 'Разведчик',
  plan: 'Планировщик',
  'general-purpose': 'Помощник',
  claude: 'Помощник',
  'statusline-setup': 'Настройщик',
};

function typeName(subagentType: unknown): string {
  if (typeof subagentType !== 'string' || !subagentType) return 'Помощник';
  const key = subagentType.toLowerCase();
  if (TYPE_NAMES[key]) return TYPE_NAMES[key];
  if (key.includes('review')) return 'Ревизор';
  if (key.includes('deploy')) return 'Выкатчик';
  if (key.includes('design') || key.includes('architect')) return 'Архитектор';
  if (key.includes('test')) return 'Тестировщик';
  return 'Помощник';
}

const CYRILLIC = /[а-яё]/i;

function parseInput(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object') return input as Record<string, unknown>;
  if (typeof input !== 'string') return {};
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * A Russian description is the crab's name as is; an English one is not shown
 * to the human — the crab is named by its kind instead («Разведчик»).
 */
export function crabBaseTitle(toolInput: unknown): string {
  const input = parseInput(toolInput);
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (description && CYRILLIC.test(description)) {
    return description.charAt(0).toUpperCase() + description.slice(1);
  }
  return typeTitle(toolInput);
}

function typeTitle(toolInput: unknown): string {
  return typeName(parseInput(toolInput).subagent_type);
}

function hasRussianTitle(toolInput: unknown): boolean {
  const description = parseInput(toolInput).description;
  return typeof description === 'string' && CYRILLIC.test(description);
}

function crabState(subagent: SubagentState, context: CrabContext, hasBackgroundEntry: boolean): CrabState {
  if (subagent.isComplete) {
    return subagent.status && subagent.status !== 'completed' ? 'failed' : 'done';
  }
  if (context.isRunActive || hasBackgroundEntry) return 'running';
  return 'lost';
}

/** One crab for one Agent/Task row; `title` is final once ordinals are applied by the squad. */
export function crabFromMessage(message: ChatMessage, context: CrabContext, now = Date.now()): Crab | null {
  const subagent = message.subagentState;
  if (!message.isSubagentContainer || !subagent) return null;

  const id = String(message.toolId || message.timestamp);
  const background = message.toolId ? context.backgroundLastTool : undefined;
  const hasBackgroundEntry = Boolean(background?.has(id));
  const state = crabState(subagent, context, hasBackgroundEntry);
  const lastChild = subagent.currentToolIndex >= 0 ? subagent.childTools[subagent.currentToolIndex] : undefined;
  const lastToolName = lastChild?.toolName ?? (hasBackgroundEntry ? background?.get(id) : undefined);

  const toolsUsed = Math.max(subagent.usage?.toolUses ?? 0, subagent.childTools.length);
  let durationMs = subagent.usage?.durationMs;
  if (durationMs === undefined && subagent.startedAt !== undefined) {
    const end = state === 'running' ? now : subagent.finishedAt;
    if (end !== undefined) durationMs = Math.max(0, end - subagent.startedAt);
  }

  return {
    id,
    title: crabBaseTitle(message.toolInput),
    tint: tintForModel(subagent.model),
    state,
    activity: state === 'running' ? activityFor(lastToolName) : null,
    toolsUsed,
    startedAt: subagent.startedAt,
    durationMs,
  };
}

/**
 * Crabs of the current turn (Agent calls after the last human message), in
 * launch order. Crabs named by kind get a number when the kind repeats:
 * «Разведчик №1», «Разведчик №2».
 */
export function buildCrabSquad(messages: readonly ChatMessage[], context: CrabContext, now = Date.now()): Crab[] {
  let start = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].type === 'user') {
      start = index + 1;
      break;
    }
  }

  const rows = messages.slice(start).filter((message) => message.isSubagentContainer && message.subagentState);
  const crabs: Crab[] = [];
  const kindTotals = new Map<string, number>();
  for (const row of rows) {
    if (hasRussianTitle(row.toolInput)) continue;
    const title = typeTitle(row.toolInput);
    kindTotals.set(title, (kindTotals.get(title) ?? 0) + 1);
  }
  const kindSeen = new Map<string, number>();
  for (const row of rows) {
    const crab = crabFromMessage(row, context, now);
    if (!crab) continue;
    if (!hasRussianTitle(row.toolInput) && (kindTotals.get(crab.title) ?? 0) > 1) {
      const ordinal = (kindSeen.get(crab.title) ?? 0) + 1;
      kindSeen.set(crab.title, ordinal);
      crab.title = `${crab.title} №${ordinal}`;
    }
    crabs.push(crab);
  }
  return crabs;
}

export type SquadSummary = {
  running: number;
  done: number;
  failed: number;
  lost: number;
  /** Wall time from the first launch to now (running) or to the slowest return. */
  spanMs: number;
};

export function squadSummary(crabs: readonly Crab[], now = Date.now()): SquadSummary {
  const summary: SquadSummary = { running: 0, done: 0, failed: 0, lost: 0, spanMs: 0 };
  let firstStart: number | undefined;
  let lastEnd: number | undefined;
  for (const crab of crabs) {
    summary[crab.state] += 1;
    if (crab.startedAt === undefined) continue;
    firstStart = firstStart === undefined ? crab.startedAt : Math.min(firstStart, crab.startedAt);
    const end = crab.state === 'running' ? now : crab.startedAt + (crab.durationMs ?? 0);
    lastEnd = lastEnd === undefined ? end : Math.max(lastEnd, end);
  }
  if (firstStart !== undefined && lastEnd !== undefined) summary.spanMs = Math.max(0, lastEnd - firstStart);
  return summary;
}

/**
 * How long, in words a human reads at a glance — never clock-like «28:10»:
 * «4 с», «3 мин 20 с», «28 мин», «1 ч 5 мин».
 */
export function formatCrabDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '';
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total} с`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return minutes > 0 ? `${hours} ч ${minutes} мин` : `${hours} ч`;
  if (minutes < 10 && seconds > 0) return `${minutes} мин ${seconds} с`;
  return `${minutes} мин`;
}

/** «1 действие», «3 действия», «14 действий». */
export function pluralActions(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} действие`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} действия`;
  return `${count} действий`;
}

/**
 * One line under a crab: «ищет · уже 3 мин», «вернулся за 28 мин · 14 действий»,
 * «вернулся с ошибкой за 5 мин», «не вернулся».
 */
export function crabStatusLine(crab: Crab, options: { withActions?: boolean } = {}): string {
  const duration = formatCrabDuration(crab.durationMs);
  let line: string;
  if (crab.state === 'running') {
    line = (crab.activity?.verb ?? CRAB_STATE_TEXT.running) + (duration ? ` · уже ${duration}` : '');
  } else if (crab.state === 'lost') {
    line = CRAB_STATE_TEXT.lost;
  } else {
    line = CRAB_STATE_TEXT[crab.state] + (duration ? ` за ${duration}` : '');
  }
  if (options.withActions && crab.state !== 'running' && crab.toolsUsed > 0) {
    line += ` · ${pluralActions(crab.toolsUsed)}`;
  }
  return line;
}

export const CRAB_STATE_TEXT: Record<CrabState, string> = {
  running: 'работает',
  done: 'вернулся',
  failed: 'вернулся с ошибкой',
  lost: 'не вернулся',
};
