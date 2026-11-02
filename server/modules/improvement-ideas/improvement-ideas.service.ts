import { createHash } from 'node:crypto';
import path from 'node:path';

import { sessionsDb } from '@/modules/database/index.js';
import { improvementIdeasDb, type IdeaRow } from '@/modules/database/index.js';
import { vaultDir } from '@/modules/memory-suggestions/index.js';
import { isAdminUser, canUserAccessSession } from '@/shared/project-access.js';
import { isModOn } from '@/shared/mods.js';

import { detectSecrets } from '../../../shared/secret-detect.js';
import type { ImprovementIdea } from '../../../shared/improvement-ideas.js';

import { extractImprovementIdeas } from './idea-parser.js';
import { writeIdeasVault } from './idea-vault.js';

export type IdeaRunControl = { start(input: { sessionId: string; userId: number; content: string }): boolean };
export class IdeaError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}
const item = (row: IdeaRow): ImprovementIdea => ({
  id: row.id, sessionId: row.session_id, projectName: path.basename(row.project_path), text: row.text,
  status: row.status, createdAt: row.created_at, vaultPath: row.vault_path, vaultError: row.vault_error,
});
export function createImprovementIdeasService(deps: {
  vaultDir?: () => string;
  enabled?: (userId: number) => boolean;
  writeVault?: typeof writeIdeasVault;
} = {}) {
  let control: IdeaRunControl | null = null;
  const locks = new Map<string, Promise<void>>();
  const enabled = deps.enabled ?? (userId => isModOn(userId, 'modImprovementIdeas'));
  function check(userId: number, sessionId: string) {
    if (!isAdminUser({ id: userId }) || !canUserAccessSession({ id: userId }, sessionId)) throw new IdeaError(403, 'Нет доступа к идеям этого чата');
    if (!enabled(userId)) throw new IdeaError(409, 'Мод «Идеи улучшений» выключен');
  }
  function owned(userId: number, id: number): IdeaRow {
    const row = improvementIdeasDb.get(id);
    if (!row || row.user_id !== userId) throw new IdeaError(404, 'Идея не найдена');
    check(userId, row.session_id);
    return row;
  }
  async function syncProject(userId: number, projectPath: string) {
    const key = `${userId}:${projectPath}`;
    const previous = locks.get(key) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      try {
        const relative = await (deps.writeVault ?? writeIdeasVault)((deps.vaultDir ?? vaultDir)(), projectPath, userId, improvementIdeasDb.list(userId, projectPath));
        improvementIdeasDb.synced(userId, projectPath, relative, null);
      } catch {
        improvementIdeasDb.synced(userId, projectPath, null, 'Не удалось обновить Obsidian. Идеи сохранены в Neo3.');
      }
    });
    locks.set(key, task);
    await task;
    if (locks.get(key) === task) locks.delete(key);
  }
  return {
    setRunControl(value: IdeaRunControl) { control = value; },
    async capture(sessionId: string, actor: string | number | null, texts: string[]) {
      const userId = Number(actor);
      if (!Number.isSafeInteger(userId) || userId <= 0) return;
      try { check(userId, sessionId); } catch { return; }
      const session = sessionsDb.getSessionById(sessionId);
      const projectPath = session?.project_path;
      if (!projectPath || detectSecrets(projectPath).length) return;
      let count = 0;
      for (const text of texts) for (const suggestion of extractImprovementIdeas(text)) {
        if (detectSecrets(suggestion).length) continue;
        const fingerprint = createHash('sha256').update(suggestion.toLocaleLowerCase('ru').replace(/\s+/g, ' ').trim()).digest('hex');
        improvementIdeasDb.insert({ user_id: userId, session_id: sessionId, project_path: projectPath, fingerprint, text: suggestion }, new Date().toISOString());
        count++;
      }
      if (count) await syncProject(userId, projectPath);
    },
    list(userId: number, sessionId: string): ImprovementIdea[] {
      check(userId, sessionId);
      const projectPath = sessionsDb.getSessionById(sessionId)?.project_path;
      if (!projectPath) return [];
      return improvementIdeasDb.list(userId, projectPath).filter(row => canUserAccessSession({ id: userId }, row.session_id)).map(item);
    },
    async sync(userId: number, id: number) {
      const row = owned(userId, id);
      await syncProject(userId, row.project_path);
      return item(improvementIdeasDb.get(id)!);
    },
    async decide(userId: number, id: number, action: 'implement' | 'later') {
      const row = owned(userId, id);
      if (row.status === 'started' || row.status === 'starting') return item(row);
      if (action === 'later') {
        improvementIdeasDb.transition(id, row.status, 'later');
      } else {
        if (!control) throw new IdeaError(503, 'Запуск пока недоступен');
        if (!improvementIdeasDb.transition(id, row.status, 'starting')) return item(improvementIdeasDb.get(id)!);
        try {
          const started = control.start({ sessionId: row.session_id, userId, content: `Пользователь нажал «Реализовать» для идеи №${row.id} и одобрил её выполнение сейчас. Реализуй и проверь эту конкретную идею в текущем проекте. Сохрани все ранее согласованные ограничения, бюджет, дату и часовой пояс; не расширяй разрешения на публикацию, оплату или удаление. Повторное подтверждение самой идеи не требуется.\n\nИдея:\n${row.text}` });
          if (!started) throw new IdeaError(409, 'Чат занят или запуск отклонён. Повтори после завершения текущей работы.');
          improvementIdeasDb.transition(id, 'starting', 'started');
        } catch (error) {
          improvementIdeasDb.transition(id, 'starting', row.status);
          if (error instanceof IdeaError) throw error;
          throw new IdeaError(409, 'Не удалось начать работу. Идея сохранена.');
        }
      }
      await syncProject(userId, row.project_path);
      return item(improvementIdeasDb.get(id)!);
    },
  };
}
export const improvementIdeas = createImprovementIdeasService();
export type ImprovementIdeasService = ReturnType<typeof createImprovementIdeasService>;
