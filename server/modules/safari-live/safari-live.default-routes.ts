/** Production `/api/safari-live` router (mounted behind authenticateToken + requireAdmin). */

import { safariLiveBindingsDb } from '@/modules/database/index.js';
import { isModActive } from '@/shared/mods.js';

import { createSafariLiveRouter } from './safari-live.routes.js';
import { safariLiveService } from './safari-live.runtime.js';

export default createSafariLiveRouter({
  service: safariLiveService,
  bindings: safariLiveBindingsDb,
  modOn: (userId) => isModActive(userId as number, 'modSafariLive'),
  notify: (userId, sessionId) => {
    void import('@/modules/websocket/index.js')
      .then(({ notifySafariLiveChanged }) => notifySafariLiveChanged(userId, sessionId))
      .catch(() => {});
  },
});
