import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { selectableModels } from '../../../../../../../utils/providerSelectionPolicy';
import { resolveChatSelection, resolveModelEffort, persistNewChatModelDefault, NEW_CHAT_DEFAULTS_CHANGED } from '../../../../../../chat/utils/providerModelState';
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
  const [workModeProvider, setWorkModeProvider] = useState<AgentProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [modelsResponse, preferencesResponse, capabilities] = await Promise.all([
          authenticatedFetch(`/api/providers/${agent}/models`),
          authenticatedFetch('/api/settings/provider-preferences'),
          authenticatedFetch(`/api/providers/${agent}/capabilities`)
            .then(response => response.ok ? response.json() : null).catch(() => null),
        ]);
        const modelsBody = (await modelsResponse.json()) as ProviderModelsResponse;
        const preferences = (await preferencesResponse.json()) as ProviderPreferencesResponse;

        if (cancelled) {
          return;
        }

        const definition = modelsBody.data?.models ?? null;
        setModelsDefinition(definition);
        setWorkModeProvider(capabilities?.success && capabilities.data?.supportsWorkMode ? agent : null);
        const requestedModel = preferences.models?.[agent] || '';
        const nextModel = resolveChatSelection(agent, requestedModel, definition).model;
        setModel(nextModel);
        setEffort(resolveModelEffort(definition?.OPTIONS.find(option => option.value === nextModel), {
          model: requestedModel, effort: preferences.efforts?.[agent] || MODEL_DEFAULT_EFFORT,
        }));
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
      if ((path === 'model' || path === 'effort') && typeof body.provider === 'string' && typeof body[path] === 'string') {
        localStorage.setItem(`${body.provider}-${path}`, body[path]);
        window.dispatchEvent(new Event(NEW_CHAT_DEFAULTS_CHANGED));
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
            label={t('newChatDefaults.model.label', { defaultValue: 'Model' })}
            description={t('newChatDefaults.model.description', { defaultValue: 'The model a new chat opens on.' })}
          >
            <select
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
                // An explicit level belongs to its model; a new model starts on its default.
                const nextEffort = resolveModelEffort(
                  modelsDefinition?.OPTIONS.find(option => option.value === event.target.value),
                  { model, effort },
                );
                setEffort(nextEffort);
                void persistNewChatModelDefault(agent, event.target.value, nextEffort, save);
              }}
              className={selectClassName}
              disabled={selectableModels(agent, modelsDefinition).length === 0}
            >
              {selectableModels(agent, modelsDefinition)
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

          {/* Capabilities belong to the runtime, including Codex developer instructions. */}
          {workModeProvider === agent && (
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
