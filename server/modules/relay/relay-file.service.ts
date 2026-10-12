import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { sessionsDb } from '@/modules/database/index.js';
import { canAccessSession, type ProjectAccessUser } from '@/shared/project-access.js';
import { AppError } from '@/shared/utils.js';

export type RelayFileResult = { ok: true; absPath: string };

function refused(message: string, code: string, statusCode: number): never {
  throw new AppError(message, { code, statusCode });
}

/** True when `candidate` is `root` itself or lies under it. */
function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Checks the handoff note an agent named for a relay: it must be an existing
 * regular file strictly inside the chat's project. Relative paths are taken
 * from the project root. Any `..` segment is refused outright, and the check
 * runs on real paths, so a symlink inside the project that points outside is
 * refused too. Returns the path as resolved against the project (not the
 * symlink-free one), which is what the next chat is told to read.
 *
 * Refusals (AppError): 404 SESSION_NOT_FOUND, 403 SESSION_ACCESS_DENIED,
 * 400 RELAY_PATH_INVALID (empty / not a string / `..` / NUL),
 * 400 RELAY_NO_PROJECT, 400 RELAY_PATH_OUTSIDE_PROJECT, 404 RELAY_FILE_NOT_FOUND.
 */
export async function resolveRelayFile({ sessionId, requestedPath, user }: {
  sessionId: string;
  requestedPath: unknown;
  user: ProjectAccessUser;
}): Promise<RelayFileResult> {
  const session = sessionsDb.getSessionById(sessionId);
  if (!session) refused('Чат не найден', 'SESSION_NOT_FOUND', 404);
  if (!canAccessSession(user, sessionId)) refused('Нет доступа к чату', 'SESSION_ACCESS_DENIED', 403);

  const raw = typeof requestedPath === 'string' ? requestedPath.trim() : '';
  if (!raw || raw.includes('\0')) refused('Не указан путь к записке', 'RELAY_PATH_INVALID', 400);
  if (raw.split(/[\\/]+/).includes('..')) {
    refused('Путь к записке не должен содержать «..»', 'RELAY_PATH_INVALID', 400);
  }

  const projectPath = session.project_path;
  if (!projectPath) refused('У чата нет папки проекта', 'RELAY_NO_PROJECT', 400);

  const candidate = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(projectPath, raw);

  let realProject: string;
  let realCandidate: string;
  try {
    realProject = await realpath(projectPath);
  } catch {
    refused('Папка проекта не найдена', 'RELAY_NO_PROJECT', 400);
  }
  try {
    realCandidate = await realpath(candidate);
  } catch {
    if (!isInside(realProject, candidate) && !isInside(path.resolve(projectPath), candidate)) {
      refused('Записка лежит вне проекта', 'RELAY_PATH_OUTSIDE_PROJECT', 400);
    }
    refused(`Записка не найдена: ${raw}`, 'RELAY_FILE_NOT_FOUND', 404);
  }
  if (!isInside(realProject, realCandidate)) {
    refused('Записка лежит вне проекта', 'RELAY_PATH_OUTSIDE_PROJECT', 400);
  }
  const info = await stat(realCandidate);
  if (!info.isFile()) refused(`Записка не найдена: ${raw}`, 'RELAY_FILE_NOT_FOUND', 404);

  return { ok: true, absPath: candidate };
}
