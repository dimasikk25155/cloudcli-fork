import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { authenticatedFetch } from '../../../../../../utils/api';
import { SELECTABLE_PROVIDERS, isSelectableProvider } from '../../../../../../utils/providerSelectionPolicy';

/**
 * «На каком движке открывать новый чат» — один выбор на весь аккаунт.
 *
 * Раньше это была галочка внутри страницы каждого агента: чтобы найти её, надо
 * было знать, что она есть, и угадать нужного агента. Теперь выбор стоит над
 * списком агентов. Хранилище то же: строка аккаунта на сервере плюс мгновенный
 * локальный кэш, чтобы следующий «Новый чат» послушался без перезагрузки.
 */

/** Зеркало DEFAULT_CHAT_PROVIDER_KEY из useChatProviderState. */
const DEFAULT_CHAT_PROVIDER_CACHE_KEY = 'default-chat-provider';

/** Пустое значение = «как в прошлый раз». */
const LAST_USED = '';

const ENGINE_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  grok: 'Grok',
};

export default function DefaultEngineSection() {
  const { t } = useTranslation('settings');
  const [value, setValue] = useState<string>(() => {
    const cached = localStorage.getItem(DEFAULT_CHAT_PROVIDER_CACHE_KEY);
    return isSelectableProvider(cached) ? cached : LAST_USED;
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await authenticatedFetch('/api/settings/provider-preferences');
        const body = (await response.json()) as { defaultProvider?: string | null };
        if (!cancelled && response.ok) {
          setValue(isSelectableProvider(body.defaultProvider) ? body.defaultProvider : LAST_USED);
        }
      } catch {
        // Остаётся локальный кэш — он уже показан.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const change = async (next: string) => {
    setValue(next);
    if (next) {
      localStorage.setItem(DEFAULT_CHAT_PROVIDER_CACHE_KEY, next);
      localStorage.setItem('selected-provider', next);
    } else {
      localStorage.removeItem(DEFAULT_CHAT_PROVIDER_CACHE_KEY);
    }
    try {
      const response = await authenticatedFetch('/api/settings/provider-preferences/default-provider', {
        method: 'PUT',
        body: JSON.stringify({ provider: next || null }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setError(null);
    } catch (saveError) {
      console.error('Failed to save default engine:', saveError);
      setError(t('newChatDefaults.saveError', { defaultValue: 'Could not save. Try again.' }));
    }
  };

  return (
    <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-6">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">
          {t('newChatDefaults.defaultEngine.label', { defaultValue: 'Default CLI for new chats' })}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {t('newChatDefaults.defaultEngine.description', {
            defaultValue: 'Every new chat starts on this engine. Open chats keep their own.',
          })}
        </div>
        {error && <div className="mt-1 text-xs text-destructive">{error}</div>}
      </div>
      <select
        value={value}
        onChange={(event) => void change(event.target.value)}
        className="w-full rounded-lg border border-input bg-card p-2.5 text-sm text-foreground touch-manipulation focus:border-primary focus:ring-1 focus:ring-primary sm:w-56"
      >
        <option value={LAST_USED}>
          {t('newChatDefaults.defaultEngine.lastUsed', { defaultValue: 'Last used' })}
        </option>
        {SELECTABLE_PROVIDERS.map((provider) => (
          <option key={provider} value={provider}>{ENGINE_LABELS[provider] ?? provider}</option>
        ))}
      </select>
    </div>
  );
}
