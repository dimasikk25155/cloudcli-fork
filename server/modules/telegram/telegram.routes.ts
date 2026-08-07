import express from 'express';

import { checkProjectAccess } from '@/modules/agent-run/agent-run.service.js';
import { telegramDb, type TelegramBindingRow } from '@/modules/database/repositories/telegram.db.js';
import {
  clearBotToken,
  getTokenSource,
  getWebhookSecret,
  isBotConfigured,
  saveBotToken,
  telegramApi,
} from '@/modules/telegram/telegram-api.client.js';
import { issueLinkCode, listAccessibleProjects, resetChatSession } from '@/modules/telegram/telegram.service.js';

// Management API for the Telegram settings panel. Every handler is scoped to
// the authenticated user: bindings belong to whoever created them, and no route
// accepts a user id from the client.

const WEBHOOK_PATH = '/api/telegram-webhook';

const router = express.Router();

function readUserId(req: express.Request): number {
  const userId = Number((req as any).user?.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error('Authenticated user is missing');
  }
  return userId;
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeBinding(binding: TelegramBindingRow) {
  return {
    id: binding.id,
    chatId: binding.chat_id,
    telegramUsername: binding.telegram_username,
    projectPath: binding.project_path,
    enabled: Boolean(binding.enabled),
    createdAt: binding.created_at,
    updatedAt: binding.updated_at,
  };
}

/** The bot token is server-wide, so only an admin may replace or remove it. */
function isAdmin(req: express.Request): boolean {
  return (req as any).user?.role === 'admin';
}

/** Bot identity, when the token works. Never fails the request — it is a status field, not the answer. */
async function readBotInfo(): Promise<{ username: string | null; reachable: boolean; error: string | null }> {
  if (!isBotConfigured()) {
    return { username: null, reachable: false, error: null };
  }

  try {
    const info = await telegramApi.getMe();
    return { username: info?.username ?? null, reachable: true, error: null };
  } catch (error) {
    return {
      username: null,
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Current webhook as Telegram sees it — the only honest source for "is it wired up". */
async function readWebhookInfo(): Promise<{ url: string | null; pending: number; error: string | null }> {
  if (!isBotConfigured()) {
    return { url: null, pending: 0, error: null };
  }

  try {
    const info = await telegramApi.getWebhookInfo();
    return {
      url: info?.url || null,
      pending: Number(info?.pending_update_count) || 0,
      error: info?.last_error_message || null,
    };
  } catch {
    // A failing getMe already reports the outage; no need to repeat it here.
    return { url: null, pending: 0, error: null };
  }
}

router.get('/status', async (req, res) => {
  try {
    const userId = readUserId(req);
    const [bot, webhook] = await Promise.all([readBotInfo(), readWebhookInfo()]);

    return res.json({
      success: true,
      configured: isBotConfigured(),
      webhookSecretConfigured: getWebhookSecret().length > 0,
      botUsername: bot.username,
      botReachable: bot.reachable,
      botError: bot.error,
      tokenSource: getTokenSource(),
      canManageBot: isAdmin(req),
      webhookUrl: webhook.url,
      webhookPending: webhook.pending,
      webhookError: webhook.error,
      bindings: telegramDb.getBindingsByUserId(userId).map(sanitizeBinding),
    });
  } catch (error) {
    console.error('Error reading Telegram status:', error);
    return res.status(500).json({ error: 'Failed to read Telegram status' });
  }
});

/**
 * Stores a bot token typed into the settings panel. The token is checked against
 * Telegram *before* it is written, so a typo can never leave the install with a
 * dead bot configured.
 */
router.post('/bot', async (req, res) => {
  try {
    readUserId(req);
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Только администратор может менять бота' });
    }

    const token = readText(req.body?.token);
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
      return res.status(400).json({ error: 'Токен не похож на токен BotFather (формат 123456:AA...)' });
    }

    let info;
    try {
      info = await telegramApi.getMe(token);
    } catch (verifyError) {
      const message = verifyError instanceof Error ? verifyError.message : String(verifyError);
      return res.status(400).json({
        error: message.includes('Unauthorized')
          ? 'Telegram отклонил токен. Проверьте, что скопировали его целиком.'
          : `Не удалось проверить токен: ${message}`,
      });
    }

    saveBotToken(token);
    return res.json({ success: true, botUsername: info?.username ?? null });
  } catch (error) {
    console.error('Error saving Telegram bot token:', error);
    return res.status(500).json({ error: 'Failed to save bot token' });
  }
});

/** Removes the stored token and unhooks Telegram, so no updates keep arriving. */
router.delete('/bot', async (req, res) => {
  try {
    readUserId(req);
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Только администратор может менять бота' });
    }

    if (getTokenSource() !== 'db') {
      return res.status(400).json({ error: 'Токен задан в окружении сервера — уберите его из .env' });
    }

    await telegramApi.deleteWebhook().catch(() => {
      // Best effort: a dead token cannot unhook, and clearing it is still right.
    });
    clearBotToken();
    return res.json({ success: true });
  } catch (error) {
    console.error('Error clearing Telegram bot token:', error);
    return res.status(500).json({ error: 'Failed to clear bot token' });
  }
});

router.get('/projects', (req, res) => {
  try {
    const userId = readUserId(req);
    return res.json({ success: true, projects: listAccessibleProjects(userId) });
  } catch (error) {
    console.error('Error listing Telegram projects:', error);
    return res.status(500).json({ error: 'Failed to list projects' });
  }
});

router.get('/bindings', (req, res) => {
  try {
    const userId = readUserId(req);
    return res.json({ success: true, bindings: telegramDb.getBindingsByUserId(userId).map(sanitizeBinding) });
  } catch (error) {
    console.error('Error listing Telegram bindings:', error);
    return res.status(500).json({ error: 'Failed to list Telegram bindings' });
  }
});

router.post('/link-code', async (req, res) => {
  try {
    if (!isBotConfigured()) {
      return res.status(503).json({ error: 'Telegram bot is not configured' });
    }

    const userId = readUserId(req);
    const { code, expiresInSeconds } = issueLinkCode(userId);
    const bot = await readBotInfo();

    return res.json({
      success: true,
      code,
      expiresInSeconds,
      botUsername: bot.username,
      command: `/start ${code}`,
    });
  } catch (error) {
    console.error('Error issuing Telegram link code:', error);
    return res.status(500).json({ error: 'Failed to issue link code' });
  }
});

router.delete('/bindings/:chatId', (req, res) => {
  try {
    const userId = readUserId(req);
    const chatId = readText(req.params.chatId);
    if (!chatId) {
      return res.status(400).json({ error: 'chatId is required' });
    }

    const removed = telegramDb.deleteBinding(userId, chatId);
    if (!removed) {
      return res.status(404).json({ error: 'Binding not found' });
    }

    resetChatSession(chatId);
    return res.json({ success: true });
  } catch (error) {
    console.error('Error removing Telegram binding:', error);
    return res.status(500).json({ error: 'Failed to remove Telegram binding' });
  }
});

router.put('/bindings/:chatId/project', (req, res) => {
  try {
    const userId = readUserId(req);
    const chatId = readText(req.params.chatId);
    const projectPath = readText(req.body?.projectPath);
    if (!chatId || !projectPath) {
      return res.status(400).json({ error: 'chatId and projectPath are required' });
    }

    const access = checkProjectAccess(userId, projectPath);
    if (!access.ok) {
      return res.status(403).json({ error: access.error });
    }

    const updated = telegramDb.setBindingProjectPath(userId, chatId, access.projectPath);
    if (!updated) {
      return res.status(404).json({ error: 'Binding not found' });
    }

    resetChatSession(chatId);
    return res.json({ success: true, projectPath: access.projectPath });
  } catch (error) {
    console.error('Error updating Telegram binding project:', error);
    return res.status(500).json({ error: 'Failed to update project' });
  }
});

router.post('/webhook', async (req, res) => {
  try {
    if (!isBotConfigured()) {
      return res.status(503).json({ error: 'Telegram bot is not configured' });
    }

    const secret = getWebhookSecret();
    if (!secret) {
      return res.status(503).json({ error: 'TELEGRAM_WEBHOOK_SECRET is not configured' });
    }

    const publicUrl = readText(req.body?.publicUrl).replace(/\/+$/, '');
    if (!/^https:\/\/[^\s]+$/i.test(publicUrl)) {
      return res.status(400).json({ error: 'publicUrl must be an https:// address' });
    }

    const webhookUrl = `${publicUrl}${WEBHOOK_PATH}`;
    await telegramApi.setWebhook(webhookUrl, secret);
    return res.json({ success: true, webhookUrl });
  } catch (error) {
    console.error('Error setting Telegram webhook:', error);
    return res.status(502).json({ error: error instanceof Error ? error.message : 'Failed to set webhook' });
  }
});

export default router;
