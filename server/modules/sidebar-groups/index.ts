/**
 * Группы проектов и чатов в сайдбаре и закрепы чатов (мод «Группы и закрепы»).
 * Смонтировано в `server/index.js` (`/api/sidebar-groups`, authenticateToken).
 * Агентам — `workspace_action` `group.*` / `pin.set` (`agent-workspace/tools.ts`):
 * только упорядочивание, без удаления.
 */
import { createSidebarGroupsRouter } from './sidebar-groups.routes.js';
import { getSidebarGroupsService } from './sidebar-groups.runtime.js';

export { createSidebarGroupsService } from './sidebar-groups.service.js';
export type { SidebarGroupsService, SidebarGroupsDependencies, SidebarGroupsRepo } from './sidebar-groups.service.js';
export { createSidebarGroupsRouter } from './sidebar-groups.routes.js';
export { getSidebarGroupsService } from './sidebar-groups.runtime.js';

export const sidebarGroupsRoutes = createSidebarGroupsRouter(getSidebarGroupsService);
