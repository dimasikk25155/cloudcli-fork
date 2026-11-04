/**
 * The workbench's own tab kinds: «Сессия» (inspector) and «Контекст и лимиты».
 * Imported once by the canvas; other features register theirs the same way.
 */
import React from 'react';
import { Gauge, Info } from 'lucide-react';

import SessionInspector from './inspector/SessionInspector';
import ContextLimitsCard from './limits/ContextLimitsCard';
import { registerWorkbenchTabKind } from './workbenchTabs';

registerWorkbenchTabKind('inspector', {
  defaultTitle: 'Сессия',
  icon: <Info className="h-3.5 w-3.5" aria-hidden />,
  inMenu: true,
  render: (_tab, context) => <SessionInspector context={context} />,
});

registerWorkbenchTabKind('limits', {
  defaultTitle: 'Контекст и лимиты',
  icon: <Gauge className="h-3.5 w-3.5" aria-hidden />,
  inMenu: true,
  render: (_tab, context) => <ContextLimitsCard context={context} />,
});
