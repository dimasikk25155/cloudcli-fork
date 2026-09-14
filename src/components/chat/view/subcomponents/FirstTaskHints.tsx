import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';

import { GUIDE_URL } from '../../../../constants/branding';
import { sendToComposer } from '../../../../utils/composerDraft';
import { useProviderAuthStatus } from '../../../provider-auth/hooks/useProviderAuthStatus';

type FirstTaskHintsProps = {
  textareaRef: RefObject<HTMLTextAreaElement>;
  onShowSettings?: () => void;
};

const TASK_IDS = [
  'site',
  'crm',
  'bot',
  'content',
  'competitors',
  'offer',
  'replies',
  'spreadsheet',
  'ads',
  'knowledge',
] as const;

export default function FirstTaskHints({ onShowSettings }: FirstTaskHintsProps) {
  const { t } = useTranslation('chat');
  const { providerAuthStatus } = useProviderAuthStatus({ initialLoading: true });
  const claude = providerAuthStatus.claude;
  const claudeMissing = !claude.loading && !claude.authenticated;

  const pickTask = (taskId: (typeof TASK_IDS)[number]) => {
    sendToComposer(t(`firstTask.tasks.${taskId}.label`), {
      workMode: 'interrogate',
      autoSend: true,
      hiddenBrief: `${t('firstTask.briefPreamble')}\n\n${t(`firstTask.tasks.${taskId}.prompt`)}`,
    });
  };


  return (
    <div className="mx-auto mt-6 w-full max-w-[34.25rem] space-y-3">
      {claudeMissing && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left">
          <p className="text-sm text-foreground">{t('firstTask.claudeNeeded')}</p>
          {onShowSettings && (
            <button
              type="button"
              onClick={onShowSettings}
              className="mt-2 text-sm font-medium text-primary hover:underline"
            >
              {t('firstTask.openSettings')}
            </button>
          )}
        </div>
      )}

      <div className="text-center">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('firstTask.title')}
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          {t('firstTask.subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {TASK_IDS.map((taskId) => (
          <button
            key={taskId}
            type="button"
            onClick={() => pickTask(taskId)}
            className="rounded-xl border border-border/70 bg-card/70 px-4 py-3 text-left text-sm font-medium leading-snug text-foreground/90 transition-colors hover:border-primary/40 hover:bg-card"
          >
            {t(`firstTask.tasks.${taskId}.label`)}
          </button>
        ))}
      </div>

      <a
        href={GUIDE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex w-full items-center justify-center gap-1.5 pt-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {t('firstTask.guide')}
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}
