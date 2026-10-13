import React from 'react';
import type { SubagentState } from '../../types/types';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../../../../shared/view/ui';
import PixelCrab from '../../../crabs/PixelCrab';
import {
  CRAB_TINT_LABEL,
  crabFromMessage,
  crabStatusLine,
} from '../../../crabs/crabModel';
import { useNow } from '../../../crabs/useNow';
import { useUiPreferenceValue } from '../../../../hooks/useUiPreferences';
import { SubagentCard } from './SubagentCard';

interface SubagentContainerProps {
  toolInput: unknown;
  toolId?: string;
  toolResult?: { content?: unknown; isError?: boolean } | null;
  subagentState: SubagentState;
  isRunActive?: boolean;
}

const getCompactToolDisplay = (toolName: string, toolInput: unknown): string => {
  const input = typeof toolInput === 'string' ? (() => {
    try { return JSON.parse(toolInput); } catch { return {}; }
  })() : (toolInput || {});

  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'ApplyPatch':
      return input.file_path?.split('/').pop() || input.file_path || '';
    case 'Grep':
    case 'Glob':
      return input.pattern || '';
    case 'Bash':
      const cmd = input.command || '';
      return cmd.length > 40 ? `${cmd.slice(0, 40)}...` : cmd;
    case 'Task':
    case 'Agent':
      return input.description || input.subagent_type || '';
    case 'WebFetch':
    case 'WebSearch':
      return input.url || input.query || '';
    default:
      return '';
  }
};

function resultText(content: unknown): string {
  let value = content;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) value = parsed;
    } catch {
      return value as string;
    }
  }
  if (Array.isArray(value)) {
    const parts = value.filter((part: any) => part?.type === 'text' && part.text).map((part: any) => part.text);
    return parts.join('\n');
  }
  return value ? JSON.stringify(value, null, 2) : '';
}

/**
 * One subagent in the transcript: a crab with a Russian one-liner — who, what
 * it is doing, how long. The English task, its steps and its answer are for
 * debugging only and stay folded under «Подробности».
 */
const CrabRow: React.FC<SubagentContainerProps> = ({
  toolInput,
  toolId,
  toolResult,
  subagentState,
  isRunActive = true,
}) => {
  const parsedInput = typeof toolInput === 'string' ? (() => {
    try { return JSON.parse(toolInput); } catch { return {}; }
  })() : (toolInput || {});

  const running = !subagentState.isComplete && isRunActive;
  const now = useNow(running);
  const crab = crabFromMessage(
    { type: 'assistant', timestamp: 0, isSubagentContainer: true, subagentState, toolInput, toolId },
    { isRunActive },
    now,
  );
  if (!crab) return null;

  const prompt = parsedInput?.prompt || '';
  const { childTools } = subagentState;
  const answer = subagentState.isComplete && !subagentState.isAsync && toolResult ? resultText(toolResult.content) : '';

  return (
    <Collapsible className="my-1 py-0.5" data-crab-row={crab.state}>
      <div className="flex items-center gap-3">
        <span className={crab.state === 'running' ? 'crab-wander inline-flex pt-1.5' : 'inline-flex pt-1.5'}>
          <PixelCrab tint={crab.tint} state={crab.state} holding={crab.activity?.icon} scale={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{crab.title}</div>
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>
              {crabStatusLine(crab, { withActions: true })}
            </span>
            <CollapsibleTrigger className="flex items-center gap-0.5 text-[11px] text-muted-foreground/70 hover:text-foreground">
              <span>Подробности</span>
              <svg
                className="h-2.5 w-2.5 flex-shrink-0 transition-transform duration-150 data-[state=open]:rotate-90"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </CollapsibleTrigger>
          </div>
        </div>
      </div>

      <CollapsibleContent>
        <div className="ml-[44px] mt-1 space-y-2 border-l border-border pl-3 text-xs text-muted-foreground">
          <div>Модель: {CRAB_TINT_LABEL[crab.tint]}{parsedInput?.subagent_type ? ` · ${parsedInput.subagent_type}` : ''}</div>
          {prompt && (
            <div>
              <div className="mb-0.5 text-muted-foreground/70">Задание:</div>
              <div className="line-clamp-6 whitespace-pre-wrap break-words">{prompt}</div>
            </div>
          )}
          {childTools.length > 0 && (
            <div>
              <div className="mb-0.5 text-muted-foreground/70">Шаги ({childTools.length}):</div>
              <div className="space-y-0.5">
                {childTools.map((child, index) => (
                  <div key={child.toolId} className="flex items-center gap-1.5 text-[11px]">
                    <span className="w-4 flex-shrink-0 text-right text-muted-foreground/60">{index + 1}.</span>
                    <span className="font-medium text-foreground">{child.toolName}</span>
                    {getCompactToolDisplay(child.toolName, child.toolInput) && (
                      <span className="truncate font-mono text-muted-foreground/70">
                        {getCompactToolDisplay(child.toolName, child.toolInput)}
                      </span>
                    )}
                    {child.toolResult?.isError && (
                      <span className="flex-shrink-0 text-red-500">(ошибка)</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {answer && (
            <div>
              <div className="mb-0.5 text-muted-foreground/70">Ответ:</div>
              <div className="line-clamp-6 whitespace-pre-wrap break-words">{answer}</div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

/** A subagent in the transcript: a crab while the mod is on, else the plain card. */
export const SubagentContainer: React.FC<SubagentContainerProps> = (props) => {
  const crabs = useUiPreferenceValue('subagentCrabs');
  return crabs ? <CrabRow {...props} /> : <SubagentCard {...props} />;
};
