import { useTranslation } from 'react-i18next';
import { Loader2, PencilIcon, SendIcon, XIcon } from 'lucide-react';

interface QueuedMessageCardProps {
  content: string;
  imageCount?: number;
  onEdit: () => void;
  onDelete: () => void;
  /** Soft-stops the running turn and sends this draft immediately (resumes the same session) instead of waiting for the turn to finish on its own. */
  onSendNow?: () => void;
  canSendNow?: boolean;
  isSendingNow?: boolean;
}

export default function QueuedMessageCard({
  content,
  imageCount = 0,
  onEdit,
  onDelete,
  onSendNow,
  canSendNow = false,
  isSendingNow = false,
}: QueuedMessageCardProps) {
  const { t } = useTranslation('chat');

  return (
    <div className="settings-content-enter mx-auto mb-2 max-w-[54.25rem] rounded-xl border border-dashed border-primary/25 bg-primary/[0.04] px-3 py-2">
      <div className="flex items-start gap-2.5">
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" aria-hidden />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-primary/70">
            <span>{t('input.queue.label', { defaultValue: 'Queued' })}</span>
            <span className="normal-case text-muted-foreground/60">
              · {isSendingNow
                ? t('input.queue.sendingNow', { defaultValue: 'Stopping current turn…' })
                : t('input.queue.willSend', { defaultValue: 'Will send when this finishes' })}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 break-words text-sm text-foreground/90">{content}</p>
          {imageCount > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('input.queue.imagesAttached', { count: imageCount, defaultValue: '{{count}} image attached' })}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {onSendNow && (
            <button
              type="button"
              onClick={onSendNow}
              disabled={!canSendNow || isSendingNow}
              aria-label={t('input.queue.sendNow', { defaultValue: 'Stop and send now' })}
              title={t('input.queue.sendNow', { defaultValue: 'Stop and send now' })}
              className="rounded-md p-1.5 text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSendingNow ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <SendIcon className="h-3.5 w-3.5" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onEdit}
            aria-label={t('input.queue.edit', { defaultValue: 'Edit queued message' })}
            title={t('input.queue.edit', { defaultValue: 'Edit queued message' })}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <PencilIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={t('input.queue.delete', { defaultValue: 'Delete queued message' })}
            title={t('input.queue.delete', { defaultValue: 'Delete queued message' })}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
