import React, { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';

import { secretCardTitle, type SecretRequestEntry } from './secretRequestsStore';

type SecretRequestCardProps = {
  entry: SecretRequestEntry;
  /** Gets the value once; the card has already forgotten it. */
  onSave: (value: string, replace: boolean) => void;
  onDecline: () => void;
  onOpenSession?: () => void;
};

/**
 * «Агент просит ключ NAME: why» — a hidden field, «Сохранить» / «Отказать».
 * The value sits in this field only until «Сохранить»: then it is handed over
 * and the field is emptied at once (a refusal means typing it again).
 */
export default function SecretRequestCard({ entry, onSave, onDecline, onOpenSession }: SecretRequestCardProps) {
  const [value, setValue] = useState('');
  const [replace, setReplace] = useState(false);
  const { request, busy, error } = entry;
  const offerReplace = request.exists || Boolean(error && /уже есть/i.test(error));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!value.trim() || busy) return;
    const secret = value;
    setValue('');
    onSave(secret, replace);
  };

  return (
    <form className="space-y-2 rounded-xl border border-border p-3" onSubmit={submit} autoComplete="off">
      <p className="flex items-start gap-2 text-sm">
        <KeyRound aria-hidden className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
        <span className="min-w-0 break-words">{secretCardTitle(request)}</span>
      </p>
      {request.sessionTitle && (
        <p className="pl-6 text-xs text-muted-foreground">
          Чат:{' '}
          {onOpenSession ? (
            <button type="button" className="hover:text-foreground hover:underline" onClick={onOpenSession}>{request.sessionTitle}</button>
          ) : request.sessionTitle}
        </p>
      )}
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        aria-label={`Значение ${request.name}`}
        className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-sm outline-none focus:ring-1 focus:ring-ring"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Значение ключа"
        disabled={busy !== null}
      />
      {offerReplace && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} disabled={busy !== null} />
          {request.exists ? 'Такой ключ уже есть в файле секретов. Заменить' : 'Заменить существующий ключ'}
        </label>
      )}
      <p className="text-[11px] text-muted-foreground">Значение уйдёт только в файл секретов. Агент узнает лишь, что ключ сохранён.</p>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          disabled={busy !== null || !value.trim()}
        >
          {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin" />}Сохранить
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent/60 disabled:opacity-50"
          disabled={busy !== null}
          onClick={onDecline}
        >
          {busy === 'decline' && <Loader2 className="h-4 w-4 animate-spin" />}Отказать
        </button>
      </div>
    </form>
  );
}
