import { useCallback, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { KeyRound } from 'lucide-react';

import { Button, Dialog, DialogContent, Input } from '../../../../shared/view/ui';
import {
  isValidSecretName,
  type SecretGuardChoice,
  type SecretGuardPrompt,
} from '../../utils/secretGuard';

type SecretGuardDialogProps = {
  prompt: SecretGuardPrompt;
  onChoose: (choice: SecretGuardChoice) => void;
};

function titleFor(prompt: SecretGuardPrompt): string {
  const labels = [...new Set(prompt.items.map((item) => item.label))];
  return labels.length === 1
    ? `Похоже, в сообщении ${labels[0]}`
    : `Похоже, в сообщении секреты: ${labels.join(', ')}`;
}

/**
 * «Похоже, в сообщении ключ …» — shown before a message with a credential is
 * sent. Gets kinds and suggested names only; the value never reaches here.
 * Admin: «Убрать в .secrets.env». Others: «Убрать из сообщения».
 */
export function SecretGuardDialog({ prompt, onChoose }: SecretGuardDialogProps) {
  const [open, setOpen] = useState(true);
  const [names, setNames] = useState(() => prompt.items.map((item) => item.suggestedName));
  const allValid = useMemo(() => names.every((name) => isValidSecretName(name.trim())), [names]);

  const choose = useCallback(
    (choice: SecretGuardChoice) => {
      setOpen(false);
      onChoose(choice);
    },
    [onChoose],
  );

  const removeAction = useCallback(() => {
    if (!allValid) return;
    const trimmed = names.map((name) => name.trim());
    choose(prompt.canStash ? { action: 'stash', names: trimmed } : { action: 'redact', names: trimmed });
  }, [allValid, choose, names, prompt.canStash]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    removeAction();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && open) choose({ action: 'cancel' });
      }}
    >
      <DialogContent
        className="w-[calc(100%-2rem)] max-w-md p-5"
        aria-labelledby="secret-guard-title"
        aria-describedby="secret-guard-hint"
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-amber-500/15 p-2 text-amber-600 dark:text-amber-400">
              <KeyRound className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <h3 id="secret-guard-title" className="text-base font-semibold text-foreground">{titleFor(prompt)}</h3>
              <p id="secret-guard-hint" className="mt-1 text-sm text-muted-foreground">
                {prompt.canStash
                  ? 'Сохраню значение в .secrets.env, а в сообщение вставлю имя переменной.'
                  : 'Вырежу значение, в сообщении останется [REDACTED:ИМЯ].'}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {prompt.items.map((item, index) => {
              const value = names[index] ?? '';
              const invalid = !isValidSecretName(value.trim());
              const inputId = `secret-guard-name-${index}`;
              return (
                <div key={inputId} className="flex flex-col gap-1">
                  <label htmlFor={inputId} className="text-xs text-muted-foreground">
                    {prompt.items.length > 1 ? `${item.label} — имя` : 'Имя переменной'}
                  </label>
                  <Input
                    id={inputId}
                    value={value}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    aria-invalid={invalid}
                    className="h-10 font-mono text-base sm:text-sm"
                    onChange={(event) => {
                      const next = event.target.value.toUpperCase();
                      setNames((previous) => previous.map((name, i) => (i === index ? next : name)));
                    }}
                  />
                  {invalid && (
                    <p className="text-xs text-destructive">Только A–Z, 0–9 и _, первая — буква</p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button type="submit" disabled={!allValid} className="h-11 sm:h-10">
              {prompt.canStash ? 'Убрать в .secrets.env' : 'Убрать из сообщения'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 sm:h-10"
              onClick={() => choose({ action: 'send-as-is' })}
            >
              Отправить как есть
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-11 sm:mr-auto sm:h-10"
              onClick={() => choose({ action: 'cancel' })}
            >
              Отмена
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

let closeActive: (() => void) | null = null;

/**
 * Opens the dialog on its own React root and resolves with the user's choice.
 * Self-mounting keeps the guard a single call inside the composer hook — no
 * props threaded through ChatInterface/ChatComposer.
 */
export function askSecretGuard(prompt: SecretGuardPrompt): Promise<SecretGuardChoice> {
  closeActive?.();

  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let settled = false;

    const finish = (choice: SecretGuardChoice) => {
      if (settled) return;
      settled = true;
      closeActive = null;
      resolve(choice);
      // Let the dialog commit `open=false` (focus goes back to the composer) first.
      window.setTimeout(() => {
        root.unmount();
        host.remove();
      }, 0);
    };

    closeActive = () => finish({ action: 'cancel' });
    root.render(<SecretGuardDialog prompt={prompt} onChoose={finish} />);
  });
}
