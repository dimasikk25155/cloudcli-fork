/**
 * Canvas tab kinds of «Побочный чат» (modSideChat):
 * - `btw` — a side chat asked with `/btw` or «Спросить в стороне» (ref = child id);
 * - `chat` — a second chat next to this one (ref = any chat of the project;
 *   opened from «+» without a ref, it first asks which chat to show).
 * Closing a tab only closes the tab: the chat itself stays in the sidebar.
 * Both stay mounted (hidden) while another canvas tab is active: a running
 * answer, the scroll and the draft are where they were on return.
 */
import React from 'react';
import { MessageCircleQuestion, MessagesSquare } from 'lucide-react';

import { registerWorkbenchTabKind } from '../workbenchTabs';

import SideChatTab from './SideChatTab';

registerWorkbenchTabKind('btw', {
  defaultTitle: 'Побочный чат',
  icon: <MessageCircleQuestion className="h-3.5 w-3.5" aria-hidden />,
  keepMounted: true,
  render: (tab, context) => <SideChatTab tab={tab} context={context} />,
});

registerWorkbenchTabKind('chat', {
  defaultTitle: 'Второй чат',
  icon: <MessagesSquare className="h-3.5 w-3.5" aria-hidden />,
  inMenu: true,
  keepMounted: true,
  render: (tab, context) => <SideChatTab tab={tab} context={context} />,
});
