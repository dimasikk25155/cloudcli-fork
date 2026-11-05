export {
  AGENT_GONE_REASON,
  buildQueueTask,
  createAgentQueueService,
  normalizeTemplate,
  QUEUE_ATTEMPTS_MAX,
  QUEUE_EXCERPT_MAX,
  QUEUE_ITEM_MAX_CHARS,
  QUEUE_ITEM_PLACEHOLDER,
  QUEUE_ITEMS_MAX,
  QUEUE_PARALLEL_MAX,
  QUEUE_TEMPLATE_MAX_CHARS,
  QUEUES_IN_WORK_MAX,
  RESTART_REASON,
} from '@/modules/agent-queue/agent-queue.service.js';
export type {
  AgentQueueAgents,
  AgentQueueDependencies,
  AgentQueueService,
  QueueInput,
  QueueItemView,
  QueueNotice,
  QueueRunInput,
  QueueRunResult,
  QueueSummary,
  QueueView,
} from '@/modules/agent-queue/agent-queue.service.js';
export { createAgentQueueRouter } from '@/modules/agent-queue/agent-queue.routes.js';
export type { AgentQueueRouterOptions } from '@/modules/agent-queue/agent-queue.routes.js';
export {
  agentQueueRoutes,
  agentQueueService,
  QUEUE_NOTICE_CODE,
  startAgentQueueWatch,
  stopAgentQueueWatch,
} from '@/modules/agent-queue/agent-queue.runtime.js';
