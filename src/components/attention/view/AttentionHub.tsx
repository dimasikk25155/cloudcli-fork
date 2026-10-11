import { useCallback, useEffect, useState } from 'react';
import { Bot, BellRing } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import PanelModal from '../../panels/PanelModal';
import SessionProviderLogo from '../../llm-logo-provider/SessionProviderLogo';
import { useAttentionHubSections } from '../hubSections';
import type { AttentionItem } from '../types';
import { useAttention } from '../useAttention';
import { knownProvider } from '../utils/provider';

import AttentionHubView from './AttentionHubView';

const AGE_TICK_MS = 30_000;

type AttentionHubProps = {
  onClose: () => void;
  /** Open the session in its project (the sidebar knows how). */
  onOpenSession: (item: AttentionItem) => void;
};

/** «Ждут тебя» hub: every session of every project that needs you, plus running ones. */
export default function AttentionHub({ onClose, onOpenSession }: AttentionHubProps) {
  const { items, markSeen, refresh } = useAttention();
  const extraSections = useAttentionHubSections();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const { t } = useTranslation('sidebar');
  // Same labels as the sidebar rows (`projects.providers.*`); unknown ids show as-is.
  const getProviderLabel = useCallback(
    (provider: string) => t(`projects.providers.${provider}`, { defaultValue: provider }),
    [t],
  );

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => setNowMs(Date.now()), AGE_TICK_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const handleOpen = (item: AttentionItem) => {
    if (item.unread) {
      void markSeen({ sessionIds: [item.sessionId] });
    }
    onClose();
    onOpenSession(item);
  };

  return (
    <PanelModal title="Ждут тебя" icon={BellRing} onClose={onClose} contentClassName="md:h-auto md:max-h-[min(85dvh,44rem)] md:max-w-xl">
      <AttentionHubView
        items={items}
        nowMs={nowMs}
        onOpenSession={handleOpen}
        onMarkAllSeen={() => {
          void markSeen({ all: true });
        }}
        extraSections={extraSections}
        getProviderLabel={getProviderLabel}
        renderProviderMark={(provider) => {
          const known = knownProvider(provider);
          return known ? (
            <SessionProviderLogo provider={known} className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          ) : (
            <Bot aria-hidden className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          );
        }}
      />
    </PanelModal>
  );
}
