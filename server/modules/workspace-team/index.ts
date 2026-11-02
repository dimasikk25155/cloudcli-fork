import type { WorkspaceDependencies } from '../agent-workspace/index.js';

import { createIntake } from './intake.js';
import { createAssignments, registerTeamHandoff } from './service.js';
export { registerTeamHandoff } from './service.js';
export function createTeamService(deps:WorkspaceDependencies) { registerTeamHandoff(deps);return {...createAssignments(deps),...createIntake(deps)}; }

export { createTeamRouter, createPublicIntakeRouter } from './routes.js';
