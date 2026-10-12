import type { CodeStatus } from '../../../shared/code-status.js';

export type { CodeStatus, CodeStatusGit, CodeStatusSite } from '../../../shared/code-status.js';

export type CodeStatusOptions = {
  isAdmin: boolean;
  /** Мимо 60-секундного кэша (кнопка «обновить»). */
  refresh?: boolean;
};

export type CodeStatusFetch = (url: string, init?: { headers?: Record<string, string>; method?: string; signal?: AbortSignal; redirect?: 'follow' }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  body?: { cancel?: () => Promise<void> } | null;
}>;

export type CodeStatusDependencies = {
  /** Подмена сети в тестах; по умолчанию глобальный fetch. */
  fetchImpl?: CodeStatusFetch;
  /** Файл секретов с `VERCEL_TOKEN=`; по умолчанию `NEO3_SECRETS_FILE` или `~/Antigravity Project/.secrets.env`. */
  secretsFile?: string;
  /** Реестр сайтов deploy-verify; по умолчанию `NEO3_SITES_REGISTRY` или `~/.claude/skills/deploy-verify/sites.yaml`. */
  registryFile?: string;
  cacheMs?: number;
  now?: () => number;
};

export type CodeStatusService = {
  getCodeStatus: (projectPath: string, options: CodeStatusOptions) => Promise<CodeStatus>;
};
