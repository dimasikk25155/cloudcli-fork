import { authenticatedFetch } from './api';

/**
 * What GET /api/usage/project-stats reports for one project: how big it is on
 * disk and how much work with Claude went into it. Replaces the external
 * `project-stats` plugin — the numbers now come from the same modules the
 * token dashboard uses, so rates can't drift apart.
 */
export type ProjectStats = {
  name: string;
  path: string;
  files: number;
  lines: number;
  bytes: number;
  languages: { ext: string; files: number; lines: number }[];
  sessions: number;
  tokens: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  lastActivity: string | null;
  /** Scan hit its file cap: numbers are a floor, and the UI must say so. */
  truncated: boolean;
};

export async function fetchProjectStats(projectPath: string): Promise<ProjectStats> {
  const response = await authenticatedFetch(
    `/api/usage/project-stats?path=${encodeURIComponent(projectPath)}`,
  );
  if (!response.ok) {
    throw new Error(`Project stats request failed (${response.status})`);
  }
  const data = await response.json();
  if (!data?.ok || !data.stats) {
    throw new Error(data?.error || 'Project stats unavailable');
  }
  return data.stats as ProjectStats;
}

/** Bytes as a human reads them: 850 КБ, 12.4 МБ, 1.2 ГБ. */
export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** power;
  const digits = power === 0 || scaled >= 100 ? 0 : 1;
  return `${scaled.toFixed(digits)} ${units[power]}`;
}

/** Plain counts with thin spaces, so 128345 reads as 128 345. */
export function formatCount(value: number): string {
  return new Intl.NumberFormat('ru-RU').format(Math.round(value));
}
