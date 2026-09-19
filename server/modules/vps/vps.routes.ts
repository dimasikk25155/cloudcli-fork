import express from 'express';
import type { Request, Response } from 'express';

import {
  getSettings as getAlertSettings,
  resolveChatId,
  runCheck,
  saveSettings as saveAlertSettings,
  sendTestMessage,
} from '@/modules/vps/vps-alerts.service.js';
import { checkDomain } from '@/modules/vps/vps-dns.service.js';
import {
  getCurrentRun,
  normalizeInstallRequest,
  startInstall,
  subscribe,
  type InstallEvent,
  type InstallRun,
} from '@/modules/vps/vps-install.service.js';
import { getIngestToken, ingestTokenMatches, listRemoteHosts, saveReport } from '@/modules/vps/vps-reports.service.js';
import {
  controlService,
  diagnose,
  getInventory,
  getLogs,
  getBotsHealth,
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
  '/bots-health',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(createApiSuccessResponse(getBotsHealth()));
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

// ------------------------------------------------------- мастер установки

/**
 * Лог установки уезжает в браузер по SSE — тем же приёмом, что и ответы агента
 * (server/routes/agent.js). Сначала отдаём всё, что уже накопилось: вкладку
 * можно закрыть и вернуться, и человек увидит установку с самого начала.
 */
function streamRun(run: InstallRun, req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event: InstallEvent | { type: 'end' }) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  for (const event of run.events) send(event);

  if (run.status !== 'running') {
    send({ type: 'end' });
    res.end();
    return;
  }

  const unsubscribe = subscribe(run, (event) => {
    send(event);
    if (event.type === 'done' || event.type === 'error') {
      send({ type: 'end' });
      res.end();
    }
  });
  // Прокси и мобильные сети рвут «молчащие» соединения: npm install умеет
  // выдавать полминуты тишины, поэтому подтверждаем жизнь комментарием.
  const ping = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 20_000);

  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
}

router.post('/install', (req, res) => {
  const run = startInstall(normalizeInstallRequest((req.body ?? {}) as Record<string, unknown>));
  streamRun(run, req, res);
});

/** Переподключение к идущей установке: телефон уснул — лог не потерян. */
router.get('/install/stream', (req, res) => {
  const run = getCurrentRun();
  if (!run) {
    throw new AppError('Установка не запускалась', { code: 'VPS_INSTALL_NONE', statusCode: 404 });
  }
  streamRun(run, req, res);
});

router.get('/install/status', (_req, res) => {
  const run = getCurrentRun();
  res.json(
    createApiSuccessResponse({
      run: run
        ? {
            id: run.id,
            status: run.status,
            host: run.host,
            domain: run.domain,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
          }
        : null,
    }),
  );
});

/** Живая проверка домена на шаге мастера: наш ли он и куда смотрит сейчас. */
router.get(
  '/install/domain-check',
  asyncHandler(async (req, res) => {
    const domain = (firstQueryValue(req.query.domain) ?? '').trim().toLowerCase();
    if (!domain || !/^[a-z0-9.-]{4,253}$/.test(domain)) {
      throw new AppError('Домен не похож на домен', { code: 'VPS_INSTALL_BAD_DOMAIN', statusCode: 400 });
    }
    res.json(createApiSuccessResponse(await checkDomain(domain, firstQueryValue(req.query.ip))));
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
