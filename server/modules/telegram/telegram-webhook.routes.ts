import { timingSafeEqual } from 'node:crypto';

import express from 'express';

import { getWebhookSecret, isBotConfigured } from '@/modules/telegram/telegram-api.client.js';
import { handleTelegramUpdate } from '@/modules/telegram/telegram.service.js';

// Public endpoint: Telegram cannot carry the app session cookie, so the only
// proof of origin is the secret token header configured through setWebhook.

const router = express.Router();

function secretMatches(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

router.post('/', express.json({ limit: '1mb' }), (req, res) => {
  if (!isBotConfigured()) {
    return res.status(503).json({ error: 'Telegram bot is not configured' });
  }

  const expectedSecret = getWebhookSecret();
  if (!expectedSecret) {
    // Without a secret there is no way to tell Telegram from anyone else, so
    // the endpoint stays shut rather than trusting the caller.
    return res.status(503).json({ error: 'Telegram webhook secret is not configured' });
  }

  const providedSecret = req.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (!secretMatches(providedSecret, expectedSecret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Telegram re-delivers an update it gets no prompt 200 for, and an agent run
  // takes minutes — acknowledge first, work afterwards.
  res.status(200).json({ ok: true });

  void handleTelegramUpdate(req.body).catch((error: unknown) => {
    console.error('Telegram update failed:', error instanceof Error ? error.message : error);
  });
});

export default router;
