import { useState } from 'react';
import { ExternalLink, MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { APP_NAME, CLOUDCLI_WORDMARK_FONT_FAMILY, GUIDE_URL } from '../../../../constants/branding';
import { useVersionCheck } from '../../../../hooks/useVersionCheck';
import { useAuth } from '../../../auth/context/AuthContext';

const GITHUB_REPO_URL = 'https://github.com/siteboon/claudecodeui';

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

/**
 * Вкладка "О программе".
 *
 * Была витриной апстрима: кнопка "Star on GitHub", ссылки на его Discord и
 * сайт, баннер платного хостинга и блок "Claude CLI Pro Features" с замочками
 * на фичах, которые в этой сборке давно работают. Клиенту, купившему систему,
 * всё это показывало чужой продукт и предлагало уйти к конкуренту.
 *
 * Оставлено ровно то, что требует лицензия: имя апстрима, ссылка на его
 * репозиторий, AGPL-3.0 и явная пометка, что сборка изменённая
 * (LICENSE, дополнительные условия по Section 7, пункты 1-2).
 */
export default function AboutTab() {
  const { t } = useTranslation('settings');
  const { restartOnboarding } = useAuth();
  const [replayError, setReplayError] = useState('');
  const [isReplaying, setIsReplaying] = useState(false);
  const { updateAvailable, latestVersion, currentVersion, releaseInfo } = useVersionCheck(
    'siteboon',
    'claudecodeui',
  );
  const releasesUrl = releaseInfo?.htmlUrl || `${GITHUB_REPO_URL}/releases`;

  const handleReplay = async () => {
    setReplayError('');
    setIsReplaying(true);
    const result = await restartOnboarding();
    setIsReplaying(false);
    if (!result.success) {
      setReplayError(t('about.replayError'));
    }
  };

  return (
    <div className="space-y-6">
      {/* Logo + name + version */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/90 shadow-sm">
          <MessageSquare className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span
              className="text-base font-semibold text-foreground"
              style={{ fontFamily: CLOUDCLI_WORDMARK_FONT_FAMILY }}
            >
              {APP_NAME}
            </span>
            <a
              href={releasesUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              v{currentVersion}
            </a>
            {updateAvailable && latestVersion && (
              <a
                href={releasesUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary/20"
              >
                {t('apiKeys.version.updateAvailable', { version: latestVersion })}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('apiKeys.version.tagline')}</p>
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
        <p className="text-sm font-medium text-foreground">{t('about.replay')}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('about.replayHelp')}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleReplay()}
            disabled={isReplaying}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
          >
            {t('about.replay')}
          </button>
          <a
            href={GUIDE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {t('about.guide')}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        {replayError && <p className="mt-2 text-xs text-destructive">{replayError}</p>}
      </div>

      {/* Атрибуция апстрима — обязательна по AGPL-3.0 (Section 7, п. 1-2). */}
      <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('apiKeys.version.attribution')}
        </p>
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <GitHubIcon className="h-3.5 w-3.5" />
          CloudCLI UI
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* License */}
      <div className="border-t border-border/50 pt-4">
        <p className="text-xs text-muted-foreground/60">{t('apiKeys.version.license')}</p>
      </div>
    </div>
  );
}
