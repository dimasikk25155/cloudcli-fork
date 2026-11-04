/** Canvas tab kind `advisor` (modDiagnostics): answers of /advisor. ref = the chat id. */
import React from 'react';
import { Lightbulb } from 'lucide-react';

import { registerWorkbenchTabKind } from '../workbenchTabs';

import AdvisorTab from './AdvisorTab';

registerWorkbenchTabKind('advisor', {
  defaultTitle: 'Советник',
  icon: <Lightbulb className="h-3.5 w-3.5" aria-hidden />,
  render: (tab) => <AdvisorTab tab={tab} />,
});
