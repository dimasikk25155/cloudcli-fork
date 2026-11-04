import { isModOn as defaultIsModOn, modOffError, type IsModOn } from '@/shared/mods.js';
import { AppError } from '@/shared/utils.js';

import {
  PROFILE_PENDING_MAX,
  PROFILE_REASON_MAX,
  type ProfileChange,
  type ProfilePreview,
  type ProfileProposal,
  type ProfileSnapshot,
  type ProfileValue,
} from '../../../shared/settings-profile.js';
import type { WorkspaceStore } from '../agent-workspace/index.js';

export const PROFILE_PROPOSAL_KIND = 'settings-proposal';
export const PROFILE_SNAPSHOT_KIND = 'settings-snapshot';

/** Server-owned flags the profile never touches. */
const PROFILE_EXCLUDED_KEYS = new Set(['customBackground']);

type ProposalPayload = Omit<ProfileProposal, 'id' | 'createdAt'>;
type SnapshotPayload = Omit<ProfileSnapshot, 'id' | 'createdAt'>;

export type SettingsProfileDependencies = {
  store: WorkspaceStore;
  prefs: {
    get(userId: number): Record<string, ProfileValue>;
    update(userId: number, partial: Record<string, ProfileValue>): unknown;
    remove(userId: number, keys: string[]): unknown;
  };
  /** The ui-preferences allow-list (`ALLOWED_KEYS`). */
  isAllowedKey(key: string): boolean;
  /** Content-free "re-read your settings" frame. */
  notify?(userId: number): void;
  isModOn?: IsModOn;
  now?: () => string;
};

const isFlat = (value: unknown): value is ProfileValue => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

/**
 * «Профиль настроек»: the agent proposes (`propose`), only the human applies.
 * Applying takes a snapshot of the touched keys first; `restore` puts them
 * back, including keys that were never set. Only keys of the ui-preferences
 * allow-list pass — the rest is dropped and reported.
 */
export function createSettingsProfileService(deps: SettingsProfileDependencies) {
  const { store, prefs } = deps;
  const isModOn = deps.isModOn ?? defaultIsModOn;
  const now = deps.now ?? (() => new Date().toISOString());

  const gate = (userId: number) => {
    if (!isModOn(userId, 'modDiagnostics')) throw modOffError('modDiagnostics');
  };
  const changed = (userId: number) => {
    try {
      deps.notify?.(userId);
    } catch {
      // A failed frame must not undo a saved change.
    }
  };
  const bad = (message: string, code: string, statusCode = 400) => new AppError(message, { code, statusCode });

  const preview = (userId: number, raw: unknown): ProfilePreview => {
    const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const current = prefs.get(userId);
    const changes: ProfileChange[] = [];
    const dropped: string[] = [];
    for (const [key, value] of Object.entries(input)) {
      if (!deps.isAllowedKey(key) || PROFILE_EXCLUDED_KEYS.has(key) || !isFlat(value)) {
        dropped.push(key);
        continue;
      }
      // Already so: not a change.
      if (current[key] === value) continue;
      changes.push({ key, from: current[key] ?? null, to: value });
    }
    return { changes, dropped };
  };

  const proposalOf = (record: { id: string; createdAt: string; payload: ProposalPayload }): ProfileProposal => ({ ...record.payload, id: record.id, createdAt: record.createdAt });
  const snapshotOf = (record: { id: string; createdAt: string; payload: SnapshotPayload }): ProfileSnapshot => ({ ...record.payload, id: record.id, createdAt: record.createdAt });
  const own = <T>(userId: number, id: unknown, kind: string) => {
    const record = typeof id === 'string' ? store.get<T>(id) : undefined;
    if (!record || record.kind !== kind || record.ownerUserId !== userId) throw bad('Не найдено', 'PROFILE_NOT_FOUND', 404);
    return record;
  };

  /** Applies a flat change set: snapshot of the touched keys first, then write, then the frame. */
  const applyChanges = (userId: number, changes: ProfileChange[], proposalId: string | null): ProfileSnapshot => {
    if (changes.length === 0) throw bad('Нечего применять: все значения уже такие', 'PROFILE_NO_CHANGES');
    const snapshot = store.create<SnapshotPayload>({
      kind: PROFILE_SNAPSHOT_KIND,
      ownerUserId: userId,
      payload: { restoredAt: null, proposalId, changes },
    });
    prefs.update(userId, Object.fromEntries(changes.map((change) => [change.key, change.to])));
    changed(userId);
    return snapshotOf(snapshot);
  };

  return {
    preview(userId: number, changes: unknown): ProfilePreview {
      gate(userId);
      return preview(userId, changes);
    },

    /** Agent entry. Stores a suggestion; nothing in the settings changes. */
    propose(userId: number, sessionId: string | null, input: { changes?: unknown; reason?: unknown }): ProfileProposal {
      gate(userId);
      const result = preview(userId, input.changes);
      if (result.changes.length === 0) {
        throw bad(result.dropped.length ? `Эти ключи менять нельзя: ${result.dropped.join(', ')}` : 'Предложение пустое', 'PROFILE_NO_CHANGES');
      }
      const pending = store.list<ProposalPayload>(PROFILE_PROPOSAL_KIND, { ownerUserId: userId }).filter((row) => row.payload.status === 'pending');
      if (pending.length >= PROFILE_PENDING_MAX) throw bad('Слишком много неразобранных предложений', 'PROFILE_PENDING_LIMIT');
      const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, PROFILE_REASON_MAX) : '';
      const record = store.create<ProposalPayload>({
        kind: PROFILE_PROPOSAL_KIND,
        ownerUserId: userId,
        payload: { reason, sessionId, status: 'pending', preview: result },
      });
      return proposalOf(record);
    },

    overview(userId: number): { proposals: ProfileProposal[]; snapshots: ProfileSnapshot[] } {
      gate(userId);
      const proposals = store.list<ProposalPayload>(PROFILE_PROPOSAL_KIND, { ownerUserId: userId }).map(proposalOf).reverse();
      const snapshots = store.list<SnapshotPayload>(PROFILE_SNAPSHOT_KIND, { ownerUserId: userId }).map(snapshotOf).reverse();
      return { proposals, snapshots };
    },

    /** Human entry: apply a proposal as is, or an ad-hoc change set. */
    apply(userId: number, input: { proposalId?: unknown; changes?: unknown }): ProfileSnapshot {
      gate(userId);
      if (input.proposalId !== undefined) {
        const record = own<ProposalPayload>(userId, input.proposalId, PROFILE_PROPOSAL_KIND);
        if (record.payload.status !== 'pending') throw bad('Предложение уже разобрано', 'PROFILE_PROPOSAL_DONE', 409);
        // Values may have moved since the proposal: diff again against the current settings.
        const fresh = preview(userId, Object.fromEntries(record.payload.preview.changes.map((change) => [change.key, change.to])));
        const snapshot = applyChanges(userId, fresh.changes, record.id);
        store.update(record.id, record.revision, { ...record.payload, status: 'applied' });
        return snapshot;
      }
      return applyChanges(userId, preview(userId, input.changes).changes, null);
    },

    dismiss(userId: number, proposalId: unknown): ProfileProposal {
      gate(userId);
      const record = own<ProposalPayload>(userId, proposalId, PROFILE_PROPOSAL_KIND);
      if (record.payload.status !== 'pending') throw bad('Предложение уже разобрано', 'PROFILE_PROPOSAL_DONE', 409);
      return proposalOf(store.update(record.id, record.revision, { ...record.payload, status: 'dismissed' as const }));
    },

    /** «Вернуть как было»: the touched keys get their previous values (or are unset again). */
    restore(userId: number, snapshotId: unknown): ProfileSnapshot {
      gate(userId);
      const record = own<SnapshotPayload>(userId, snapshotId, PROFILE_SNAPSHOT_KIND);
      if (record.payload.restoredAt) throw bad('Этот снимок уже восстановлен', 'PROFILE_ALREADY_RESTORED', 409);
      const back: Record<string, ProfileValue> = {};
      const unset: string[] = [];
      for (const change of record.payload.changes) {
        if (change.from === null) unset.push(change.key);
        else back[change.key] = change.from;
      }
      if (Object.keys(back).length) prefs.update(userId, back);
      if (unset.length) prefs.remove(userId, unset);
      const updated = store.update(record.id, record.revision, { ...record.payload, restoredAt: now() });
      changed(userId);
      return snapshotOf(updated);
    },
  };
}

export type SettingsProfileService = ReturnType<typeof createSettingsProfileService>;
