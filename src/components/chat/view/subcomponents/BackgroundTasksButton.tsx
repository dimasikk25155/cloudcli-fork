import { useEffect, useRef, useState } from 'react';

import { useWebSocket } from '../../../../contexts/WebSocketContext';
import { formatDuration } from '../../utils/stepTimer';

import { backgroundTasksStore, stopStateLabel, useBackgroundTasks } from './BackgroundTasksStore';
import type { BackgroundTaskKind } from './BackgroundTasksStore';

const KIND_LABEL: Record<BackgroundTaskKind, string> = {
  bash: 'Команда',
  agent: 'Сабагент',
  monitor: 'Монитор',
  workflow: 'Сценарий',
  other: 'Задача',
};

type BackgroundTasksButtonProps = {
  sessionId: string | null | undefined;
  tabClassName: string;
};

/**
 * «Фон: N» next to the activity indicator: the agent's background commands,
 * monitors and subagents (Claude only — other engines have none, so the
 * button never shows for them), each with its age and its own «Стоп».
 */
export default function BackgroundTasksButton({ sessionId, tabClassName }: BackgroundTasksButtonProps) {
  const { sendMessage } = useWebSocket();
  const { tasks, stops } = useBackgroundTasks(sessionId);
  const [isOpen, setIsOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      clearInterval(timer);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (tasks.length === 0) setIsOpen(false);
  }, [tasks.length]);

  if (!sessionId || tasks.length === 0) return null;

  const stopTask = (taskId: string) => {
    backgroundTasksStore.markStopping(sessionId, taskId);
    sendMessage({ type: 'chat.stop-task', sessionId, taskId });
  };

  return (
    <div ref={rootRef} className="pointer-events-auto shrink-0">
      <button
        type="button"
        onClick={() => {
          setNow(Date.now());
          setIsOpen((open) => !open);
        }}
        className={`${tabClassName} gap-1.5 whitespace-nowrap font-medium text-foreground hover:bg-accent`}
        aria-expanded={isOpen}
        aria-label={`Фоновые задачи: ${tasks.length}`}
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" aria-hidden />
        <span>{`Фон: ${tasks.length}`}</span>
      </button>

      {isOpen && (
        <div
          className="absolute bottom-full left-0 right-0 mb-1.5 max-h-[50dvh] overflow-y-auto rounded-xl border border-border/60 bg-card p-1.5 shadow-lg"
          role="dialog"
          aria-label="Фоновые задачи"
        >
          <div className="px-2 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Фоновые задачи
          </div>
          <ul className="flex flex-col gap-1">
            {tasks.map((task) => {
              const stopState = stops[task.taskId];
              return (
                <li key={task.taskId} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent/40">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-foreground" title={task.description}>
                      {task.description || KIND_LABEL[task.kind]}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {KIND_LABEL[task.kind]}
                      {' · '}
                      <span className="tabular-nums">{formatDuration(now - task.startedAt)}</span>
                      {task.lastTool ? ` · ${task.lastTool}` : ''}
                      {stopState && stopState !== 'stopping' ? (
                        <span className="text-destructive">{` · ${stopStateLabel(stopState)}`}</span>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => stopTask(task.taskId)}
                    disabled={stopState === 'stopping' || stopState === 'gone' || stopState === 'turn_ended'}
                    className="shrink-0 rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground hover:border-destructive/50 hover:text-destructive disabled:opacity-50"
                  >
                    {stopState === 'stopping' ? stopStateLabel('stopping') : 'Стоп'}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
