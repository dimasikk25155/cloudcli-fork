import express from 'express';

import { pipelinesService } from '@/modules/pipelines/pipelines.service.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

const router = express.Router();

type AuthenticatedUser = { id?: number | string };

function requireUserId(req: express.Request): number {
  const authenticatedUser = (req as typeof req & { user?: AuthenticatedUser }).user;
  const userId = Number(authenticatedUser?.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new AppError('Authentication required', { code: 'UNAUTHORIZED', statusCode: 401 });
  }
  return userId;
}

function requireNumericParam(value: unknown, name: string): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(`${name} must be a positive integer`, { code: 'PIPELINE_INVALID', statusCode: 400 });
  }
  return parsed;
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(Array.isArray(value) ? value[0] : (value ?? '')), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 200);
}

// Run routes are registered first so "/runs" is never swallowed by "/:pipelineId".

router.get(
  '/runs',
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const runs = pipelinesService.listRuns(userId, null, readLimit(req.query.limit, 50));
    res.json(createApiSuccessResponse({ runs }));
  }),
);

router.get(
  '/runs/:runId',
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const runId = requireNumericParam(req.params.runId, 'runId');
    res.json(createApiSuccessResponse(pipelinesService.getRun(userId, runId)));
  }),
);

router.post(
  '/runs/:runId/cancel',
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const runId = requireNumericParam(req.params.runId, 'runId');
    res.json(createApiSuccessResponse(pipelinesService.cancelRun(userId, runId)));
  }),
);

router.get(
  '/runs/:runId/steps/:stepIndex/output',
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const runId = requireNumericParam(req.params.runId, 'runId');
    const stepIndex = requireNumericParam(req.params.stepIndex, 'stepIndex');
    res.json(createApiSuccessResponse(await pipelinesService.readStepOutput(userId, runId, stepIndex)));
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    res.json(createApiSuccessResponse({ pipelines: pipelinesService.listPipelines(userId) }));
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const pipeline = pipelinesService.createPipeline(userId, req.body || {});
    res.status(201).json(createApiSuccessResponse({ pipeline }));
  }),
);

router.get(
  '/:pipelineId',
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const pipelineId = requireNumericParam(req.params.pipelineId, 'pipelineId');
    res.json(createApiSuccessResponse({ pipeline: pipelinesService.getPipeline(userId, pipelineId) }));
  }),
);

router.put(
  '/:pipelineId',
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const pipelineId = requireNumericParam(req.params.pipelineId, 'pipelineId');
    const pipeline = pipelinesService.updatePipeline(userId, pipelineId, req.body || {});
    res.json(createApiSuccessResponse({ pipeline }));
  }),
);

router.delete(
  '/:pipelineId',
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const pipelineId = requireNumericParam(req.params.pipelineId, 'pipelineId');
    pipelinesService.deletePipeline(userId, pipelineId);
    res.json(createApiSuccessResponse({ deleted: true }));
  }),
);

router.get(
  '/:pipelineId/runs',
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const pipelineId = requireNumericParam(req.params.pipelineId, 'pipelineId');
    const runs = pipelinesService.listRuns(userId, pipelineId, readLimit(req.query.limit, 50));
    res.json(createApiSuccessResponse({ runs }));
  }),
);

router.post(
  '/:pipelineId/run',
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const pipelineId = requireNumericParam(req.params.pipelineId, 'pipelineId');
    const started = await pipelinesService.startRun(userId, pipelineId, { trigger: 'manual' });
    // 202: the run is only queued here, progress arrives through GET /runs/:runId.
    res.status(202).json(createApiSuccessResponse(started));
  }),
);

export default router;
