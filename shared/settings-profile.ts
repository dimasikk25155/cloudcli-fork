/** Settings profile: shapes shared by the server and the «Профиль настроек» screen. */

export type ProfileValue = string | number | boolean;

/** One line of a diff: `from` null — the key was never set. */
export type ProfileChange = { key: string; from: ProfileValue | null; to: ProfileValue };

export type ProfilePreview = {
  changes: ProfileChange[];
  /** Keys outside the allow-list or with a non-flat value: never applied. */
  dropped: string[];
};

export type ProfileProposal = {
  id: string;
  reason: string;
  sessionId: string | null;
  status: 'pending' | 'applied' | 'dismissed';
  createdAt: string;
  preview: ProfilePreview;
};

export type ProfileSnapshot = {
  id: string;
  createdAt: string;
  restoredAt: string | null;
  proposalId: string | null;
  /** What was applied, with the values that were there before. */
  changes: ProfileChange[];
};

export const PROFILE_PENDING_MAX = 20;
export const PROFILE_REASON_MAX = 500;
