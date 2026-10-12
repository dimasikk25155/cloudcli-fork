import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Shimmer } from '../../../../shared/view/ui';
import type { SessionActivity } from '../../../../hooks/useSessionProtection';
import { formatDuration, isStepOverdue } from '../../utils/stepTimer';

import BackgroundTasksButton from './BackgroundTasksButton';

type ActivityIndicatorProps = {
  activity: SessionActivity | null;
  onAbort?: () => void;
  isInputFocused?: boolean;
  /** Session the activity belongs to: its background tasks («Фон: N»). */
  sessionId?: string | null;
};

const ACTION_KEYS = [
  'claudeStatus.actions.thinking',
  'claudeStatus.actions.processing',
  'claudeStatus.actions.analyzing',
  'claudeStatus.actions.working',
  'claudeStatus.actions.computing',
  'claudeStatus.actions.reasoning',
];
const DEFAULT_ACTION_WORDS = ['Thinking', 'Processing', 'Analyzing', 'Working', 'Computing', 'Reasoning'];
const EXIT_ANIMATION_MS = 220;

/**
 * Minimal response-in-progress indicator, in the spirit of the inline status
 * lines in Claude Code / Codex / OpenCode: a shimmering activity label, the
 * elapsed time, and an interrupt affordance. Rendered only while the viewed
 * session has an entry in the processing map; it disappears the instant that
 * entry is removed.
 */
export default function ActivityIndicator({ activity, onAbort, isInputFocused = false, sessionId = null }: ActivityIndicatorProps) {
  const { t } = useTranslation('chat');
  const [renderedActivity, setRenderedActivity] = useState<SessionActivity | null>(activity);
  const [isExiting, setIsExiting] = useState(false);
  const startedAt = renderedActivity?.startedAt ?? null;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (activity) {
      setRenderedActivity(activity);
      setIsExiting(false);
      return;
    }

    if (!renderedActivity) return;

    setIsExiting(true);
    const timer = setTimeout(() => {
      setRenderedActivity(null);
      setIsExiting(false);
    }, EXIT_ANIMATION_MS);

    return () => clearTimeout(timer);
  }, [activity, renderedActivity]);

  useEffect(() => {
    if (startedAt === null) return;
    const update = () => {
      const current = Date.now();
      setNow(current);
      setElapsedSeconds(Math.max(0, Math.floor((current - startedAt) / 1000)));
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (!renderedActivity) return null;

  const actionWords = ACTION_KEYS.map((key, i) => t(key, { defaultValue: DEFAULT_ACTION_WORDS[i] }));
  const phaseLabel = renderedActivity.activityKind === 'tools'
    ? (renderedActivity.toolName
      ? t('claudeStatus.usingTools', { name: renderedActivity.toolName, defaultValue: 'Tools: {{name}}' })
      : t('toolGroup.mixedLabel', { defaultValue: 'Tools' }))
    : renderedActivity.activityKind === 'thinking'
      ? t('claudeStatus.actions.thinking', { defaultValue: 'Thinking' })
      : null;
  // The current step (one tool call) has its own clock; the turn's total is secondary.
  const step = renderedActivity.step ?? null;
  const isOverdue = isStepOverdue(step, now);
  const label = (step?.name || phaseLabel || renderedActivity.statusText || actionWords[Math.floor(elapsedSeconds / 4) % actionWords.length])
    .replace(/\.+$/, '');

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const elapsedLabel = minutes < 1
    ? t('claudeStatus.elapsed.seconds', { count: seconds, defaultValue: '{{count}}s' })
    : t('claudeStatus.elapsed.minutesSeconds', { minutes, seconds, defaultValue: '{{minutes}}m {{seconds}}s' });
  const tabBaseClassName = 'chat-activity-tab inline-flex h-8 items-center rounded-b-none rounded-t-lg border border-b-0 bg-card px-3 text-xs transition-all duration-200';
  const tabNeutralClassName = [
    tabBaseClassName,
    isInputFocused
      ? 'border-primary/30 shadow-[0_-1px_2px_hsl(var(--foreground)/0.08),1px_0_2px_hsl(var(--foreground)/0.06),-1px_0_2px_hsl(var(--foreground)/0.06)]'
      : 'border-border/50 shadow-[0_-1px_1px_hsl(var(--foreground)/0.04),1px_0_1px_hsl(var(--foreground)/0.03),-1px_0_1px_hsl(var(--foreground)/0.03)]',
  ].join(' ');
  // A step past its limit turns its own tab and «Прервать» red; «Фон» stays neutral.
  const tabSurfaceClassName = isOverdue
    ? `${tabBaseClassName} border-destructive/60 shadow-[0_-1px_2px_hsl(var(--destructive)/0.15)]`
    : tabNeutralClassName;

  return (
    <div
      className={`pointer-events-none bg-transparent ${
        isExiting ? 'chat-activity-exit' : 'chat-activity-enter'
      }`}
    >
      <div className="relative flex items-end justify-between gap-2">
        <div className="flex min-w-0 items-end gap-1.5">
          <div
            className={`${tabSurfaceClassName} min-w-0 gap-2 ${isOverdue ? 'text-destructive' : ''}`}
            title={step ? `Шаг ${step.name} идёт ${formatDuration(now - step.startedAt)}, весь ход — ${elapsedLabel}` : undefined}
          >
            <span className={`h-1.5 w-1.5 shrink-0 animate-pulse rounded-full ${isOverdue ? 'bg-destructive' : 'bg-primary'}`} aria-hidden />
            {isOverdue
              ? <span className="truncate font-medium">{`${label}…`}</span>
              : <Shimmer className="truncate font-medium">{`${label}…`}</Shimmer>}
            {step ? (
              <>
                <span className={`shrink-0 tabular-nums ${isOverdue ? 'font-medium' : 'text-muted-foreground/80'}`}>
                  {formatDuration(now - step.startedAt)}
                </span>
                {/* A red step needs the room; the turn total stays in the tooltip. */}
                {!isOverdue && (
                  <span className="shrink-0 tabular-nums text-muted-foreground/50">{`· ${elapsedLabel}`}</span>
                )}
              </>
            ) : (
              <span className="shrink-0 tabular-nums text-muted-foreground/60">{elapsedLabel}</span>
            )}
          </div>
          <BackgroundTasksButton sessionId={sessionId} tabClassName={tabNeutralClassName} />
        </div>

        {renderedActivity.canInterrupt && onAbort && (
          <button
            type="button"
            onClick={onAbort}
            className={`${tabSurfaceClassName} pointer-events-auto shrink-0 gap-1.5 ${
              isOverdue ? 'font-medium text-destructive hover:bg-destructive/10' : 'text-muted-foreground hover:bg-card hover:text-destructive'
            }`}
            aria-label={isOverdue ? 'Прервать затянувшийся шаг' : t('claudeStatus.stop', { defaultValue: 'Stop' })}
          >
            <svg className="h-2.5 w-2.5 fill-current" viewBox="0 0 24 24" aria-hidden>
              <rect x="5" y="5" width="14" height="14" rx="2" />
            </svg>
            <span>{isOverdue ? 'Прервать' : t('claudeStatus.stop', { defaultValue: 'Stop' })}</span>
            <kbd className="hidden rounded border border-border/60 px-1 text-[10px] text-muted-foreground/70 sm:inline-block">
              esc
            </kbd>
          </button>
        )}
      </div>
    </div>
  );
}
