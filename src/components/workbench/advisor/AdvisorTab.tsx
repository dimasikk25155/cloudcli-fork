/** Body of the `advisor` canvas tab: the questions asked with /advisor and the answers. */
import React, { useSyncExternalStore } from 'react';
import { Loader2 } from 'lucide-react';

import { useModEnabled } from '../../../hooks/useModEnabled';
import type { WorkbenchTab } from '../workbenchTabs';

import { advisorStore } from './advisorStore';

export default function AdvisorTab({ tab }: { tab: WorkbenchTab }) {
  const enabled = useModEnabled('modDiagnostics');
  const sessionId = tab.ref ?? '';
  const entries = useSyncExternalStore(advisorStore.subscribe, () => advisorStore.entries(sessionId));

  if (!enabled) {
    return <p className="p-6 text-sm text-muted-foreground">Диагностика выключена в модах.</p>;
  }
  if (entries.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Напиши в чате /advisor и вопрос: сильная модель посмотрит последние сообщения и ответит здесь.
      </p>
    );
  }
  return (
    <div className="h-full space-y-4 overflow-y-auto p-4" data-advisor-tab>
      {entries.map((entry) => (
        <section key={entry.id} className="space-y-2">
          <p className="rounded-lg bg-accent/60 px-3 py-2 text-sm text-foreground">{entry.question}</p>
          {entry.status === 'pending' && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Советник думает…
            </p>
          )}
          {entry.status === 'done' && <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{entry.answer}</p>}
          {entry.status === 'error' && <p className="text-sm text-destructive">{entry.error}</p>}
        </section>
      ))}
    </div>
  );
}
