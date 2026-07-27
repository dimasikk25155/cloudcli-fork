import type { InputHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SettingsSection from '../SettingsSection';
import SettingsToggle from '../SettingsToggle';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../../../../shared/view/ui';
import { useUiPreferences } from '../../../../hooks/useUiPreferences';
import { useVoiceConfig } from '../../../../hooks/useVoiceConfig';

// Where users get their own speech-to-text key. The server ships with a Groq
// backend configured, so this is the only link a user ever needs.
const KEYS_PAGE_URL = 'https://console.groq.com/keys';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <input className={inputClass} {...props} />
    </label>
  );
}

export default function VoiceSettingsTab() {
  const { t } = useTranslation('settings');
  const { preferences, setPreference } = useUiPreferences();
  const { config, update } = useVoiceConfig();
  const voiceEnabled = preferences.voiceEnabled;

  return (
    <div className="space-y-8">
      <SettingsSection title={t('voiceSettings.title')} description={t('voiceSettings.description')}>
        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div className="pr-3">
            <div className="text-sm font-medium text-foreground">{t('voiceSettings.enable')}</div>
            <div className="text-xs text-muted-foreground">{t('voiceSettings.enableDescription')}</div>
          </div>
          <SettingsToggle
            checked={voiceEnabled}
            onChange={(v) => setPreference('voiceEnabled', v)}
            ariaLabel={t('voiceSettings.enable')}
          />
        </div>
      </SettingsSection>

      {voiceEnabled && (
        <>
        <SettingsSection title={t('voiceSettings.keyTitle')} description={t('voiceSettings.keyDescription')}>
          <div className="space-y-3">
            <Field
              label={t('voiceSettings.apiKey')}
              type="password"
              autoComplete="off"
              placeholder="gsk_…"
              value={config.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
            />
            <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
              <li>
                {t('voiceSettings.step1')}{' '}
                <a
                  href={KEYS_PAGE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline underline-offset-2"
                >
                  console.groq.com/keys
                </a>
              </li>
              <li>{t('voiceSettings.step2')}</li>
              <li>{t('voiceSettings.step3')}</li>
            </ol>
            <p className="text-xs text-muted-foreground">{t('voiceSettings.keyOptionalNote')}</p>
          </div>
        </SettingsSection>

        <SettingsSection title={t('voiceSettings.dictionary')} description={t('voiceSettings.dictionaryHint')}>
          <textarea
            className={`${inputClass} min-h-[120px] font-mono`}
            placeholder={'Claude Code: клод код, клауд код\nVercel: версель, верцел'}
            value={config.dictionary}
            onChange={(e) => update({ dictionary: e.target.value })}
            aria-label={t('voiceSettings.dictionary')}
          />
        </SettingsSection>

        {/* Everything below is for non-default deployments (own STT server, other
            models, read-aloud). Collapsed by default so the common case stays a
            toggle plus a key. */}
        <Collapsible>
          <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/50">
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            {t('voiceSettings.advanced')}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-4 px-1 pt-4">
              <p className="text-xs text-muted-foreground">{t('voiceSettings.advancedNote')}</p>
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="pr-3">
                  <div className="text-sm font-medium text-foreground">{t('voiceSettings.correction')}</div>
                  <div className="text-xs text-muted-foreground">{t('voiceSettings.correctionDescription')}</div>
                </div>
                <SettingsToggle
                  checked={config.correctionEnabled}
                  onChange={(v) => update({ correctionEnabled: v })}
                  ariaLabel={t('voiceSettings.correction')}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="pr-3">
                  <div className="text-sm font-medium text-foreground">{t('voiceSettings.fillerCleanup')}</div>
                  <div className="text-xs text-muted-foreground">{t('voiceSettings.fillerCleanupDescription')}</div>
                </div>
                <SettingsToggle
                  checked={config.fillerCleanup}
                  onChange={(v) => update({ fillerCleanup: v })}
                  ariaLabel={t('voiceSettings.fillerCleanup')}
                />
              </div>
              <Field
                label={t('voiceSettings.baseUrl')}
                placeholder="https://api.groq.com/openai/v1"
                value={config.baseUrl}
                onChange={(e) => update({ baseUrl: e.target.value })}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label={t('voiceSettings.sttModel')}
                  placeholder="whisper-large-v3"
                  value={config.sttModel}
                  onChange={(e) => update({ sttModel: e.target.value })}
                />
                <Field
                  label={t('voiceSettings.correctionModel')}
                  placeholder="llama-3.3-70b-versatile"
                  value={config.correctionModel}
                  onChange={(e) => update({ correctionModel: e.target.value })}
                />
                <Field
                  label={t('voiceSettings.language')}
                  placeholder="ru"
                  value={config.language}
                  onChange={(e) => update({ language: e.target.value })}
                />
                <Field
                  label={t('voiceSettings.ttsModel')}
                  placeholder="tts-1"
                  value={config.ttsModel}
                  onChange={(e) => update({ ttsModel: e.target.value })}
                />
                <Field
                  label={t('voiceSettings.voice')}
                  placeholder="alloy"
                  value={config.ttsVoice}
                  onChange={(e) => update({ ttsVoice: e.target.value })}
                />
                <Field
                  label={t('voiceSettings.format')}
                  placeholder="mp3"
                  value={config.ttsFormat}
                  onChange={(e) => update({ ttsFormat: e.target.value })}
                />
              </div>
              <p className="text-xs text-muted-foreground">{t('voiceSettings.note')}</p>
            </div>
          </CollapsibleContent>
        </Collapsible>
        </>
      )}
    </div>
  );
}
