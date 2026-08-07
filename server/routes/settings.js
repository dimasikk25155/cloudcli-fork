import fsSync, { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import express from 'express';

import {
  apiKeysDb,
  credentialsDb,
  notificationPreferencesDb,
  providerPreferencesDb,
  pushSubscriptionsDb,
  uiPreferencesDb,
} from '../modules/database/index.js';
import { getPublicKey } from '../services/vapid-keys.js';
import { createNotificationEvent, notifyUserIfEnabled } from '../services/notification-orchestrator.js';

const router = express.Router();

// ===============================
// API Keys Management
// ===============================

// Get all API keys for the authenticated user
router.get('/api-keys', async (req, res) => {
  try {
    const apiKeys = apiKeysDb.getApiKeys(req.user.id);
    // Don't send the full API key in the list for security
    const sanitizedKeys = apiKeys.map(key => ({
      ...key,
      api_key: key.api_key.substring(0, 10) + '...'
    }));
    res.json({ apiKeys: sanitizedKeys });
  } catch (error) {
    console.error('Error fetching API keys:', error);
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// Create a new API key
router.post('/api-keys', async (req, res) => {
  try {
    const { keyName } = req.body;

    if (!keyName || !keyName.trim()) {
      return res.status(400).json({ error: 'Key name is required' });
    }

    const result = apiKeysDb.createApiKey(req.user.id, keyName.trim());
    res.json({
      success: true,
      apiKey: result
    });
  } catch (error) {
    console.error('Error creating API key:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// Delete an API key
router.delete('/api-keys/:keyId', async (req, res) => {
  try {
    const { keyId } = req.params;
    const success = apiKeysDb.deleteApiKey(req.user.id, parseInt(keyId));

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'API key not found' });
    }
  } catch (error) {
    console.error('Error deleting API key:', error);
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

// Toggle API key active status
router.patch('/api-keys/:keyId/toggle', async (req, res) => {
  try {
    const { keyId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }

    const success = apiKeysDb.toggleApiKey(req.user.id, parseInt(keyId), isActive);

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'API key not found' });
    }
  } catch (error) {
    console.error('Error toggling API key:', error);
    res.status(500).json({ error: 'Failed to toggle API key' });
  }
});

// ===============================
// Generic Credentials Management
// ===============================

// Get all credentials for the authenticated user (optionally filtered by type)
router.get('/credentials', async (req, res) => {
  try {
    const { type } = req.query;
    const credentials = credentialsDb.getCredentials(req.user.id, type || null);
    // Don't send the actual credential values for security
    res.json({ credentials });
  } catch (error) {
    console.error('Error fetching credentials:', error);
    res.status(500).json({ error: 'Failed to fetch credentials' });
  }
});

// Create a new credential
router.post('/credentials', async (req, res) => {
  try {
    const { credentialName, credentialType, credentialValue, description } = req.body;

    if (!credentialName || !credentialName.trim()) {
      return res.status(400).json({ error: 'Credential name is required' });
    }

    if (!credentialType || !credentialType.trim()) {
      return res.status(400).json({ error: 'Credential type is required' });
    }

    if (!credentialValue || !credentialValue.trim()) {
      return res.status(400).json({ error: 'Credential value is required' });
    }

    const result = credentialsDb.createCredential(
      req.user.id,
      credentialName.trim(),
      credentialType.trim(),
      credentialValue.trim(),
      description?.trim() || null
    );

    res.json({
      success: true,
      credential: result
    });
  } catch (error) {
    console.error('Error creating credential:', error);
    res.status(500).json({ error: 'Failed to create credential' });
  }
});

// Delete a credential
router.delete('/credentials/:credentialId', async (req, res) => {
  try {
    const { credentialId } = req.params;
    const success = credentialsDb.deleteCredential(req.user.id, parseInt(credentialId));

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Credential not found' });
    }
  } catch (error) {
    console.error('Error deleting credential:', error);
    res.status(500).json({ error: 'Failed to delete credential' });
  }
});

// Toggle credential active status
router.patch('/credentials/:credentialId/toggle', async (req, res) => {
  try {
    const { credentialId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }

    const success = credentialsDb.toggleCredential(req.user.id, parseInt(credentialId), isActive);

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Credential not found' });
    }
  } catch (error) {
    console.error('Error toggling credential:', error);
    res.status(500).json({ error: 'Failed to toggle credential' });
  }
});

// ===============================
// Notification Preferences
// ===============================

router.get('/notification-preferences', async (req, res) => {
  try {
    const preferences = notificationPreferencesDb.getPreferences(req.user.id);
    res.json({ success: true, preferences });
  } catch (error) {
    console.error('Error fetching notification preferences:', error);
    res.status(500).json({ error: 'Failed to fetch notification preferences' });
  }
});

router.put('/notification-preferences', async (req, res) => {
  try {
    const preferences = notificationPreferencesDb.updatePreferences(req.user.id, req.body || {});
    res.json({ success: true, preferences });
  } catch (error) {
    console.error('Error saving notification preferences:', error);
    res.status(500).json({ error: 'Failed to save notification preferences' });
  }
});

// ===============================
// Push Subscription Management
// ===============================

router.get('/push/vapid-public-key', async (req, res) => {
  try {
    const publicKey = getPublicKey();
    res.json({ publicKey });
  } catch (error) {
    console.error('Error fetching VAPID public key:', error);
    res.status(500).json({ error: 'Failed to fetch VAPID public key' });
  }
});

router.post('/push/subscribe', async (req, res) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'Missing subscription fields' });
    }
    pushSubscriptionsDb.saveSubscription(req.user.id, endpoint, keys.p256dh, keys.auth);

    // Enable webPush in preferences so the confirmation goes through the full pipeline
    const currentPrefs = notificationPreferencesDb.getPreferences(req.user.id);
    if (!currentPrefs?.channels?.webPush) {
      notificationPreferencesDb.updatePreferences(req.user.id, {
        ...currentPrefs,
        channels: { ...currentPrefs?.channels, webPush: true },
      });
    }

    res.json({ success: true });

    // Send a confirmation push through the full notification pipeline
    const event = createNotificationEvent({
      provider: 'system',
      kind: 'info',
      code: 'push.enabled',
      meta: { message: 'Push notifications are now enabled!' },
      severity: 'info'
    });
    notifyUserIfEnabled({ userId: req.user.id, event });
  } catch (error) {
    console.error('Error saving push subscription:', error);
    res.status(500).json({ error: 'Failed to save push subscription' });
  }
});

router.post('/push/unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      return res.status(400).json({ error: 'Missing endpoint' });
    }
    pushSubscriptionsDb.removeSubscription(endpoint);

    // Disable webPush in preferences to match subscription state
    const currentPrefs = notificationPreferencesDb.getPreferences(req.user.id);
    if (currentPrefs?.channels?.webPush) {
      notificationPreferencesDb.updatePreferences(req.user.id, {
        ...currentPrefs,
        channels: { ...currentPrefs.channels, webPush: false },
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error removing push subscription:', error);
    res.status(500).json({ error: 'Failed to remove push subscription' });
  }
});

// ===============================
// Provider preferences (cross-device model/effort defaults)
// ===============================

// Default model/thinking-effort per provider for the authenticated user,
// so switching on one device (e.g. Mac) shows up on every other device
// (e.g. phone) instead of being stuck in that browser's localStorage.
router.get('/provider-preferences', async (req, res) => {
  try {
    const preferences = providerPreferencesDb.getProviderPreferences(req.user.id);
    res.json({ success: true, ...preferences });
  } catch (error) {
    console.error('Error fetching provider preferences:', error);
    res.status(500).json({ error: 'Failed to fetch provider preferences' });
  }
});

router.put('/provider-preferences/model', async (req, res) => {
  try {
    const { provider, model } = req.body;
    if (!provider || typeof provider !== 'string' || !model || typeof model !== 'string') {
      return res.status(400).json({ error: 'provider and model are required' });
    }
    const preferences = providerPreferencesDb.setProviderModel(req.user.id, provider, model);
    res.json({ success: true, ...preferences });
  } catch (error) {
    console.error('Error saving provider model preference:', error);
    res.status(500).json({ error: 'Failed to save provider model preference' });
  }
});

router.put('/provider-preferences/effort', async (req, res) => {
  try {
    const { provider, effort } = req.body;
    if (!provider || typeof provider !== 'string' || !effort || typeof effort !== 'string') {
      return res.status(400).json({ error: 'provider and effort are required' });
    }
    const preferences = providerPreferencesDb.setProviderEffort(req.user.id, provider, effort);
    res.json({ success: true, ...preferences });
  } catch (error) {
    console.error('Error saving provider effort preference:', error);
    res.status(500).json({ error: 'Failed to save provider effort preference' });
  }
});

// ===============================
// UI preferences (cross-device theme/appearance defaults)
// ===============================

// Appearance/behavior toggles (theme, shader background, composer/sidebar
// toggles) for the authenticated user, so a choice made on one device shows
// up on every other device instead of being stuck in that browser's
// localStorage.
router.get('/ui-preferences', async (req, res) => {
  try {
    const preferences = uiPreferencesDb.getUiPreferences(req.user.id);
    res.json({ success: true, preferences });
  } catch (error) {
    console.error('Error fetching UI preferences:', error);
    res.status(500).json({ error: 'Failed to fetch UI preferences' });
  }
});

router.put('/ui-preferences', async (req, res) => {
  try {
    const preferences = uiPreferencesDb.updateUiPreferences(req.user.id, req.body || {});
    res.json({ success: true, preferences });
  } catch (error) {
    console.error('Error saving UI preferences:', error);
    res.status(500).json({ error: 'Failed to save UI preferences' });
  }
});

// ===============================
// Свой фон темы (картинка с устройства пользователя)
// ===============================

/**
 * Один файл на пользователя в `~/.cloudcli/theme-bg/<userId>.webp`. Отдельная
 * папка, а не общая `assets`: та глобальная и растёт от вложений в чате, а фон
 * — ровно одна картинка на аккаунт, которую перезапись должна затирать.
 */
const THEME_BG_DIR = path.join(os.homedir(), '.cloudcli', 'theme-bg');
/** Принимаем до 15 МБ на входе — снимок с телефона легко весит 8-12 МБ. */
const THEME_BG_MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
/** Больше 2560px по ширине не нужно даже на 4K: фон всё равно под скримом. */
const THEME_BG_MAX_WIDTH = 2560;

/**
 * Путь к файлу фона пользователя. id приходит из авторизации, но в имя файла
 * он всё равно попадает только после проверки — иначе `../` в id увёл бы
 * запись за пределы папки.
 */
function themeBackgroundPath(userId) {
  const safeId = String(userId);
  return /^[A-Za-z0-9_-]+$/.test(safeId) ? path.join(THEME_BG_DIR, `${safeId}.webp`) : null;
}

let _themeBgUpload = null;
/** multer и sharp грузим лениво: без загрузки фона они не нужны вовсе. */
async function getThemeBackgroundUpload() {
  if (!_themeBgUpload) {
    const multer = (await import('multer')).default;
    _themeBgUpload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: THEME_BG_MAX_UPLOAD_BYTES, files: 1 },
    });
  }
  return _themeBgUpload;
}

router.post('/ui-preferences/background', async (req, res) => {
  const filePath = themeBackgroundPath(req.user.id);
  if (!filePath) {
    return res.status(400).json({ error: 'Invalid user id' });
  }

  try {
    const upload = await getThemeBackgroundUpload();
    upload.single('background')(req, res, async (err) => {
      if (err) {
        const tooBig = err.code === 'LIMIT_FILE_SIZE';
        return res.status(400).json({
          error: tooBig
            ? 'Файл больше 15 МБ — выберите картинку поменьше'
            : (err.message || 'Upload failed'),
        });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      try {
        const sharp = (await import('sharp')).default;
        // Пережимаем всегда: заливаем webp, чтобы 12-мегабайтный снимок с
        // телефона не тянулся с сервера при каждой загрузке страницы.
        const webp = await sharp(req.file.buffer)
          .rotate()
          .resize({ width: THEME_BG_MAX_WIDTH, withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
        await fs.mkdir(THEME_BG_DIR, { recursive: true });
        await fs.writeFile(filePath, webp);
        res.json({ success: true, bytes: webp.length });
      } catch (error) {
        console.error('Error storing theme background:', error);
        res.status(400).json({ error: 'Не удалось прочитать картинку — нужен PNG, JPEG или WebP' });
      }
    });
  } catch (error) {
    console.error('Error preparing theme background upload:', error);
    res.status(500).json({ error: 'Failed to store background' });
  }
});

router.get('/ui-preferences/background', async (req, res) => {
  const filePath = themeBackgroundPath(req.user.id);
  if (!filePath) {
    return res.status(400).json({ error: 'Invalid user id' });
  }

  try {
    await fs.access(filePath);
  } catch {
    return res.status(404).json({ error: 'No custom background' });
  }

  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Приватная картинка одного аккаунта — общим кэшам её видеть нечего.
  res.setHeader('Cache-Control', 'private, max-age=60');
  const stream = fsSync.createReadStream(filePath);
  stream.pipe(res);
  stream.on('error', (error) => {
    console.error('Error streaming theme background:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error reading background' });
    }
  });
});

router.delete('/ui-preferences/background', async (req, res) => {
  const filePath = themeBackgroundPath(req.user.id);
  if (!filePath) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  // Удаление того, чего нет, — это успех: кнопка «вернуть штатный фон» не
  // должна падать, если файл уже убрали с другого устройства.
  await fs.unlink(filePath).catch(() => undefined);
  res.json({ success: true });
});

export default router;
