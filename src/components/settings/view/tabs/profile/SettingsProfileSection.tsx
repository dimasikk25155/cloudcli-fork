import React, { useCallback, useEffect, useState } from 'react';

import type { ProfileProposal, ProfileSnapshot } from '../../../../../../shared/settings-profile';
import { useModEnabled } from '../../../../../hooks/useModEnabled';
import { refreshUiPreferences } from '../../../../../hooks/uiPreferencesStore';
import { authenticatedFetch } from '../../../../../utils/api';
import SettingsCard from '../../SettingsCard';
import SettingsSection from '../../SettingsSection';

import { describeChange } from './profileModel';

type Overview = { proposals: ProfileProposal[]; snapshots: ProfileSnapshot[] };

const buttonClass = 'rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50';

async function post(path: string, body: unknown): Promise<void> {
  try {
    await authenticatedFetch(`/api/settings-profile${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // The list is re-read right after: a failed action simply stays visible.
  }
}

async function loadOverview(): Promise<Overview | null> {
  try {
    const response = await authenticatedFetch('/api/settings-profile');
    if (!response.ok) return null;
    const payload = await response.json() as { data?: Overview };
    return payload.data ?? null;
  } catch {
    return null;
  }
}

/**
 * «Профиль настроек» (mod «Диагностика»): what the agent suggested to change
 * in the interface, themes and mods. Nothing happens until the person presses
 * «Применить»; before it a snapshot is taken and «Вернуть как было» undoes it.
 */
export default function SettingsProfileSection() {
  const enabled = useModEnabled('modDiagnostics');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => setOverview(await loadOverview()), []);
  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);

  if (!enabled) return null;

  const act = async (path: string, body: unknown) => {
    setBusy(true);
    await post(path, body);
    await refreshUiPreferences(authenticatedFetch);
    await reload();
    setBusy(false);
  };

  const pending = overview?.proposals.filter((proposal) => proposal.status === 'pending') ?? [];
  const snapshots = overview?.snapshots ?? [];

  return (
    <SettingsSection
      title="Профиль настроек"
      description="Агент может предложить изменить тему, интерфейс или моды. Он только предлагает: применяете вы, и перед этим сохраняется снимок."
    >
      <SettingsCard>
        <div className="space-y-4 p-4" data-settings-profile>
          {pending.length === 0 && <p className="text-sm text-muted-foreground">Предложений нет.</p>}
          {pending.map((proposal) => (
            <div key={proposal.id} className="space-y-2 rounded-md border border-border p-3" data-proposal={proposal.id}>
              {proposal.reason && <p className="text-sm">{proposal.reason}</p>}
              <ul className="list-disc space-y-0.5 pl-5 text-sm">
                {proposal.preview.changes.map((change) => <li key={change.key}>{describeChange(change)}</li>)}
              </ul>
              {proposal.preview.dropped.length > 0 && (
                <p className="text-xs text-muted-foreground">Не применятся (нельзя менять): {proposal.preview.dropped.join(', ')}</p>
              )}
              <div className="flex gap-2">
                <button type="button" className={buttonClass} disabled={busy} onClick={() => void act('/apply', { proposalId: proposal.id })}>Применить</button>
                <button type="button" className={buttonClass} disabled={busy} onClick={() => void act(`/proposals/${encodeURIComponent(proposal.id)}/dismiss`, {})}>Отклонить</button>
              </div>
            </div>
          ))}
          {snapshots.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Применённое</h4>
              {snapshots.slice(0, 5).map((snapshot) => (
                <div key={snapshot.id} className="flex items-start justify-between gap-3 text-sm" data-snapshot={snapshot.id}>
                  <div>
                    <div className="text-xs text-muted-foreground">{new Date(snapshot.createdAt).toLocaleString('ru-RU')}</div>
                    {snapshot.changes.map((change) => <div key={change.key}>{describeChange(change)}</div>)}
                  </div>
                  {snapshot.restoredAt
                    ? <span className="shrink-0 text-xs text-muted-foreground">Возвращено</span>
                    : <button type="button" className={buttonClass} disabled={busy} onClick={() => void act('/restore', { snapshotId: snapshot.id })}>Вернуть как было</button>}
                </div>
              ))}
            </div>
          )}
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}
