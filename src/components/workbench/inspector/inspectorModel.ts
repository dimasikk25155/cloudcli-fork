/**
 * Rows of the «Сессия» tab — pure, the same for Claude, Codex and Grok.
 * Whatever the engine or Neo3 did not report reads «неизвестно».
 */
import type { CodeStatusGit } from '../../../../shared/code-status';
import type { AttentionReason, AttentionState } from '../../attention/types';
import type { ChatMessage } from '../../chat/types/types';
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
  /** Files the agent changed in the last turn (`turnFileChanges`); null — not known. */
  turnFiles?: string[] | null;
};

export type InspectorRow = {
  id: 'folder' | 'branch' | 'engine' | 'model' | 'effort' | 'status' | 'context' | 'mcp' | 'turn' | 'changes';
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
  const turnFiles = input.turnFiles;
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
      id: 'turn',
      label: 'Изменения хода',
      value: turnFiles == null ? UNKNOWN : turnFiles.length ? `Файлов: ${turnFiles.length}` : 'В этом ходе файлы не менялись',
      ...(turnFiles?.length ? { items: turnFiles } : {}),
    },
    {
      id: 'changes',
      label: 'Рабочая копия',
      value: files === null ? UNKNOWN : files.length ? `Незакоммиченных: ${files.length}` : 'Нет незакоммиченных файлов',
    },
  ];
}

// Tools that change files, by engine, and where each keeps the path.
const CLAUDE_FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const GROK_FILE_TOOLS = new Set(['search_replace', 'write', 'write_file', 'edit_file', 'create_file']);
const CODEX_FILE_TOOL = 'FileChanges';

function parseToolInput(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

const pathOf = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

function codexChangePaths(input: unknown): string[] {
  // History: `{changes: [{kind, path, moveTo?}], patch}`; live stream: the array itself.
  const changes = Array.isArray(input) ? input : (input as { changes?: unknown } | null)?.changes;
  if (!Array.isArray(changes)) return [];
  const paths: string[] = [];
  for (const change of changes) {
    if (!change || typeof change !== 'object') continue;
    const entry = change as Record<string, unknown>;
    for (const candidate of [entry.path, entry.moveTo, entry.move_path]) {
      const path = pathOf(candidate);
      if (path) paths.push(path);
    }
  }
  return paths;
}

function changedPaths(message: ChatMessage): string[] {
  const name = message.toolName;
  if (!message.isToolUse || !name) return [];
  const input = parseToolInput(message.toolInput);
  if (name === CODEX_FILE_TOOL) return codexChangePaths(input);
  if (!CLAUDE_FILE_TOOLS.has(name) && !GROK_FILE_TOOLS.has(name)) return [];
  if (!input || typeof input !== 'object') return [];
  const fields = input as Record<string, unknown>;
  const path = pathOf(fields.file_path) ?? pathOf(fields.notebook_path) ?? pathOf(fields.path) ?? pathOf(fields.target_file);
  return path ? [path] : [];
}

/**
 * Files the agent changed in the current turn — since the last user message —
 * from the tool calls of Claude (Edit/Write/MultiEdit/NotebookEdit), Codex
 * (FileChanges, both shapes) and Grok (search_replace/write…). Unique, in order.
 */
export function turnFileChanges(messages: readonly ChatMessage[]): string[] {
  let start = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.type === 'user') {
      start = index + 1;
      break;
    }
  }
  const seen = new Set<string>();
  for (const message of messages.slice(start)) {
    for (const path of changedPaths(message)) seen.add(path);
  }
  return [...seen];
}
