/**
 * Память «эта пачка уже ушла» мастер-сессии, переживающая рестарт сервера.
 *
 * Ключ — `userId:batchId:sessionId`, итог первой доставки хранится в
 * `workspace_records` (kind `master-send`, владелец — пользователь, id записи
 * выводится из ключа). Сутки спустя тот же batchId — уже новое нажатие:
 * `prune(now)` сдвигает границу, старее неё запись не читается. Удалять
 * записи хранилище не умеет — повторное нажатие с тем же ключом перезаписывает.
 */
import type { WorkspaceStore } from '@/modules/agent-workspace/index.js';

import type { MasterSendResult } from './master-session.service.js';

export type MasterSendLedger = {
  get(key: string): MasterSendResult | null;
  put(key: string, result: MasterSendResult, at: number): void;
  prune(now: number): void;
};

export const MASTER_SEND_KIND = 'master-send';
export const MASTER_SEND_TTL_MS = 24 * 60 * 60 * 1000;

type MasterSendPayload = { key: string; result: MasterSendResult; at: number };

const recordId = (key: string) => `${MASTER_SEND_KIND}:${key}`;

function ownerOf(key: string): number {
  const id = Number(key.split(':', 1)[0]);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

function readResult(value: unknown): MasterSendResult | null {
  if (!value || typeof value !== 'object') return null;
  const result = value as Record<string, unknown>;
  if (typeof result.sessionId !== 'string') return null;
  if (result.status !== 'sent' && result.status !== 'stale' && result.status !== 'failed') return null;
  return {
    sessionId: result.sessionId,
    status: result.status,
    ...(typeof result.reason === 'string' ? { reason: result.reason } : {}),
  };
}

export function createWorkspaceMasterSendLedger(store: WorkspaceStore): MasterSendLedger {
  let cutoff = Number.NEGATIVE_INFINITY;

  return {
    get(key) {
      const record = store.get<MasterSendPayload>(recordId(key));
      if (!record || record.kind !== MASTER_SEND_KIND) return null;
      const { payload } = record;
      if (!payload || payload.key !== key || typeof payload.at !== 'number' || payload.at < cutoff) return null;
      return readResult(payload.result);
    },
    put(key, result, at) {
      const payload: MasterSendPayload = { key, result, at };
      const id = recordId(key);
      const existing = store.get<MasterSendPayload>(id);
      if (existing) store.update(id, existing.revision, payload);
      else store.create({ id, kind: MASTER_SEND_KIND, ownerUserId: ownerOf(key), payload });
    },
    prune(now) {
      cutoff = now - MASTER_SEND_TTL_MS;
    },
  };
}
