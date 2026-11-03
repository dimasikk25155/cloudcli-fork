import { randomUUID } from 'node:crypto';

import type { Database } from 'better-sqlite3';

import type { WorkspaceRecord } from '../../../shared/agent-workspace.js';
export class WorkspaceError extends Error { constructor(message: string, public statusCode = 400) { super(message); } }
export interface WorkspaceStore {
 get<T = Record<string, unknown>>(id: string): WorkspaceRecord<T> | undefined;
 list<T = Record<string, unknown>>(kind: string, filters?: {ownerUserId?: number; projectId?: string | null}): WorkspaceRecord<T>[];
 create<T>(input: { id?: string; kind: string; ownerUserId: number; projectId?: string | null; payload: T }): WorkspaceRecord<T>;
 update<T>(id: string, expectedRevision: number, payload: T): WorkspaceRecord<T>;
 transaction<T>(fn: () => T): T;
}
export function createWorkspaceStore(db: Database, now = () => new Date().toISOString()): WorkspaceStore {
 const decode = <T>(value: unknown): WorkspaceRecord<T> | undefined => {
  if (!value) return undefined;
  const r = value as {id:string;kind:string;owner_user_id:number;project_id:string|null;revision:number;payload:string;created_at:string;updated_at:string};
  return {id:r.id,kind:r.kind,ownerUserId:r.owner_user_id,projectId:r.project_id,revision:r.revision,payload:JSON.parse(r.payload),createdAt:r.created_at,updatedAt:r.updated_at};
 };
 const store: WorkspaceStore = {
  get<T>(id: string) { return decode<T>(db.prepare('SELECT * FROM workspace_records WHERE id=?').get(id)); },
  list<T>(kind: string, filters: {ownerUserId?:number;projectId?:string|null} = {}) {
   const clauses = ['kind=?']; const args: (string|number|null)[] = [kind];
   if (filters.ownerUserId !== undefined) { clauses.push('owner_user_id=?');args.push(filters.ownerUserId); }
   if (filters.projectId !== undefined) { clauses.push('project_id IS ?');args.push(filters.projectId); }
   return db.prepare('SELECT * FROM workspace_records WHERE '+clauses.join(' AND ')+' ORDER BY created_at,id').all(...args).map(r=>decode<T>(r)!);
  },
  create<T>(input: {id?:string;kind:string;ownerUserId:number;projectId?:string|null;payload:T}) {
   const id=input.id ?? randomUUID(), time=now();
   try { db.prepare('INSERT INTO workspace_records(id,kind,owner_user_id,project_id,revision,payload,created_at,updated_at) VALUES (?,?,?,?,1,?,?,?)').run(id,input.kind,input.ownerUserId,input.projectId??null,JSON.stringify(input.payload),time,time); }
   catch(error) { if ((error as {code?:string}).code?.startsWith('SQLITE_CONSTRAINT')) throw new WorkspaceError('Запись уже существует',409); throw error; }
   return store.get<T>(id)!;
  },
  update<T>(id:string, expectedRevision:number, payload:T) {
   if (!Number.isSafeInteger(expectedRevision) || expectedRevision<1) throw new WorkspaceError('Нужна версия записи',400);
   // RETURNING captures this update atomically, without a race with another connection.
   const row=db.prepare('UPDATE workspace_records SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? RETURNING *').get(JSON.stringify(payload),now(),id,expectedRevision);
   if (!row) throw new WorkspaceError('Объект изменён или удалён; обновите список',409);
   return decode<T>(row)!;
  },
  transaction<T>(fn:()=>T) { return db.transaction(fn)(); },
 };
 return store;
}
