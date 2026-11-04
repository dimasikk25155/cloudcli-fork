import React from 'react';
import { Gauge, Files } from 'lucide-react';

import { useModEnabled } from '../../../hooks/useModEnabled';
import { normalizeProviderLimits } from '../../../utils/providerLimits';
import { useAttentionItem } from '../../attention/useAttention';
import { useCodeStatus } from '../../code-status/useCodeStatus';
import { useMcpNames, useSessionEngine, useSessionTokenUsage } from '../useSessionFacts';
import { getWorkbenchTabKind, type WorkbenchRenderContext } from '../workbenchTabs';

import { buildInspectorRows, UNKNOWN } from './inspectorModel';

const MAX_FILES_SHOWN = 12;

/** «Сессия»: where the chat works, on what, in what state — for every engine. */
export default function SessionInspector({ context }: { context: WorkbenchRenderContext }) {
  const { project, session, sessionId, openTab } = context;
  const codeStatusOn = useModEnabled('modCodeStatus');
  const codeStatus = useCodeStatus(codeStatusOn ? project.projectId : null);
  const engine = useSessionEngine(session);
  const usage = useSessionTokenUsage(project.projectId, sessionId);
  const projectPath = project.fullPath || (typeof project.path === 'string' ? project.path : '') || null;
  const mcpNames = useMcpNames(engine.provider, projectPath);
  const attention = useAttentionItem(sessionId);

  const rows = buildInspectorRows({
    projectPath,
    git: codeStatus.status?.git ?? null,
    provider: engine.provider,
    modelLabel: engine.modelLabel,
    effort: engine.effort,
    attention: attention ? { state: attention.state, reason: attention.reason } : null,
    context: normalizeProviderLimits(engine.provider, { tokenUsage: usage, contextWindow: engine.contextWindow }).context,
    mcpNames,
  });
  const artifactsKind = getWorkbenchTabKind('artifacts');

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4" data-workbench-inspector>
      {!sessionId && (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
          Это новый чат: часть сведений появится после первого сообщения.
        </p>
      )}
      <section className="rounded-xl border border-border bg-card">
        <h3 className="border-b border-border/70 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Сессия
        </h3>
        <dl className="divide-y divide-border/60">
          {rows.map((row) => (
            <div key={row.id} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 px-4 py-2.5 text-sm" data-inspector-row={row.id}>
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className={`break-words ${row.value === UNKNOWN ? 'text-muted-foreground' : 'text-foreground'}`}>
                    {row.value}
                  </span>
                  {row.id === 'context' && (
                    <button
                      type="button"
                      onClick={() => openTab({ kind: 'limits', title: 'Контекст и лимиты' })}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-primary hover:bg-primary/10"
                    >
                      <Gauge className="h-3.5 w-3.5" aria-hidden />
                      Лимиты
                    </button>
                  )}
                </div>
                {row.detail && <div className="mt-0.5 text-xs text-muted-foreground">{row.detail}</div>}
                {row.items && (
                  <ul className="mt-1 space-y-0.5 font-mono text-xs text-muted-foreground">
                    {row.items.slice(0, MAX_FILES_SHOWN).map((file) => (
                      <li key={file} className="truncate" title={file}>{file}</li>
                    ))}
                    {row.items.length > MAX_FILES_SHOWN && <li>и ещё {row.items.length - MAX_FILES_SHOWN}</li>}
                  </ul>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-xl border border-border bg-card px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Результаты</h3>
        {artifactsKind ? (
          <button
            type="button"
            onClick={() => openTab({ kind: 'artifacts', title: artifactsKind.defaultTitle })}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent"
          >
            <Files className="h-4 w-4" aria-hidden />
            Открыть результаты
          </button>
        ) : (
          <p className="mt-1.5 text-sm text-muted-foreground">
            Пока нет. Сюда попадут документы, HTML и отчёты, которые опубликует агент.
          </p>
        )}
      </section>
    </div>
  );
}
