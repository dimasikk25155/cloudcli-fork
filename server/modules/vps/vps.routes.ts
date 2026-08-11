import express from 'express';

import {
  getSettings as getAlertSettings,
  resolveChatId,
  runCheck,
  saveSettings as saveAlertSettings,
  sendTestMessage,
} from '@/modules/vps/vps-alerts.service.js';
import { getIngestToken, ingestTokenMatches, listRemoteHosts, saveReport } from '@/modules/vps/vps-reports.service.js';
import {
  controlService,
  diagnose,
  getInventory,
  getLogs,
  getOverview,
  getRecentErrors,
  getWindows,
  listServices,
  type ServiceAction,
} from '@/modules/vps/vps.service.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

const router = express.Router();

const ACTIONS: ServiceAction[] = ['start', 'stop', 'restart', 'enable', 'disable'];

function firstQueryValue(value: unknown): string | undefined {
  return Array.isArray(value) ? String(value[0]) : value == null ? undefined : String(value);
}

router.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    res.json(createApiSuccessResponse(await getOverview()));
  }),
);

router.get(
  '/services',
  asyncHandler(async (_req, res) => {
    res.json(createApiSuccessResponse({ services: await listServices() }));
  }),
);

router.post(
  '/services/:unit/:action',
  asyncHandler(async (req, res) => {
    const action = String(req.params.action) as ServiceAction;
    if (!ACTIONS.includes(action)) {
      throw new AppError(`Неизвестное действие: ${action}`, { code: 'VPS_BAD_ACTION', statusCode: 400 });
    }
    try {
      res.json(createApiSuccessResponse(await controlService(String(req.params.unit), action)));
    } catch (error) {
      throw new AppError(error instanceof Error ? error.message : String(error), {
        code: 'VPS_ACTION_FAILED',
        statusCode: 400,
      });
    }
  }),
);

router.get(
  '/logs/:unit',
  asyncHandler(async (req, res) => {
    const levelParam = firstQueryValue(req.query.level);
    const level = levelParam === 'error' || levelParam === 'warn' ? levelParam : 'info';
    try {
      const logs = await getLogs(String(req.params.unit), {
        lines: Number(firstQueryValue(req.query.lines) ?? 200),
        level,
        // Служебные строки systemd по умолчанию не нужны: у падающего бота они
        // составляют почти весь журнал и прячут настоящую ошибку.
        system: firstQueryValue(req.query.system) === '1',
      });
      res.json(createApiSuccessResponse(logs));
    } catch (error) {
      throw new AppError(error instanceof Error ? error.message : String(error), {
        code: 'VPS_LOGS_FAILED',
        statusCode: 400,
      });
    }
  }),
);

router.get(
  '/diagnose/:unit',
  asyncHandler(async (req, res) => {
    try {
      res.json(createApiSuccessResponse(await diagnose(String(req.params.unit))));
    } catch (error) {
      throw new AppError(error instanceof Error ? error.message : String(error), {
        code: 'VPS_DIAGNOSE_FAILED',
        statusCode: 400,
      });
    }
  }),
);

router.get(
  '/errors',
  asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(await getRecentErrors(Number(firstQueryValue(req.query.hours) ?? 24))));
  }),
);

router.get(
  '/inventory',
  asyncHandler(async (_req, res) => {
    res.json(createApiSuccessResponse(await getInventory()));
  }),
);

router.get(
  '/windows',
  asyncHandler(async (_req, res) => {
    res.json(createApiSuccessResponse(await getWindows()));
  }),
);

/** Все прочие машины (Windows и т.п.) — из своих отчётов и legacy-Пульса. */
router.get(
  '/hosts',
  asyncHandler(async (_req, res) => {
    res.json(createApiSuccessResponse({ hosts: await listRemoteHosts() }));
  }),
);

// ------------------------------------------------------------------ алерты

router.get(
  '/alerts',
  asyncHandler(async (_req, res) => {
    const settings = getAlertSettings();
    const { problems } = await runCheck({ announce: false });
    res.json(
      createApiSuccessResponse({
        settings,
        chatId: resolveChatId(settings),
        ingestToken: getIngestToken(),
        problems,
      }),
    );
  }),
);

router.put(
  '/alerts',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const settings = saveAlertSettings({
      enabled: body.enabled == null ? undefined : Boolean(body.enabled),
      chatId: body.chatId === undefined ? undefined : body.chatId ? String(body.chatId) : null,
      diskPct: body.diskPct == null ? undefined : Number(body.diskPct),
      ramPct: body.ramPct == null ? undefined : Number(body.ramPct),
      restarts: body.restarts == null ? undefined : Number(body.restarts),
      muted: Array.isArray(body.muted) ? body.muted.map(String) : undefined,
    });
    res.json(createApiSuccessResponse({ settings, chatId: resolveChatId(settings) }));
  }),
);

router.post(
  '/alerts/test',
  asyncHandler(async (_req, res) => {
    try {
      res.json(createApiSuccessResponse(await sendTestMessage()));
    } catch (error) {
      throw new AppError(error instanceof Error ? error.message : String(error), {
        code: 'VPS_ALERT_TEST_FAILED',
        statusCode: 400,
      });
    }
  }),
);

export default router;

// Приём отчётов от других машин. Отдельный роутер: репортёр на Windows —
// не пользователь, JWT у него нет, он предъявляет общий токен.
export const vpsIngestRouter = express.Router();

vpsIngestRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const header = req.get('X-Token') ?? req.get('x-token');
    if (!ingestTokenMatches(header)) {
      throw new AppError('Неверный токен отчёта', { code: 'VPS_INGEST_FORBIDDEN', statusCode: 403 });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      res.json(createApiSuccessResponse(await saveReport(body)));
    } catch (error) {
      throw new AppError(error instanceof Error ? error.message : String(error), {
        code: 'VPS_INGEST_INVALID',
        statusCode: 400,
      });
    }
  }),
);
