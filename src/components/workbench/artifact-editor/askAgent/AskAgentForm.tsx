/**
 * Форма «Попросить агента»: снимок участка (можно пометить в редакторе
 * пометок), текст просьбы, «Отправить агенту». Общая для выделения в режиме
 * «Правка» и для участка растровой картинки.
 */

import React, { useEffect, useState } from 'react';
import { Loader2, PenLine, Send } from 'lucide-react';

import ImageMarkupEditor from '../../../chat/view/subcomponents/ImageMarkupEditor';

const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50';
const btnPrimary = 'inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50';

export type SnapshotState = 'loading' | 'ready' | 'none';

export default function AskAgentForm({ heading, snapshot, snapshotState, onSnapshotChange, onSend, onCancel, note }: {
  heading: string;
  snapshot: File | null;
  snapshotState: SnapshotState;
  onSnapshotChange: (file: File) => void;
  onSend: (request: string) => void;
  onCancel: () => void;
  /** Where the message goes (this chat / the source chat). */
  note?: string | null;
}) {
  const [request, setRequest] = useState('');
  const [marking, setMarking] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!snapshot) {
      setPreviewUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(snapshot);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [snapshot]);

  const canSend = request.trim().length > 0 && snapshotState !== 'loading';

  return (
    <div className="space-y-2 text-sm" data-ask-agent-form>
      <p className="text-xs font-medium text-foreground">{heading}</p>
      <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
        {snapshotState === 'loading' ? (
          <p role="status" className="flex items-center gap-2 p-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />Снимаем участок…</p>
        ) : previewUrl ? (
          <img src={previewUrl} alt="Снимок участка" className="block max-h-48 w-full object-contain" />
        ) : (
          <p className="p-3 text-xs text-muted-foreground">Снимок не получился — просьба уйдёт без снимка, с пометкой об этом.</p>
        )}
      </div>
      {snapshot && snapshotState === 'ready' && (
        <button type="button" className={btn} onClick={() => setMarking(true)} title="Обвести, подписать, показать стрелкой">
          <PenLine className="h-3.5 w-3.5" aria-hidden />Пометить на снимке
        </button>
      )}
      <textarea
        value={request}
        onChange={(event) => setRequest(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canSend) {
            event.preventDefault();
            onSend(request);
          } else if (event.key === 'Escape') {
            event.stopPropagation();
            onCancel();
          }
        }}
        rows={3}
        autoFocus
        placeholder="Что сделать? Например: сделай кнопку как в шапке"
        aria-label="Просьба агенту"
        className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
      />
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
      <div className="flex gap-1.5">
        <button type="button" className={btnPrimary} disabled={!canSend} onClick={() => onSend(request)} title="⌘ + Enter">
          <Send className="h-3.5 w-3.5" aria-hidden />Отправить агенту
        </button>
        <button type="button" className={btn} onClick={onCancel}>Отмена</button>
      </div>
      {marking && snapshot && (
        <ImageMarkupEditor
          file={snapshot}
          onSave={(file) => {
            onSnapshotChange(file);
            setMarking(false);
          }}
          onCancel={() => setMarking(false)}
        />
      )}
    </div>
  );
}
