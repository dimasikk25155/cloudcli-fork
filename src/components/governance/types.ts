// Формы ответов /api/governance. Поля приходят в snake_case как в таблице —
// переименовывать их на сервере значило бы держать два словаря вместо одного.

export type AuditEventRow = {
  id: number;
  ts: string;
  day_msk: string;
  user_id: number | null;
  actor: string;
  project_id: string | null;
  project_path: string | null;
  session_id: string | null;
  run_id: string | null;
  event: string;
  provider: string | null;
  model: string | null;
  tool_name: string | null;
  detail: string;
  outcome: string | null;
  tokens_in: number;
  tokens_out: number;
  cache_read: number;
  cost_micro_usd: number;
  duration_ms: number | null;
  /** Доллары, посчитанные сервером из cost_micro_usd. */
  usd: number;
};

export type SpendWindow = {
  usd: number;
  tokensIn: number;
  tokensOut: number;
  runs: number;
};

export type RunCostSummary = {
  runId: string | null;
  ts: string;
  actor: string;
  projectPath: string | null;
  model: string | null;
  provider: string | null;
  usd: number;
  tokensIn: number;
  tokensOut: number;
  outcome: string | null;
};

export type ProjectSpend = {
  projectId: string | null;
  projectPath: string | null;
  usd: number;
  tokensIn: number;
  tokensOut: number;
  runs: number;
};

export type SpendSummary = {
  day: string;
  today: SpendWindow;
  week: SpendWindow;
  topRuns: RunCostSummary[];
  byProject: ProjectSpend[];
};

/** Кто запустил прогон — по-русски, для ленты. */
export const ACTOR_LABELS: Record<string, string> = {
  user: 'вручную',
  schedule: 'расписание',
  pipeline: 'сценарий',
  telegram: 'Telegram',
  api: 'внешний вызов',
  'git-helper': 'коммит-сообщение',
  system: 'система',
};

export const EVENT_LABELS: Record<string, string> = {
  'run.start': 'старт',
  'run.finish': 'завершён',
  'run.error': 'ошибка',
  'perm.requested': 'запрос прав',
  'perm.approved': 'права выданы',
  'perm.denied': 'права отклонены',
  'perm.expired': 'запрос прав истёк',
};

export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd === 0) return '$0';
  // Дешёвые прогоны стоят десятые доли цента — округление до центов
  // превратило бы весь день в «$0.00» и убило бы смысл колонки.
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(count: number): string {
  if (!Number.isFinite(count) || count === 0) return '0';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

export function formatMoscowTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function projectName(fullPath: string | null): string {
  if (!fullPath) return '—';
  const parts = fullPath.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? fullPath;
}
