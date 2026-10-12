export {
  assertCanLinkNewChild,
  getSessionLinks,
  linkSession,
  linksForSessions,
  linksForRows,
  linksOfRow,
  relatedSessionIds,
} from '@/modules/session-links/session-links.service.js';
export type { LinkSessionInput } from '@/modules/session-links/session-links.service.js';
export { default as sessionLinksRoutes } from '@/modules/session-links/session-links.routes.js';
export {
  SESSION_RELATIONS,
  isSessionRelation,
} from '../../../shared/session-links.js';
export type { SessionLinkRef, SessionLinks, SessionRelation } from '../../../shared/session-links.js';
