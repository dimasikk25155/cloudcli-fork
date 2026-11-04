/**
 * The workbench's own tab kinds: «Сессия» (inspector), «Контекст и лимиты»
 * and «Новая вкладка» of the «+» button.
 * Imported once by the canvas; other features register theirs the same way.
 */
import React from 'react';
import { Gauge, Info, LayoutGrid } from 'lucide-react';

import SessionInspector from './inspector/SessionInspector';
import ContextLimitsCard from './limits/ContextLimitsCard';
import { NEW_TAB_KIND, NEW_TAB_TITLE, registerWorkbenchTabKind } from './workbenchTabs';

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

// The launcher needs the canvas menu, so `WorkbenchCanvas` draws this pane itself; the
// registry gives the tab strip its icon and title (and keeps the kind restorable).
registerWorkbenchTabKind(NEW_TAB_KIND, {
  defaultTitle: NEW_TAB_TITLE,
  icon: <LayoutGrid className="h-3.5 w-3.5" aria-hidden />,
  inMenu: false,
  render: () => null,
});
