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
  const { restartOnboarding, user } = useAuth();
  const [replayError, setReplayError] = useState('');
  const [isReplaying, setIsReplaying] = useState(false);
  const isAdmin = user?.role === 'admin';
  const { report, checking, reportError, currentVersion, checkUpstream, healthError } = useVersionCheck(
    'siteboon', 'claudecodeui', isAdmin,
  );
  const releasesUrl = report?.release?.url || `${GITHUB_REPO_URL}/releases`;
  const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString('ru-RU') : 'Ещё не было';

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

          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('apiKeys.version.tagline')}</p>
        </div>
      </div>

      {isAdmin && (
        <section aria-label="Обновления исходного CloudCLI" className="space-y-4 rounded-xl border border-border/60 bg-muted/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Обновления исходного CloudCLI</h3>
              <p className="mt-1 text-xs text-muted-foreground">Проверка только читает изменения. CLI движков обновляются отдельно.</p>
            </div>
            <button type="button" disabled={checking} onClick={() => void checkUpstream()}
              className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-60">
              {checking ? 'Проверяем…' : 'Проверить сейчас'}
            </button>
          </div>
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Ожидает согласования · установка отключена</p>
          <div role="status" aria-live="polite" className="text-xs text-muted-foreground">
            <p>Последняя попытка: {formatDate(report?.checkedAt)}</p>
            <p>Успешная проверка: {formatDate(report?.lastSuccessfulCheckAt)}</p>
            {report?.checking && <p>{report.checkNotice || 'Другая проверка уже выполняется.'}</p>}
            {report?.stale && <p className="mt-1 text-amber-700 dark:text-amber-300">Отчёт устарел. Ниже сохранены последние успешные данные.</p>}
            {!report && !checking && !reportError && <p className="mt-1">Отчёт ещё не создан. Нажмите «Проверить сейчас».</p>}
          </div>
          {(reportError || healthError) && <p role="alert" className="break-words text-xs text-destructive">{reportError || healthError}</p>}
          {report?.fork && (
            <dl className="grid gap-3 text-xs sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Текущий форк · v{report.fork.version}</dt>
                <dd className="mt-1 break-all font-mono">{report.fork.sha}</dd>
                <dd className="mt-1 text-muted-foreground">{report.fork.branch} · {report.fork.dirty ? 'Есть локальные правки' : 'Рабочая копия чистая'}</dd></div>
              <div><dt className="text-muted-foreground">Стабильный релиз</dt>
                <dd className="mt-1"><a href={report.release?.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">{report.release?.tag}</a></dd>
                <dd className="mt-1 break-all font-mono">{report.release?.sha}</dd></div>
              <div className="sm:col-span-2"><dt className="text-muted-foreground">Кандидат main · может включать изменения вне релиза</dt>
                <dd className="mt-1 break-all font-mono"><a href={report.upstream?.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">{report.upstream?.sha}</a></dd></div>
            </dl>
          )}
          {report?.reviewedProposal && (
            <div className="space-y-3 border-t border-border/50 pt-3 text-xs">
              <p className="font-medium">Что полезно перенести · ручной обзор {report.reviewedProposal.reviewedAt}</p>
              <p className="text-muted-foreground">{report.reviewedProposal.method}</p>
              {report.reviewedProposal.needsReview && <p className="text-amber-700 dark:text-amber-300">Снимок кода изменился или есть локальные правки — перед переносом нужна повторная сверка.</p>}
              <p className="font-medium">Первый набор для согласования</p>
              <ul className="space-y-3">{report.reviewedProposal.firstBatch.map(item => (
                <li key={item.sha}><a className="text-primary underline" href={`${GITHUB_REPO_URL}/commit/${item.sha}`} target="_blank" rel="noopener noreferrer">{item.title}</a>
                  <p className="mt-1 text-muted-foreground">Отсутствовало при обзоре. {item.risk}</p></li>
              ))}</ul>
              <details><summary className="cursor-pointer text-muted-foreground">Второй набор и уже покрытые изменения</summary>
                <ul className="mt-2 space-y-3">{report.reviewedProposal.secondBatch.map(item => (
                  <li key={item.sha}><a className="text-primary underline" href={`${GITHUB_REPO_URL}/commit/${item.sha}`} target="_blank" rel="noopener noreferrer">{item.title}</a>
                    <p className="mt-1 text-muted-foreground">Отсутствовало при обзоре. {item.risk}</p></li>
                ))}</ul>
                <p className="mt-3 text-muted-foreground">{report.reviewedProposal.partial}</p>
                <p className="mt-2 text-muted-foreground">Уже есть: {report.reviewedProposal.alreadyPresent.join('; ')}.</p>
                <p className="mt-2 break-all font-mono text-muted-foreground">Снимок форка: {report.reviewedProposal.forkSha}<br />Снимок upstream: {report.reviewedProposal.upstreamSha}</p>
              </details>
            </div>
          )}
          {report?.changes && (
            <>
              <div className="border-t border-border/50 pt-3 text-xs">
                <p className="font-medium">Изменения для рассмотрения</p>
                <p className="mt-1 text-muted-foreground">{report.changes.ancestry
                  ? `По истории Git: ${report.changes.ancestry.upstreamOnly} коммитов только upstream, ${report.changes.ancestry.forkOnly} только форка.`
                  : 'История Git и совпадения cherry-pick пока не подтверждены.'} Это не счётчик отсутствующих функций.</p>
                <ul className="mt-2 space-y-2">
                  {report.changes.candidates.slice(0, 8).map(candidate => (
                    <li key={candidate.sha} className="break-words"><a href={candidate.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{candidate.subject}</a>
                      {candidate.coverage === 'patch-equivalent' && <span className="text-muted-foreground"> · эквивалентный патч уже есть</span>}</li>
                  ))}
                </ul>
                <details className="mt-3"><summary className="cursor-pointer text-muted-foreground">Риски и пересечения ({report.changes.overlap.length})</summary>
                  <ul className="mt-2 space-y-2 text-muted-foreground">{report.changes.risks.map(risk => <li key={risk}>{risk}</li>)}</ul>
                  <p className="mt-2 break-all font-mono text-muted-foreground">{report.changes.overlap.slice(0, 12).join(', ') || 'Пересечения путей не обнаружены; ручные переносы требуют отдельной проверки.'}</p>
                </details>
              </div>
              <p className="break-words border-t border-border/50 pt-3 text-xs leading-relaxed text-muted-foreground">{report.nextStep}</p>
            </>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">Для подготовки переноса передайте агенту SHA кандидата и выбранные изменения. Ваше согласование требуется до переноса кода. Эта кнопка ничего не устанавливает.</p>
        </section>
      )}

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
