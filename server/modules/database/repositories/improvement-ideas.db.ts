import { getConnection } from '@/modules/database/connection.js';

import type { ImprovementIdeaStatus } from '../../../../shared/improvement-ideas.js';

export type IdeaRow = {
  id: number; user_id: number; session_id: string; project_path: string;
  fingerprint: string; text: string; status: ImprovementIdeaStatus;
  created_at: string; updated_at: string; vault_path: string | null; vault_error: string | null;
};
export const improvementIdeasDb = {
  insert(row: Pick<IdeaRow, 'user_id' | 'session_id' | 'project_path' | 'fingerprint' | 'text'>, now: string) {
    getConnection().prepare(`INSERT OR IGNORE INTO improvement_ideas
      (user_id,session_id,project_path,fingerprint,text,created_at,updated_at) VALUES (@user_id,@session_id,@project_path,@fingerprint,@text,@now,@now)`)
      .run({ ...row, now });
  },
  get(id: number): IdeaRow | undefined { return getConnection().prepare('SELECT * FROM improvement_ideas WHERE id=?').get(id) as IdeaRow | undefined; },
  list(userId: number, projectPath?: string): IdeaRow[] {
    return (projectPath
      ? getConnection().prepare('SELECT * FROM improvement_ideas WHERE user_id=? AND project_path=? ORDER BY id DESC').all(userId, projectPath)
      : getConnection().prepare('SELECT * FROM improvement_ideas WHERE user_id=? ORDER BY id DESC').all(userId)) as IdeaRow[];
  },
  transition(id: number, from: ImprovementIdeaStatus, to: ImprovementIdeaStatus): boolean {
    return getConnection().prepare('UPDATE improvement_ideas SET status=?,updated_at=? WHERE id=? AND status=?')
      .run(to, new Date().toISOString(), id, from).changes === 1;
  },
  synced(userId: number, projectPath: string, relativePath: string | null, error: string | null) {
    getConnection().prepare('UPDATE improvement_ideas SET vault_path=?,vault_error=? WHERE user_id=? AND project_path=?')
      .run(relativePath, error, userId, projectPath);
  },
};
