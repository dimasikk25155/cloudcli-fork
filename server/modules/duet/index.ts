export { default as duetRoutes, createDuetRouter } from './duet.routes.js';
export { createDuetService } from './duet.service.js';
export type { DuetApi, DuetView, DuetNotice } from './duet.service.js';
export { startDuetWatch, stopDuetWatch, DUET_NOTICE_CODE } from './duet.runtime.js';
