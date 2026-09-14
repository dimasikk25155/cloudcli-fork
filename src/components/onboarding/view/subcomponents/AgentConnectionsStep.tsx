import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';

import type { LLMProvider } from '../../../../types/app';
import type { ProviderAuthStatusMap } from '../../../provider-auth/types';

import AgentConnectionCard from './AgentConnectionCard';

type AgentConnectionsStepProps = {
  providerStatuses: ProviderAuthStatusMap;
  onOpenProviderLogin: (provider: LLMProvider) => void;
};

const claudeCard = {
  provider: 'claude' as const,
  title: 'Claude',
  connectedClassName: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
  iconContainerClassName: 'bg-blue-100 dark:bg-blue-900/30',
  loginButtonClassName: 'bg-blue-600 hover:bg-blue-700',
};

const otherCards = [
  {
    provider: 'codex' as const,
    title: 'OpenAI Codex',
    connectedClassName: 'bg-gray-100 dark:bg-gray-800/50 border-gray-300 dark:border-gray-600',
    iconContainerClassName: 'bg-gray-100 dark:bg-gray-800',
    loginButtonClassName: 'bg-gray-800 hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600',
  },
  {
    provider: 'cursor' as const,
    title: 'Cursor',
    connectedClassName: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800',
    iconContainerClassName: 'bg-purple-100 dark:bg-purple-900/30',
    loginButtonClassName: 'bg-purple-600 hover:bg-purple-700',
  },
  {
    provider: 'opencode' as const,
    title: 'OpenCode',
    connectedClassName: 'bg-zinc-100 dark:bg-zinc-800/50 border-zinc-300 dark:border-zinc-600',
    iconContainerClassName: 'bg-zinc-100 dark:bg-zinc-800',
    loginButtonClassName: 'bg-zinc-800 hover:bg-zinc-900 dark:bg-zinc-700 dark:hover:bg-zinc-600',
  },
];

export default function AgentConnectionsStep({
  providerStatuses,
  onOpenProviderLogin,
}: AgentConnectionsStepProps) {
  const { t } = useTranslation('common');
  const [showOthers, setShowOthers] = useState(false);

  const labels = {
    loginLabel: t('onboarding.connect.login'),
    checkingLabel: t('onboarding.connect.checking'),
    connectedLabel: t('onboarding.connect.connected'),
    notConnectedLabel: t('onboarding.connect.notConnected'),
  };

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-bold tracking-tight text-foreground">{t('onboarding.connect.title')}</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {t('onboarding.connect.body')}
        </p>
      </div>

      <AgentConnectionCard
        provider={claudeCard.provider}
        title={claudeCard.title}
        status={providerStatuses.claude}
        connectedClassName={claudeCard.connectedClassName}
        iconContainerClassName={claudeCard.iconContainerClassName}
        loginButtonClassName={claudeCard.loginButtonClassName}
        onLogin={() => onOpenProviderLogin('claude')}
        {...labels}
      />

      <button
        type="button"
        onClick={() => setShowOthers((open) => !open)}
        className="flex w-full items-center justify-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {t('onboarding.connect.others')}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showOthers ? 'rotate-180' : ''}`} />
      </button>

      {showOthers && (
        <div className="space-y-2">
          <p className="text-center text-xs text-muted-foreground">{t('onboarding.connect.othersHint')}</p>
          {otherCards.map((providerCard) => (
            <AgentConnectionCard
              key={providerCard.provider}
              provider={providerCard.provider}
              title={providerCard.title}
              status={providerStatuses[providerCard.provider]}
              connectedClassName={providerCard.connectedClassName}
              iconContainerClassName={providerCard.iconContainerClassName}
              loginButtonClassName={providerCard.loginButtonClassName}
              onLogin={() => onOpenProviderLogin(providerCard.provider)}
              {...labels}
            />
          ))}
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">{t('onboarding.connect.later')}</p>
    </div>
  );
}
