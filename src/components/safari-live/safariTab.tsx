/**
 * Вид холста «Браузер»: живая страница невидимого браузера, привязанного к чату.
 * Подключается из `workbench/index.ts`.
 */
import React from 'react';
import { Compass } from 'lucide-react';

import { registerWorkbenchTabKind } from '../workbench/workbenchTabs';

import SafariLivePanel from './SafariLivePanel';

registerWorkbenchTabKind('safari', {
  defaultTitle: 'Браузер',
  icon: <Compass className="h-3.5 w-3.5" aria-hidden />,
  inMenu: true,
  available: (menu) => menu.safariLiveAvailable,
  render: (_tab, context) => (
    <div className="h-full overflow-hidden">
      <SafariLivePanel sessionId={context.sessionId} isActive={context.isActive} />
    </div>
  ),
});
