/**
 * «Агенты»: named «employees» of the admin — a role, self-check rules
 * («Проверка результата»), an engine/model/effort, a project folder,
 * knowledge files (paths only) and a memory of rules with versions.
 *
 * The role reaches every engine the same way: a hidden `<agent_brief>` block
 * in the first message (shared/agent-brief.ts), not a system prompt.
 * A chat with an agent is an ordinary chat of its folder, started by the
 * server through the chat gateway (`access.kind:'agent'`) — status, Stop and
 * «Ждут тебя» come with it.
 *
 * Admins only (R08i): every user-scoped call refuses a teammate.
 */

import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { agentsDb, projectsDb, sessionsDb, type AgentRow, type AgentRuleRow } from '@/modules/database/index.js';
import { canAccessProject, isAdminUser } from '@/shared/project-access.js';
import type { LLMProvider } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import { buildAgentBrief, withAgentBrief } from '../../../shared/agent-brief.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export const AGENT_PROVIDERS = ['claude', 'codex', 'grok'] as const;
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export const AGENT_NAME_MAX = 40;
export const AGENT_ROLE_MAX = 8000;
export const AGENT_CHECKS_MAX = 2000;
export const AGENT_FILES_MAX = 20;
export const AGENT_RULE_MAX = 500;
export const AGENT_LIVE_RULES_MAX = 50;
export const AGENT_TASK_MAX = 50_000;

/** Engine defaults when an agent names no model (same as threads). */
export const DEFAULT_AGENT_MODELS: Record<AgentProvider, string> = {
  grok: 'grok-4.7-build-fast',
  claude: 'opus[1m]',
  codex: 'gpt-6-sol',
};
// The selection policy of new chats (src/utils/providerSelectionPolicy.ts) plus
// the local models of threads, which run on the Claude engine.
const LOCAL_AGENT_MODELS = ['local-qwen35-9b', 'local-ornith-9b'];
const CLAUDE_AGENT_MODELS = ['opus[1m]', 'sonnet[1m]', 'fable', ...LOCAL_AGENT_MODELS];
const GROK_AGENT_MODELS = ['grok-4.7', 'grok-4.7-build-fast'];
const CODEX_AGENT_MODEL = /^gpt-\d+(?:\.\d+)*-(?:astra|sol)$/;

export type AgentInput = {
  name?: unknown;
  role?: unknown;
  checks?: unknown;
  provider?: unknown;
  model?: unknown;
  effort?: unknown;
  projectPath?: unknown;
  files?: unknown;
};

export type AgentView = Omit<AgentRow, 'userId'> & { rulesVersion: number };

export type AgentRulesView = {
  /** Current memory version (Vn); 0 = nothing was ever remembered. */
  version: number;
  /** Live rules, oldest first — the order of the brief. */
  rules: Array<{ id: number; text: string; versionAdded: number; addedBy: 'user' | 'agent' }>;
  /** One entry per version, newest first. */
  history: Array<{ version: number; added?: string; removed?: string; by?: 'user' | 'agent' }>;
};

/** One run the agents module asks the chat gateway to start. */
export type AgentRunStart = {
  sessionId: string;
  userId: number;
  content: string;
  options: Record<string, unknown>;
};

/** The chat gateway's side (createAgentRunControl): true when the run was registered and started. */
export type AgentRunControl = {
  start(input: AgentRunStart): boolean;
};

export type AgentCatalogModel = { value: string; efforts: string[] };

export type AgentsDependencies = {
  /** Backend catalog of an engine ([] = unknown: the policy alone decides). */
  listModels?: (provider: AgentProvider) => Promise<AgentCatalogModel[]>;
  /** New app chat of the folder on the engine. */
  createSession?: (provider: AgentProvider, projectPath: string) => { sessionId: string } | Promise<{ sessionId: string }>;
  /** Re-sends the sidebar card of a chat. */
  broadcastUpsert?: (sessionId: string) => void;
  newId?: () => string;
};

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const TITLE_MAX = 60;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function refuse(code: string, message: string, statusCode: number): never {
  throw new AppError(message, { code, statusCode });
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

function isAgentProvider(value: string): value is AgentProvider {
  return (AGENT_PROVIDERS as readonly string[]).includes(value);
}

function isAllowedModel(provider: AgentProvider, model: string): boolean {
  if (provider === 'claude') return CLAUDE_AGENT_MODELS.includes(model);
  if (provider === 'grok') return GROK_AGENT_MODELS.includes(model);
  return CODEX_AGENT_MODEL.test(model);
}

function allowedModelsText(provider: AgentProvider, catalog: AgentCatalogModel[]): string {
  if (provider === 'claude') return CLAUDE_AGENT_MODELS.join(', ');
  if (provider === 'grok') return GROK_AGENT_MODELS.join(', ');
  return catalog.map((entry) => entry.value).filter((value) => isAllowedModel('codex', value)).join(', ') || 'семейства astra/sol';
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function defaultListModels(provider: AgentProvider): Promise<AgentCatalogModel[]> {
  try {
    const { providerModelsService } = await import('@/modules/providers/index.js');
    const result = await providerModelsService.getProviderModels(provider as LLMProvider);
    return (result.models?.OPTIONS ?? []).map((option: { value: string; effort?: { values?: Array<{ value: string }> } }) => ({
      value: option.value,
      efforts: (option.effort?.values ?? []).map((level) => level.value),
    }));
  } catch {
    return [];
  }
}

async function defaultCreateSession(provider: AgentProvider, projectPath: string): Promise<{ sessionId: string }> {
  const { sessionsService } = await import('@/modules/providers/index.js');
  return { sessionId: sessionsService.createAppSession(provider as LLMProvider, projectPath).sessionId };
}

function defaultBroadcastUpsert(sessionId: string): void {
  void import('@/modules/websocket/index.js')
    .then(({ chatRunRegistry }) => chatRunRegistry.broadcastSessionUpsert(sessionId))
    .catch(() => {});
}

function rulesView(rows: AgentRuleRow[], version: number): AgentRulesView {
  const history: AgentRulesView['history'] = [];
  for (const row of rows) {
    history.push({ version: row.versionAdded, added: row.text, by: row.addedBy });
    if (row.versionRemoved !== null) history.push({ version: row.versionRemoved, removed: row.text });
  }
  history.sort((a, b) => b.version - a.version);
  return {
    version,
    rules: rows
      .filter((row) => row.versionRemoved === null)
      .map((row) => ({ id: row.id, text: row.text, versionAdded: row.versionAdded, addedBy: row.addedBy })),
    history,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createAgentsService(dependencies: AgentsDependencies = {}) {
  const listModels = dependencies.listModels ?? defaultListModels;
  const createSession = dependencies.createSession ?? defaultCreateSession;
  const broadcastUpsert = dependencies.broadcastUpsert ?? defaultBroadcastUpsert;
  const newId = dependencies.newId ?? randomUUID;
  let runControl: AgentRunControl | null = null;

  function requireAdmin(userId: number): void {
    if (!isAdminUser({ id: userId })) refuse('ADMIN_ONLY', 'Агенты доступны только администратору', 403);
  }

  function view(row: AgentRow): AgentView {
    const { userId: _userId, ...rest } = row;
    return { ...rest, files: [...row.files], rulesVersion: agentsDb.rulesVersion(row.id) };
  }

  /** The user's own agent, or 404 (another user's agent does not exist for him). */
  function ownAgent(userId: number, agentId: unknown): AgentRow {
    requireAdmin(userId);
    const row = typeof agentId === 'string' && agentId ? agentsDb.get(agentId) : null;
    if (!row || row.userId !== userId) refuse('AGENT_NOT_FOUND', 'Такого агента нет', 404);
    return row;
  }

  function validName(userId: number, raw: unknown, selfId: string | null): string {
    const name = text(raw);
    if (!name || name.length > AGENT_NAME_MAX || CONTROL_CHARS.test(name)) {
      refuse('NAME_INVALID', `Имя агента — одна строка от 1 до ${AGENT_NAME_MAX} знаков`, 400);
    }
    const same = agentsDb.findByName(userId, name);
    if (same && same.id !== selfId) refuse('AGENT_NAME_TAKEN', `Агент «${same.name}» уже есть — выбери другое имя`, 409);
    return name;
  }

  function validRole(raw: unknown): string {
    const role = text(raw);
    if (!role || role.length > AGENT_ROLE_MAX) refuse('ROLE_INVALID', `Роль агента — от 1 до ${AGENT_ROLE_MAX} знаков`, 400);
    return role;
  }

  function validChecks(raw: unknown): string {
    const checks = text(raw);
    if (checks.length > AGENT_CHECKS_MAX) refuse('CHECKS_TOO_LONG', `«Проверка результата» — не больше ${AGENT_CHECKS_MAX} знаков`, 400);
    return checks;
  }

  function validProvider(raw: unknown): AgentProvider {
    const provider = text(raw).toLowerCase();
    if (!isAgentProvider(provider)) {
      refuse('PROVIDER_NOT_ALLOWED', `Движок агента — claude, codex или grok, а не «${provider || 'пусто'}»`, 400);
    }
    return provider;
  }

  async function validEngine(
    provider: AgentProvider,
    rawModel: unknown,
    rawEffort: unknown,
  ): Promise<{ model: string; effort: string | null }> {
    const catalog = await listModels(provider);
    const values = catalog.map((entry) => entry.value);
    let model = text(rawModel);
    if (!model) {
      const fallback = DEFAULT_AGENT_MODELS[provider];
      model = provider === 'codex' && values.length > 0 && !values.includes(fallback)
        ? values.find((value) => isAllowedModel('codex', value)) ?? fallback
        : fallback;
    }
    const inCatalog = values.length === 0 || values.includes(model) || LOCAL_AGENT_MODELS.includes(model);
    if (!isAllowedModel(provider, model) || !inCatalog) {
      refuse('MODEL_NOT_ALLOWED', `Модель «${model}» для ${provider} не разрешена. Можно: ${allowedModelsText(provider, catalog)}`, 400);
    }

    const effortText = text(rawEffort).toLowerCase();
    if (!effortText || effortText === 'default') return { model, effort: null };
    const levels = catalog.find((entry) => entry.value === model)?.efforts ?? [];
    if (!/^[a-z]{2,16}$/.test(effortText) || (levels.length > 0 && !levels.includes(effortText))) {
      refuse('EFFORT_NOT_ALLOWED', `Effort «${effortText}» для ${model} не подходит${levels.length ? `. Можно: ${levels.join(', ')}` : ''}`, 400);
    }
    return { model, effort: effortText };
  }

  /** A registered project the user may open; its stored path. */
  function validProject(userId: number, raw: unknown): string {
    const requested = text(raw);
    const project = requested ? projectsDb.getProjectPath(requested) : null;
    if (!project) refuse('PROJECT_NOT_FOUND', 'Папка агента должна быть проектом Neo3 (выбери из списка проектов)', 400);
    if (!canAccessProject({ id: userId }, project.project_id)) refuse('PROJECT_ACCESS_DENIED', 'Нет доступа к этому проекту', 403);
    return project.project_path;
  }

  /** Existing files strictly inside the folder: no «..», no symlink out. Absolute paths, without repeats. */
  async function validFiles(projectPath: string, raw: unknown): Promise<string[]> {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) refuse('FILES_INVALID', 'Файлы-знания — список путей', 400);
    if (raw.length > AGENT_FILES_MAX) refuse('TOO_MANY_FILES', `Не больше ${AGENT_FILES_MAX} файлов-знаний`, 400);
    let realProject: string;
    try {
      realProject = await realpath(projectPath);
    } catch {
      refuse('PROJECT_FOLDER_MISSING', `Папки проекта нет на диске: ${projectPath}`, 400);
    }
    const files: string[] = [];
    for (const entry of raw) {
      const requested = text(entry);
      if (!requested) refuse('FILES_INVALID', 'Пустой путь в списке файлов', 400);
      const outside = () => refuse('FILE_OUTSIDE_PROJECT', `Файл «${requested}» вне папки проекта — так нельзя`, 400);
      if (requested.split(/[\\/]+/).includes('..')) outside();
      const absolute = path.isAbsolute(requested) ? path.normalize(requested) : path.resolve(projectPath, requested);
      if (!isInside(projectPath, absolute) && !isInside(realProject, absolute)) outside();
      let real: string;
      try {
        real = await realpath(absolute);
      } catch {
        refuse('FILE_NOT_FOUND', `Файла «${requested}» нет`, 400);
      }
      if (!isInside(realProject, real)) outside();
      if (!(await stat(real)).isFile()) refuse('FILE_NOT_FOUND', `«${requested}» — не файл`, 400);
      if (!files.includes(absolute)) files.push(absolute);
    }
    return files;
  }

  function translateUnique(error: unknown, name: string): never {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      refuse('AGENT_NAME_TAKEN', `Агент «${name}» уже есть — выбери другое имя`, 409);
    }
    throw error;
  }

  // --- CRUD -------------------------------------------------------------------

  function list(userId: number): AgentView[] {
    requireAdmin(userId);
    return agentsDb.listByUser(userId).map(view);
  }

  function get(userId: number, agentId: string): AgentView {
    return view(ownAgent(userId, agentId));
  }

  async function create(userId: number, input: AgentInput): Promise<AgentView> {
    requireAdmin(userId);
    const name = validName(userId, input.name, null);
    const role = validRole(input.role);
    const checks = validChecks(input.checks);
    const provider = validProvider(input.provider);
    const { model, effort } = await validEngine(provider, input.model, input.effort);
    const projectPath = validProject(userId, input.projectPath);
    const files = await validFiles(projectPath, input.files);
    try {
      return view(agentsDb.create({ id: newId(), userId, name, role, checks, provider, model, effort, projectPath, files }));
    } catch (error) {
      return translateUnique(error, name);
    }
  }

  async function update(userId: number, agentId: string, patch: AgentInput): Promise<AgentView> {
    const current = ownAgent(userId, agentId);
    const has = (key: keyof AgentInput) => Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined;

    const name = has('name') ? validName(userId, patch.name, current.id) : current.name;
    const role = has('role') ? validRole(patch.role) : current.role;
    const checks = has('checks') ? validChecks(patch.checks) : current.checks;
    const provider = has('provider') ? validProvider(patch.provider) : current.provider as AgentProvider;
    const engineChanged = provider !== current.provider;
    // Another engine without a model named → that engine's default; effort is
    // kept only while it still fits.
    const rawModel = has('model') ? patch.model : engineChanged ? '' : current.model;
    let engine: { model: string; effort: string | null };
    if (has('effort')) {
      engine = await validEngine(provider, rawModel, patch.effort);
    } else {
      try {
        engine = await validEngine(provider, rawModel, current.effort);
      } catch (error) {
        if ((error as { code?: string }).code !== 'EFFORT_NOT_ALLOWED') throw error;
        engine = await validEngine(provider, rawModel, null);
      }
    }
    const projectPath = has('projectPath') ? validProject(userId, patch.projectPath) : current.projectPath;
    const files = has('files') || projectPath !== current.projectPath
      ? await validFiles(projectPath, has('files') ? patch.files : current.files)
      : current.files;

    try {
      const next = agentsDb.update(current.id, { name, role, checks, provider, model: engine.model, effort: engine.effort, projectPath, files });
      if (!next) refuse('AGENT_NOT_FOUND', 'Такого агента нет', 404);
      return view(next);
    } catch (error) {
      return translateUnique(error, name);
    }
  }

  function remove(userId: number, agentId: string): void {
    const agent = ownAgent(userId, agentId);
    agentsDb.delete(agent.id);
  }

  function findByName(userId: number, name: string): AgentView | null {
    requireAdmin(userId);
    const wanted = text(name);
    const row = wanted ? agentsDb.findByName(userId, wanted) : null;
    return row ? view(row) : null;
  }

  // --- memory -----------------------------------------------------------------

  function rules(userId: number, agentId: string): AgentRulesView {
    const agent = ownAgent(userId, agentId);
    return rulesView(agentsDb.listRules(agent.id), agentsDb.rulesVersion(agent.id));
  }

  function addRule(userId: number, agentId: string, ruleText: unknown, by: 'user' | 'agent'): AgentRulesView {
    const agent = ownAgent(userId, agentId);
    const value = text(ruleText);
    if (!value || value.length > AGENT_RULE_MAX) refuse('RULE_INVALID', `Правило — от 1 до ${AGENT_RULE_MAX} знаков`, 400);
    if (agentsDb.liveRuleCount(agent.id) >= AGENT_LIVE_RULES_MAX) {
      refuse('RULE_LIMIT', `У агента уже ${AGENT_LIVE_RULES_MAX} правил — удали лишние в панели «Агенты»`, 409);
    }
    agentsDb.addRule(agent.id, value, by === 'agent' ? 'agent' : 'user');
    return rules(userId, agent.id);
  }

  function removeRule(userId: number, agentId: string, ruleId: unknown): AgentRulesView {
    const agent = ownAgent(userId, agentId);
    const id = Number(ruleId);
    const removed = Number.isSafeInteger(id) ? agentsDb.removeRule(agent.id, id) : null;
    if (!removed) refuse('RULE_NOT_FOUND', 'Такого правила у агента нет', 404);
    return rules(userId, agent.id);
  }

  function briefOf(agent: AgentRow): string {
    const memory = rulesView(agentsDb.listRules(agent.id), agentsDb.rulesVersion(agent.id));
    return buildAgentBrief({
      name: agent.name,
      role: agent.role,
      checks: agent.checks,
      files: agent.files,
      rules: memory.rules,
      rulesVersion: memory.version,
    });
  }

  /** `<agent_brief>` of the agent with its current memory. */
  function briefFor(userId: number, agentId: string): string {
    return briefOf(ownAgent(userId, agentId));
  }

  // --- chat -------------------------------------------------------------------

  async function startChat(userId: number, agentId: string, task: unknown): Promise<{ sessionId: string }> {
    const agent = ownAgent(userId, agentId);
    const value = text(task);
    if (!value) refuse('TASK_REQUIRED', 'Нужна задача для агента', 400);
    if (value.length > AGENT_TASK_MAX) refuse('TASK_TOO_LONG', `Задача длиннее ${AGENT_TASK_MAX} знаков`, 400);
    if (!runControl) refuse('AGENTS_UNAVAILABLE', 'Чат с агентом сейчас недоступен: сервер ещё запускается', 503);
    // The folder may have been unregistered or closed since the agent was saved.
    validProject(userId, agent.projectPath);

    const provider = agent.provider as AgentProvider;
    const { sessionId } = await createSession(provider, agent.projectPath);
    const firstLine = value.split('\n')[0]?.trim() ?? '';
    const title = clip(`${agent.name}: ${firstLine || 'задача'}`, TITLE_MAX);
    const cleanup = () => {
      agentsDb.unlinkSession(sessionId);
      sessionsDb.deleteSessionById(sessionId);
    };
    try {
      agentsDb.linkSession(sessionId, agent.id, userId);
      sessionsDb.updateSessionCustomName(sessionId, title);
      sessionsDb.updateSessionModel(sessionId, agent.model);
      sessionsDb.updateSessionEffort(sessionId, agent.effort);
    } catch (error) {
      cleanup();
      throw error;
    }

    const options: Record<string, unknown> = { model: agent.model, projectPath: agent.projectPath };
    if (agent.effort) options.effort = agent.effort;
    let started = false;
    try {
      started = runControl.start({ sessionId, userId, content: withAgentBrief(briefOf(agent), value), options });
    } catch (error) {
      console.error('[Agents] Chat run failed to start', { sessionId, error: error instanceof Error ? error.message : String(error) });
    }
    if (!started) {
      cleanup();
      refuse('RUN_NOT_STARTED', 'Чат создан, но прогон не запустился — попробуй ещё раз', 500);
    }
    broadcastUpsert(sessionId);
    return { sessionId };
  }

  /** Agent of a chat (chat, thread or queue item), or null. Access is the caller's check. */
  function agentOfSession(sessionId: string): { id: string; name: string } | null {
    const row = sessionId ? agentsDb.agentOfSession(sessionId) : null;
    return row ? { id: row.id, name: row.name } : null;
  }

  return {
    list,
    get,
    create,
    update,
    remove,
    findByName,
    rules,
    addRule,
    removeRule,
    briefFor,
    startChat,
    agentOfSession,
    setRunControl(control: AgentRunControl): void {
      runControl = control;
    },
  };
}

export type AgentsService = ReturnType<typeof createAgentsService>;

export const agentsService: AgentsService = createAgentsService();
