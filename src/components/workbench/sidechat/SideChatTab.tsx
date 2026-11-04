/**
 * Body of the `btw` and `chat` canvas tabs: the mod switch, the second-chat
 * picker (a `chat` tab without a ref), then the chat pane itself.
 */
import React from 'react';

import { useModEnabled } from '../../../hooks/useModEnabled';
import type { WorkbenchRenderContext, WorkbenchTab } from '../workbenchTabs';

import WorkbenchChatPane from './WorkbenchChatPane';
import { chatPickerChoices } from './sideChatModel';

function ChatPicker({ context }: { context: WorkbenchRenderContext }) {
  const choices = chatPickerChoices(context.project.sessions ?? [], context.sessionId);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="flex-shrink-0 border-b border-border/60 px-3 py-2 text-sm text-muted-foreground">
        Какой чат открыть рядом? Сообщения отсюда уйдут только в него.
      </p>
      {choices.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">В этом проекте нет других чатов.</p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto p-1">
          {choices.map((choice) => (
            <li key={choice.sessionId}>
              <button
                type="button"
                onClick={() => {
                  context.openTab({ kind: 'chat', ref: choice.sessionId, title: choice.title });
                  context.closeTab();
                }}
                className="w-full truncate rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-accent"
              >
                {choice.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function SideChatTab({ tab, context }: { tab: WorkbenchTab; context: WorkbenchRenderContext }) {
  const on = useModEnabled('modSideChat');
  if (!on) {
    return <p className="p-6 text-sm text-muted-foreground">Побочный чат выключен в модах. Сам чат остался в списке слева.</p>;
  }
  if (!tab.ref) {
    return tab.kind === 'chat'
      ? <ChatPicker context={context} />
      : <p className="p-6 text-sm text-muted-foreground">Чат этой вкладки не найден.</p>;
  }
  // A new pane per chat: the picker turns into a tab of the chosen chat.
  return <WorkbenchChatPane key={tab.ref} tab={tab} sessionId={tab.ref} context={context} />;
}
