export { createDoctor } from '@/modules/diagnostics/doctor.js';
export { createSkillDoctor } from '@/modules/diagnostics/skill-doctor.js';
export { createAdvisor, buildAdvisorPrompt, ADVISOR_MODEL } from '@/modules/diagnostics/advisor.service.js';
export { createDiagnosticsRouter, createDefaultDiagnostics, diagnosticsRoutes } from '@/modules/diagnostics/diagnostics.routes.js';
export type { DiagnosticsApi } from '@/modules/diagnostics/diagnostics.routes.js';
export type {
  CheckStatus,
  DiagExec,
  DiagFs,
  DoctorCheck,
  DoctorReport,
  SkillIssue,
  SkillReport,
} from '@/modules/diagnostics/diagnostics.types.js';

import { createDefaultDiagnostics } from '@/modules/diagnostics/diagnostics.routes.js';

let shared: ReturnType<typeof createDefaultDiagnostics> | null = null;
function defaults() {
  return (shared ??= createDefaultDiagnostics());
}

/** Real-environment reports, for callers outside the module (slash commands). */
export const runDoctor = () => defaults().runDoctor();
export const runSkillDoctor = () => defaults().runSkillDoctor();
