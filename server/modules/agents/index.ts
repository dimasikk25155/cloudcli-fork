export {
  AGENT_CHECKS_MAX,
  AGENT_FILES_MAX,
  AGENT_LIVE_RULES_MAX,
  AGENT_NAME_MAX,
  AGENT_PROVIDERS,
  AGENT_ROLE_MAX,
  AGENT_RULE_MAX,
  AGENT_TASK_MAX,
  agentsService,
  createAgentsService,
  DEFAULT_AGENT_MODELS,
} from '@/modules/agents/agents.service.js';
export type {
  AgentCatalogModel,
  AgentInput,
  AgentProvider,
  AgentRulesView,
  AgentRunControl,
  AgentRunStart,
  AgentsDependencies,
  AgentsService,
  AgentView,
} from '@/modules/agents/agents.service.js';
export { createAgentsRouter, default as agentsRoutes } from '@/modules/agents/agents.routes.js';
export type { AgentsRouterOptions } from '@/modules/agents/agents.routes.js';
