import type { ProviderModelsDefinition } from '../../types/app';
import {
  SELECTABLE_MODEL_FALLBACKS,
  SELECTABLE_PROVIDERS,
  selectableModels,
  type SelectableProvider,
} from '../../utils/providerSelectionPolicy';

// Панель «Агенты»: чистые правила, которые видит человек. Данные приходят с
// /api/agents (server/modules/agents); списки движков и моделей — только из
// providerSelectionPolicy, своих списков здесь нет.

export type AgentProvider = SelectableProvider;

export const AGENT_NAME_MAX = 40;
export const AGENT_CHECKS_MAX = 2000;
export const AGENT_ROLE_MAX = 8000;

export const PROVIDER_LABELS: Record<AgentProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  grok: 'Grok',
};

export const PROVIDERS: readonly AgentProvider[] = SELECTABLE_PROVIDERS;

export type AgentItem = {
  id: string;
  name: string;
  role: string;
  checks: string;
  provider: AgentProvider;
  model: string;
  effort: string | null;
  projectPath: string;
  files: string[];
  rulesVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type AgentRule = { id: number; text: string; versionAdded: number; addedBy: 'user' | 'agent' };
export type AgentHistoryEntry = { version: number; added?: string; removed?: string; by?: 'user' | 'agent' };
export type AgentRules = { version: number; rules: AgentRule[]; history: AgentHistoryEntry[] };

export type AgentForm = {
  name: string;
  role: string;
  checks: string;
  provider: AgentProvider;
  model: string;
  effort: string;
  projectPath: string;
  /** Файлы-знания: по пути в строке. */
  filesText: string;
};

export type FormField = 'name' | 'role' | 'checks' | 'provider' | 'model' | 'effort' | 'projectPath' | 'files';
export type FormErrors = Partial<Record<FormField, string>>;

export type AgentPayload = {
  name: string;
  role: string;
  checks: string;
  provider: AgentProvider;
  model: string;
  effort: string | null;
  projectPath: string;
  files: string[];
};

export type ModelChoice = { value: string; label: string };

/** Модели движка: только разрешённые политикой; нет каталога — одна модель по умолчанию. */
export function modelChoices(provider: AgentProvider, definition?: ProviderModelsDefinition | null): ModelChoice[] {
  const options = selectableModels(provider, definition);
  if (options.length === 0) {
    const value = SELECTABLE_MODEL_FALLBACKS[provider];
    return [{ value, label: value }];
  }
  return options.map((option) => ({ value: option.value, label: option.label || option.value }));
}

/** Уровни effort выбранной модели; без каталога или у модели без уровней — пусто. */
export function effortChoices(
  provider: AgentProvider,
  model: string,
  definition?: ProviderModelsDefinition | null,
): string[] {
  const option = selectableModels(provider, definition).find((candidate) => candidate.value === model);
  return (option?.effort?.values ?? []).map((level) => level.value);
}

export function filesFromText(text: string): string[] {
  const seen = new Set<string>();
  for (const line of text.split('\n')) {
    const path = line.trim();
    if (path) seen.add(path);
  }
  return [...seen];
}

export function emptyForm(defaultProject: string): AgentForm {
  return {
    name: '',
    role: '',
    checks: '',
    provider: 'claude',
    model: SELECTABLE_MODEL_FALLBACKS.claude,
    effort: '',
    projectPath: defaultProject,
    filesText: '',
  };
}

export function formFromAgent(agent: AgentItem): AgentForm {
  return {
    name: agent.name,
    role: agent.role,
    checks: agent.checks,
    provider: agent.provider,
    model: agent.model,
    effort: agent.effort ?? '',
    projectPath: agent.projectPath,
    filesText: agent.files.join('\n'),
  };
}

export function toPayload(form: AgentForm): AgentPayload {
  return {
    name: form.name.trim(),
    role: form.role.trim(),
    checks: form.checks.trim(),
    provider: form.provider,
    model: form.model,
    effort: form.effort || null,
    projectPath: form.projectPath,
    files: filesFromText(form.filesText),
  };
}

/** Быстрая проверка до запроса; полную делает сервер, его ответы приходят тем же видом. */
export function validateForm(form: AgentForm): FormErrors {
  const errors: FormErrors = {};
  const name = form.name.trim();
  if (!name) errors.name = 'Впиши имя агента';
  else if (name.length > AGENT_NAME_MAX) errors.name = `Имя — не длиннее ${AGENT_NAME_MAX} знаков`;
  const role = form.role.trim();
  if (!role) errors.role = 'Опиши роль: что агент делает и как';
  else if (role.length > AGENT_ROLE_MAX) errors.role = `Роль — не длиннее ${AGENT_ROLE_MAX} знаков`;
  if (form.checks.trim().length > AGENT_CHECKS_MAX) errors.checks = `Проверка результата — не длиннее ${AGENT_CHECKS_MAX} знаков`;
  if (!form.projectPath) errors.projectPath = 'Выбери папку проекта';
  return errors;
}

const FIELD_OF_CODE: Record<string, FormField> = {
  NAME_INVALID: 'name',
  AGENT_NAME_TAKEN: 'name',
  ROLE_INVALID: 'role',
  CHECKS_TOO_LONG: 'checks',
  PROVIDER_NOT_ALLOWED: 'provider',
  MODEL_NOT_ALLOWED: 'model',
  EFFORT_NOT_ALLOWED: 'effort',
  PROJECT_NOT_FOUND: 'projectPath',
  PROJECT_ACCESS_DENIED: 'projectPath',
  PROJECT_FOLDER_MISSING: 'projectPath',
  FILES_INVALID: 'files',
  TOO_MANY_FILES: 'files',
  FILE_OUTSIDE_PROJECT: 'files',
  FILE_NOT_FOUND: 'files',
};

/** К какому полю формы относится ошибка сервера; null — общая ошибка над формой. */
export function fieldOfErrorCode(code: string | undefined | null): FormField | null {
  return (code && FIELD_OF_CODE[code]) || null;
}

export function versionLabel(version: number): string {
  return version > 0 ? `V${version}` : 'пусто';
}

export function ruleOrigin(by: 'user' | 'agent'): string {
  return by === 'agent' ? 'добавил агент' : 'добавил ты';
}

export function historyLine(entry: AgentHistoryEntry): string {
  if (entry.removed !== undefined) return `V${entry.version} · убрано: ${entry.removed}`;
  const who = entry.by === 'agent' ? ' (агентом)' : '';
  return `V${entry.version} · добавлено${who}: ${entry.added ?? ''}`;
}

export function canStartChat(task: string): boolean {
  return task.trim().length > 0;
}

/** Первая строка роли для списка. */
export function roleSummary(role: string): string {
  const first = role.split('\n')[0]?.trim() ?? '';
  return first.length > 100 ? first.slice(0, 100) : first;
}
