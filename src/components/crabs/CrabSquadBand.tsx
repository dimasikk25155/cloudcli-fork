import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { cn } from '../../lib/utils';
import type { ChatMessage } from '../chat/types/types';
import { useBackgroundTasks } from '../chat/view/subcomponents/BackgroundTasksStore';

import PixelCrab from './PixelCrab';
import { buildCrabSquad, crabStatusLine, formatCrabDuration, squadSummary, type Crab } from './crabModel';
import { useNow } from './useNow';

/** After the last crab is back, the band folds into its one-line tally. */
const FOLD_AFTER_MS = 5000;

type CrabSquadBandProps = {
  chatMessages: readonly ChatMessage[];
  sessionId: string | null | undefined;
  isRunActive: boolean;
};

function summaryText(crabs: readonly Crab[], now: number): string {
  const summary = squadSummary(crabs, now);
  const parts: string[] = [];
  if (summary.running > 0) parts.push(`${summary.running} в работе`);
  if (summary.done > 0) parts.push(`✅ ${summary.done} вернулись`);
  if (summary.failed > 0) parts.push(`⚠️ ${summary.failed} с ошибкой`);
  if (summary.lost > 0) parts.push(`${summary.lost} без связи`);
  const span = formatCrabDuration(summary.spanMs);
  if (span && summary.spanMs > 0) parts.push(summary.running > 0 ? `идёт ${span}` : `всё заняло ${span}`);
  return parts.join(' · ');
}

/**
 * «Стайка» over the composer: every subagent of the current turn as a crab —
 * running ones scuttle holding what they do, returned ones carry a tick. Hidden
 * when the turn launched none.
 */
export default function CrabSquadBand({ chatMessages, sessionId, isRunActive }: CrabSquadBandProps) {
  const { tasks } = useBackgroundTasks(sessionId);
  const backgroundLastTool = useMemo(() => {
    const byCall = new Map<string, string | undefined>();
    for (const task of tasks) {
      if (task.kind === 'agent' && task.toolUseId) byCall.set(task.toolUseId, task.lastTool);
    }
    return byCall;
  }, [tasks]);

  // Running crabs' timers tick while the run lasts.
  const now = useNow(isRunActive);
  const squad = useMemo(
    () => buildCrabSquad(chatMessages, { isRunActive, backgroundLastTool }, now),
    [chatMessages, isRunActive, backgroundLastTool, now],
  );
  const running = squad.some((crab) => crab.state === 'running');

  const [folded, setFolded] = useState(false);
  const squadKey = squad.map((crab) => crab.id).join('|');
  useEffect(() => {
    if (running) {
      setFolded(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setFolded(true), FOLD_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [running, squadKey]);

  if (squad.length === 0) return null;

  return (
    <div className="mx-auto mb-2 w-full min-w-0 max-w-[54.25rem] rounded-xl border border-border/50 bg-card/90 px-3 py-1.5 text-xs backdrop-blur-sm" data-crab-squad>
      <button
        type="button"
        onClick={() => setFolded((value) => !value)}
        aria-expanded={!folded}
        className="flex min-h-[28px] w-full items-center gap-2 text-left text-muted-foreground hover:text-foreground"
      >
        <span className="flex-shrink-0 whitespace-nowrap font-medium text-foreground">🦀 Помощники: {squad.length}</span>
        <span className="min-w-0">{summaryText(squad, now)}</span>
        <ChevronDown className={cn('ml-auto h-3.5 w-3.5 flex-shrink-0 transition-transform', !folded && 'rotate-180')} aria-hidden />
      </button>
      {!folded && (
        <ul className="flex flex-wrap gap-x-3 gap-y-2 pb-1 pt-2">
          {squad.map((crab) => (
            <li key={crab.id} className="flex w-[84px] flex-shrink-0 flex-col items-center gap-1 text-center">
              <span className={crab.state === 'running' ? 'crab-wander inline-flex pt-2' : 'inline-flex pt-2'}>
                <PixelCrab tint={crab.tint} state={crab.state} holding={crab.activity?.icon} scale={3} />
              </span>
              <span className="line-clamp-2 w-full break-words text-[11px] font-medium leading-tight text-foreground">{crab.title}</span>
              <span className="text-[10px] leading-tight text-muted-foreground">
                {crabStatusLine(crab)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
