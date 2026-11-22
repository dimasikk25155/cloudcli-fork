import { userDb } from '@/modules/database/index.js';
import { teamTelegram } from '@/modules/team-telegram/index.js';
import { createTeamKieRoutes } from '@/modules/team-kie/team-kie.routes.js';
import { createTeamKie } from '@/modules/team-kie/team-kie.service.js';

export {
  createTeamKie,
  DEFAULT_DAILY_CREDITS,
  KIE_APIS,
  moscowDay,
  readKieKey,
  TEAM_KIE_NOT_ALLOWED,
  TEAM_KIE_TOOL_DEFS,
  teamKieUrl,
} from '@/modules/team-kie/team-kie.service.js';
export type { TeamKie, TeamKieConfig, TeamKieGrant, TeamKieLedger } from '@/modules/team-kie/team-kie.service.js';
export { createTeamKieRoutes } from '@/modules/team-kie/team-kie.routes.js';

/** The run's team token (issued with team-telegram's) opens Kie for allowed teammates. */
export const teamKie = createTeamKie({
  grantFor: (token) => teamTelegram.grantFor(token),
  usernameOf: (userId) => userDb.getUserById(userId)?.username ?? null,
});

export const teamKieRoutes = createTeamKieRoutes(teamKie);
