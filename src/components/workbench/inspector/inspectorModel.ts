/**
 * Rows of the «Сессия» tab — pure, the same for Claude, Codex and Grok.
 * Whatever the engine or Neo3 did not report reads «неизвестно».
 */
import type { CodeStatusGit } from '../../../../shared/code-status';
import type { AttentionReason, AttentionState } from '../../attention/types';
import type { ProviderLimits } from '../../../utils/providerLimits';

export const UNKNOWN = 'неизвестно';

export type InspectorInput = {
  projectPath: string | null;
  git: CodeStatusGit | null;
  provider: string | null;
  modelLabel: string | null;
  effort: string | null;
  attention: { state: AttentionState; reason: AttentionReason } | null;
  context: ProviderLimits['context'];
  mcpNames: string[] | null;
};

export type InspectorRow = {
  id: 'folder' | 'branch' | 'engine' | 'model' | 'effort' | 'status' | 'context' | 'mcp' | 'changes';
  label: string;
  value: string;
  detail?: string;
  items?: string[];
};

const ENGINE_LABELS: Record<string, string> = { claude: 'Claude', codex: 'Codex', grok: 'Grok' };

const STATE_LABELS: Record<AttentionState, string> = {
  working: 'Работает',
  waiting: 'Ждёт ответа',
  done: 'Готово',
  failed: 'Ошибка',
};

const REASON_LABELS: Partial<Record<NonNullable<AttentionReason>, string>> = {
  plan: 'план на согласование',
  permission: 'нужно разрешение',
  interrupted: 'прервано',
  error: 'упало',
};

const tokens = (value: number) => value.toLocaleString('ru-RU').replace(/[\u00a0\u202f]/g, ' ');

function engineLabel(provider: string | null): string {
  if (!provider) return UNKNOWN;
  return ENGINE_LABELS[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

function contextRow(context: ProviderLimits['context']): Pick<InspectorRow, 'value' | 'detail'> {
  const { used, window, usedPct } = context;
  if (used === null) return { value: UNKNOWN };
  if (window === null || usedPct === null) return { value: `${tokens(used)} токенов`, detail: 'Окно модели неизвестно' };
  return { value: `${Math.round(usedPct)}% · ${tokens(used)} из ${tokens(window)} токенов` };
}

export function buildInspectorRows(input: InspectorInput): InspectorRow[] {
  const { git } = input;
  const files = git?.lists?.files ?? null;
  const reason = input.attention?.reason ? REASON_LABELS[input.attention.reason] : undefined;
  return [
    { id: 'folder', label: 'Папка', value: input.projectPath || UNKNOWN },
    {
      id: 'branch',
      label: 'Ветка',
      value: git?.branch || UNKNOWN,
      ...(git ? { detail: git.uncommitted > 0 ? `Незакоммиченных файлов: ${git.uncommitted}` : 'Всё закоммичено' } : {}),
    },
    { id: 'engine', label: 'Движок', value: engineLabel(input.provider) },
    { id: 'model', label: 'Модель', value: input.modelLabel || UNKNOWN },
    {
      id: 'effort',
      label: 'Effort',
      value: input.effort && input.effort !== 'default' ? input.effort : 'по умолчанию модели',
    },
    {
      id: 'status',
      label: 'Статус',
      value: input.attention ? STATE_LABELS[input.attention.state] : UNKNOWN,
      ...(reason ? { detail: reason } : {}),
    },
    { id: 'context', label: 'Контекст', ...contextRow(input.context) },
    {
      id: 'mcp',
      label: 'Подключения',
      value: input.mcpNames === null ? UNKNOWN : input.mcpNames.length ? input.mcpNames.join(', ') : 'Не подключены',
    },
    {
      id: 'changes',
      label: 'Изменения файлов',
      value: files === null ? UNKNOWN : files.length ? `Незакоммиченных: ${files.length}` : 'Нет незакоммиченных файлов',
      ...(files?.length ? { items: files } : {}),
    },
  ];
}
