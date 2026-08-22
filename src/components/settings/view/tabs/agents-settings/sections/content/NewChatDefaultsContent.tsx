import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { authenticatedFetch } from '../../../../../../../utils/api';
import { WORK_MODES } from '../../../../../../chat/types/types';
import type { WorkMode } from '../../../../../../chat/types/types';
import type { ProviderModelsDefinition } from '../../../../../../../types/app';
import type { AgentProvider } from '../../../../../types/types';
import SettingsCard from '../../../../SettingsCard';
import SettingsRow from '../../../../SettingsRow';
import SettingsSection from '../../../../SettingsSection';

/**
 * "What a NEW chat starts with" for one engine.
 *
 * Deliberately the only place these defaults can be changed: the composer's
 * chips are session-scoped, so switching model mid-conversation no longer
 * reprograms every future chat (reversal of the old global-switch behaviour).
 *
 * Self-contained on purpose — it reads and writes the account-level
 * preferences API directly instead of threading a dozen props through the
 * settings tree, so the same panel works for every engine.
 */

/** Level value meaning "whatever this model runs at by default". */
const MODEL_DEFAULT_EFFORT = 'default';

type ProviderPreferencesResponse = {
  models?: Record<string, string>;
  efforts?: Record<string, string>;
  workMode?: string | null;
  defaultProvider?: string | null;
};

/** Mirror of DEFAULT_CHAT_PROVIDER_KEY in useChatProviderState — the instant
 * local cache, so the toggle applies to the very next "new chat" without a
 * page reload. The server row stays the cross-device source of truth. */
const DEFAULT_CHAT_PROVIDER_CACHE_KEY = 'default-chat-provider';

type ProviderModelsResponse = {
  success?: boolean;
  data?: { models?: ProviderModelsDefinition };
};

type NewChatDefaultsContentProps = {
  agent: AgentProvider;
};

export default function NewChatDefaultsContent({ agent }: NewChatDefaultsContentProps) {
  const { t } = useTranslation('settings');
  const { t: tChat } = useTranslation('chat');

  const [modelsDefinition, setModelsDefinition] = useState<ProviderModelsDefinition | null>(null);
  const [model, setModel] = useState<string>('');
  const [effort, setEffort] = useState<string>(MODEL_DEFAULT_EFFORT);
  const [workMode, setWorkMode] = useState<WorkMode>('autopilot');
  const [isDefaultProvider, setIsDefaultProvider] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [modelsResponse, preferencesResponse] = await Promise.all([
          authenticatedFetch(`/api/providers/${agent}/models`),
          authenticatedFetch('/api/settings/provider-preferences'),
        ]);
        const modelsBody = (await modelsResponse.json()) as ProviderModelsResponse;
        const preferences = (await preferencesResponse.json()) as ProviderPreferencesResponse;

        if (cancelled) {
          return;
        }

        const definition = modelsBody.data?.models ?? null;
        setModelsDefinition(definition);
        setModel(preferences.models?.[agent] || definition?.DEFAULT || '');
        setEffort(preferences.efforts?.[agent] || MODEL_DEFAULT_EFFORT);
        setIsDefaultProvider(preferences.defaultProvider === agent);
        if (preferences.workMode && WORK_MODES.includes(preferences.workMode as WorkMode)) {
          setWorkMode(preferences.workMode as WorkMode);
        }
      } catch (loadError) {
        if (!cancelled) {
          console.error('Failed to load new-chat defaults:', loadError);
          setError(t('newChatDefaults.loadError', { defaultValue: 'Could not load the defaults.' }));
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [agent, t]);

  // Every write is fire-and-forget with an inline error line: a failed save
  // must not silently look like it stuck.
  const save = useCallback(async (path: string, body: Record<string, unknown>) => {
    try {
      const response = await authenticatedFetch(`/api/settings/provider-preferences/${path}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      setError(null);
    } catch (saveError) {
      console.error('Failed to save new-chat default:', saveError);
      setError(t('newChatDefaults.saveError', { defaultValue: 'Could not save. Try again.' }));
    }
  }, [t]);

  const effortValues = modelsDefinition?.OPTIONS.find((option) => option.value === model)?.effort?.values ?? [];

  const selectClassName = 'w-full rounded-lg border border-input bg-card p-2.5 text-sm text-foreground touch-manipulation focus:border-primary focus:ring-1 focus:ring-primary sm:w-56';

  return (
    <div className="space-y-8">
      <SettingsSection
        title={t('newChatDefaults.title', { defaultValue: 'New chats' })}
        description={t('newChatDefaults.description', {
          defaultValue: 'Every new chat starts with these. Changing them inside a chat affects that chat only.',
        })}
      >
        <SettingsCard divided>
          <SettingsRow
            label={t('newChatDefaults.defaultEngine.label', { defaultValue: 'Open new chats on this engine' })}
            description={t('newChatDefaults.defaultEngine.description', {
              defaultValue: 'Every new chat starts on this engine. Off everywhere: a new chat sticks to the engine used last.',
            })}
          >
            <input
              type="checkbox"
              checked={isDefaultProvider}
              onChange={(event) => {
                const checked = event.target.checked;
                setIsDefaultProvider(checked);
                // Instant local cache so the very next "new chat" follows the
                // toggle without a reload; the account row syncs other devices.
                if (checked) {
                  localStorage.setItem(DEFAULT_CHAT_PROVIDER_CACHE_KEY, agent);
                } else {
                  localStorage.removeItem(DEFAULT_CHAT_PROVIDER_CACHE_KEY);
                }
                void save('default-provider', { provider: checked ? agent : null });
              }}
              className="h-4 w-4 rounded-ui-sm border-input bg-card text-primary focus:ring-2 focus:ring-ring"
            />
          </SettingsRow>

          <SettingsRow
            label={t('newChatDefaults.model.label', { defaultValue: 'Model' })}
            description={t('newChatDefaults.model.description', { defaultValue: 'The model a new chat opens on.' })}
          >
            <select
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
                // A level the new model does not offer would be silently
                // ignored by the runtime, so fall back to its own default.
                const nextEffortValues = modelsDefinition?.OPTIONS
                  .find((option) => option.value === event.target.value)?.effort?.values ?? [];
                if (effort !== MODEL_DEFAULT_EFFORT && !nextEffortValues.some((value) => value.value === effort)) {
                  setEffort(MODEL_DEFAULT_EFFORT);
                  void save('effort', { provider: agent, effort: MODEL_DEFAULT_EFFORT });
                }
                void save('model', { provider: agent, model: event.target.value });
              }}
              className={selectClassName}
              disabled={!modelsDefinition}
            >
              {(modelsDefinition?.OPTIONS ?? [])
                .filter((option) => !option.hidden || option.value === model)
                .map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </SettingsRow>

          {effortValues.length > 0 && (
            <SettingsRow
              label={t('newChatDefaults.effort.label', { defaultValue: 'Thinking level' })}
              description={t('newChatDefaults.effort.description', {
                defaultValue: 'Pick a level explicitly — "model default" is whatever the model ships with.',
              })}
            >
              <select
                value={effort}
                onChange={(event) => {
                  setEffort(event.target.value);
                  void save('effort', { provider: agent, effort: event.target.value });
                }}
                className={selectClassName}
              >
                <option value={MODEL_DEFAULT_EFFORT}>
                  {t('newChatDefaults.effort.modelDefault', { defaultValue: 'Model default' })}
                </option>
                {effortValues.map((value) => (
                  <option key={value.value} value={value.value}>
                    {value.value}
                  </option>
                ))}
              </select>
            </SettingsRow>
          )}

          {/* Only the Claude runtime carries the work mode (it rides on the
              system prompt), so the row would be a lie for other engines. */}
          {agent === 'claude' && (
            <SettingsRow
              label={tChat('workMode.title', { defaultValue: 'Work mode' })}
              description={t('newChatDefaults.workMode.description', {
                defaultValue: 'How much the agent checks in with you while it works.',
              })}
            >
              <select
                value={workMode}
                onChange={(event) => {
                  const nextMode = event.target.value as WorkMode;
                  setWorkMode(nextMode);
                  void save('work-mode', { workMode: nextMode });
                }}
                className={selectClassName}
              >
                {WORK_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {tChat(`workMode.modes.${mode}`, { defaultValue: mode })}
                  </option>
                ))}
              </select>
            </SettingsRow>
          )}
        </SettingsCard>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </SettingsSection>
    </div>
  );
}
