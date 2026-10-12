/**
 * «Где мой код»: контракт `GET /api/projects/:projectId/code-status`.
 * Единственное место типа — сервер (`server/modules/code-status`) и клиент
 * (`src/components/code-status`) импортируют его отсюда.
 */
export type CodeStatusGit = {
  branch: string;
  /** Фактическая основная ветка (`main`, `master` или цель `origin/HEAD`); null — не нашлась. */
  mainBranch: string | null;
  uncommitted: number;
  notInMain: number;
  unpushed: number;
  hasRemote: boolean;
  lists?: { files: string[]; notInMain: string[]; unpushed: string[] };
};

export type CodeStatusSite = {
  kind: 'vercel' | 'registry';
  url: string | null;
  state: 'fresh' | 'stale' | 'up' | 'down' | 'unknown';
  deployedAt?: string;
  sha?: string;
  previewUrl?: string | null;
};

export type CodeStatus = {
  git: null | CodeStatusGit;
  site: null | CodeStatusSite;
  checkedAt: string;
};
