import webPush from 'web-push';

import { notificationPreferencesDb, pushSubscriptionsDb, sessionAttentionDb, sessionsDb } from '@/modules/database/index.js';
import { isServiceTurn } from '@/shared/service-turns.js';
import { isModOn } from '@/shared/mods.js';
import { ATTENTION_PUSH_CODE, attentionPushTag } from '@/modules/notifications/services/attention-push.constants.js';
import { sendDesktopNotification as sendDesktopNotificationToClients } from '@/modules/notifications/services/desktop-notification-clients.service.js';

const KIND_TO_PREF_KEY = {
  action_required: 'actionRequired',
  stop: 'stop',
  error: 'error'
};

const PROVIDER_LABELS = {
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex',
  grok: 'Grok',
  system: 'System',
  consigliere: 'Консильери'
};

const recentEventKeys = new Map();
const DEDUPE_WINDOW_MS = 20000;

const cleanupOldEventKeys = () => {
  const now = Date.now();
  for (const [key, timestamp] of recentEventKeys.entries()) {
    if (now - timestamp > DEDUPE_WINDOW_MS) {
      recentEventKeys.delete(key);
    }
  }
};

function isNotificationEventEnabled(preferences, event) {
  const prefEventKey = KIND_TO_PREF_KEY[event.kind];
  const eventEnabled = prefEventKey ? Boolean(preferences?.events?.[prefEventKey]) : true;

  return eventEnabled;
}

function isDuplicate(event) {
  cleanupOldEventKeys();
  const key = event.dedupeKey || `${event.provider}:${event.kind || 'info'}:${event.code || 'generic'}:${event.sessionId || 'none'}`;
  if (recentEventKeys.has(key)) {
    return true;
  }
  recentEventKeys.set(key, Date.now());
  return false;
}

/**
 * @param {{
 *   provider: string,
 *   sessionId?: string|null,
 *   kind?: string,
 *   code?: string,
 *   meta?: Record<string, unknown>,
 *   severity?: string,
 *   dedupeKey?: string|null,
 *   requiresUserAction?: boolean
 * }} params
 */
function createNotificationEvent({
  provider,
  sessionId = null,
  kind = 'info',
  code = 'generic.info',
  meta = {},
  severity = 'info',
  dedupeKey = null,
  requiresUserAction = false
}) {
  return {
    provider,
    sessionId,
    kind,
    code,
    meta,
    severity,
    requiresUserAction,
    dedupeKey,
    createdAt: new Date().toISOString()
  };
}

function normalizeErrorMessage(error) {
  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error.message === 'string') {
    return error.message;
  }

  if (error == null) {
    return 'Unknown error';
  }

  return String(error);
}

function normalizeSessionName(sessionName) {
  if (typeof sessionName !== 'string') {
    return null;
  }

  const normalized = sessionName.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }

  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function rowMatchesProvider(row, provider) {
  return row && (!provider || row.provider === provider);
}

function resolveSessionRow(sessionId, provider) {
  if (!sessionId) {
    return null;
  }

  const appSessionRow = sessionsDb.getSessionById(sessionId);
  if (rowMatchesProvider(appSessionRow, provider)) {
    return appSessionRow;
  }

  const providerSessionRow = sessionsDb.getSessionByProviderSessionId(sessionId);
  if (rowMatchesProvider(providerSessionRow, provider)) {
    return providerSessionRow;
  }

  return null;
}

function normalizeNotificationSession(event) {
  if (!event?.sessionId || !event.provider || event.provider === 'system') {
    return event;
  }

  const row = resolveSessionRow(event.sessionId, event.provider);
  if (!row || row.session_id === event.sessionId) {
    return event;
  }

  return {
    ...event,
    sessionId: row.session_id
  };
}

function resolveSessionName(event) {
  const explicitSessionName = normalizeSessionName(event.meta?.sessionName);
  if (explicitSessionName) {
    return explicitSessionName;
  }

  if (!event.sessionId || !event.provider) {
    return null;
  }

  return normalizeSessionName(sessionsDb.getSessionName(event.sessionId, event.provider));
}

const ATTENTION_BODY_MAX = 300;

function clipBody(text) {
  const normalized = String(text || '').replace(/[ \t]+/g, ' ').trim();
  return normalized.length > ATTENTION_BODY_MAX ? `${normalized.slice(0, ATTENTION_BODY_MAX - 1)}…` : normalized;
}

/**
 * "Нужен ответ" push (attention-push). Stays up until the session stops
 * waiting (closed by the `attention:<session>` tag). `data.answers` maps an
 * action id to its one-time token; the service worker POSTs the token to
 * /api/attention/answer when that button is pressed.
 */
function buildAttentionWaitingPayload(event) {
  const meta = event.meta || {};
  const providerLabel = PROVIDER_LABELS[event.provider] || 'Агент';
  const sessionName = resolveSessionName(event);
  const question = typeof meta.question === 'string' ? meta.question : '';
  const excerpt = typeof meta.excerpt === 'string' ? meta.excerpt : '';
  const options = Array.isArray(meta.options) ? meta.options.filter((option) => typeof option === 'string') : [];
  const questionCount = Number(meta.questionCount) || 0;

  let body;
  switch (meta.reason) {
    case 'ask': {
      body = `${providerLabel} спрашивает: ${question || 'нужен твой выбор'}`;
      if (questionCount > 1) {
        body += ` (вопросов: ${questionCount})`;
      } else if (options.length > 2) {
        body += `\nВарианты: ${options.join(' · ')}`;
      }
      break;
    }
    case 'plan':
      body = `${providerLabel} просит одобрить план${question ? `: ${question}` : ''}`;
      break;
    case 'permission':
      body = `${providerLabel} просит разрешение: ${question || 'инструмент'}`;
      break;
    case 'manual_ask':
      body = `${providerLabel} ждёт твоего действия: ${excerpt || question}`;
      break;
    default:
      body = `${providerLabel} ждёт ответа${question || excerpt ? `: ${question || excerpt}` : ''}`;
  }

  const actions = Array.isArray(meta.actions)
    ? meta.actions
      .filter((action) => action && typeof action.action === 'string' && typeof action.title === 'string')
      .map((action) => ({ action: action.action, title: action.title }))
    : [];
  const answers = meta.answers && typeof meta.answers === 'object' ? { ...meta.answers } : {};

  return {
    title: sessionName || 'Neo3',
    body: clipBody(body),
    requireInteraction: true,
    actions,
    data: {
      sessionId: event.sessionId || null,
      code: ATTENTION_PUSH_CODE,
      provider: event.provider || null,
      sessionName,
      reason: meta.reason || null,
      tag: attentionPushTag(event.sessionId || 'none'),
      answers
    }
  };
}

function buildNotificationPayload(event) {
  const normalizedEvent = normalizeNotificationSession(event);

  if (normalizedEvent.code === 'notification.close') {
    return {
      close: true,
      data: {
        tag: String(normalizedEvent.meta?.tag || ''),
        code: 'notification.close'
      }
    };
  }

  if (normalizedEvent.code === 'consigliere.task') {
    const row = Number(normalizedEvent.meta?.row);
    const kind = normalizedEvent.meta?.kind === 'overdue' ? 'overdue' : 'due';
    const title = String(normalizedEvent.meta?.title || 'Задача');
    const when = String(normalizedEvent.meta?.when || '');
    const tag = String(normalizedEvent.meta?.tag || `consigliere:event:${row}`);
    const prefix = kind === 'overdue' ? 'Просрочено' : 'Сделать';
    return {
      title: 'Канцелярия',
      body: when ? `${prefix}: «${title}» — ${when}` : `${prefix}: «${title}»`,
      silent: Boolean(normalizedEvent.meta?.silent),
      actions: [{ action: 'done', title: 'Сделал' }],
      data: {
        code: 'consigliere.task',
        tag,
        row,
        sig: String(normalizedEvent.meta?.sig || ''),
        panel: 'consigliere',
        urlPath: '/?panel=consigliere',
        provider: 'system'
      }
    };
  }

  if (normalizedEvent.code === ATTENTION_PUSH_CODE) {
    return buildAttentionWaitingPayload(normalizedEvent);
  }

  if (normalizedEvent.code === 'bot.dead') {
    const unit = String(normalizedEvent.meta?.unit || 'bot');
    const name = String(normalizedEvent.meta?.name || unit);
    const tag = String(normalizedEvent.meta?.tag || `bot:${unit}`);
    return {
      title: 'Бот упал',
      body: `«${name}» умер и сам не встал`,
      data: {
        code: 'bot.dead',
        tag,
        unit,
        panel: 'server',
        urlPath: '/?panel=server',
        provider: 'system'
      }
    };
  }

  // Auto-relay (server/modules/auto-relay): the chat moved itself, or could not.
  if (normalizedEvent.code === 'auto_relay.done' || normalizedEvent.code === 'auto_relay.failed') {
    const done = normalizedEvent.code === 'auto_relay.done';
    const childTitle = String(normalizedEvent.meta?.childTitle || 'Продолжение чата');
    return {
      title: done ? 'Авто-перенос' : 'Авто-перенос не получился',
      body: done
        ? `Перенёс в новый чат: ${childTitle}`
        : clipBody(String(normalizedEvent.meta?.error || 'Записку не нашёл — авто-перенос выключен')),
      data: {
        sessionId: normalizedEvent.sessionId || null,
        code: normalizedEvent.code,
        provider: normalizedEvent.provider || null,
        tag: `auto-relay:${normalizedEvent.sessionId || 'none'}`,
      },
    };
  }

  const CODE_MAP = {
    'permission.required': normalizedEvent.meta?.toolName
      ? `Action Required: Tool "${normalizedEvent.meta.toolName}" needs approval`
      : 'Action Required: A tool needs your approval',
    'run.stopped': normalizedEvent.meta?.stopReason || 'Run Stopped: The run has stopped',
    'run.failed': normalizedEvent.meta?.error ? `Run Failed: ${normalizedEvent.meta.error}` : 'Run Failed: The run encountered an error',
    'agent.notification': normalizedEvent.meta?.message ? String(normalizedEvent.meta.message) : 'You have a new notification',
    'push.enabled': 'Push notifications are now enabled!'
  };
  const providerLabel = PROVIDER_LABELS[normalizedEvent.provider] || 'Assistant';
  const sessionName = resolveSessionName(normalizedEvent);
  const message = CODE_MAP[normalizedEvent.code] || 'You have a new notification';

  return {
    title: sessionName || 'Claude CLI',
    body: `${providerLabel}: ${message}`,
    data: {
      sessionId: normalizedEvent.sessionId || null,
      code: normalizedEvent.code,
      provider: normalizedEvent.provider || null,
      sessionName,
      tag: `${normalizedEvent.provider || 'assistant'}:${normalizedEvent.sessionId || 'none'}:${normalizedEvent.code}`
    }
  };
}

function sendWebPushPayload(userId, payload) {
  const subscriptions = pushSubscriptionsDb.getSubscriptions(userId);
  if (!subscriptions.length) return Promise.resolve();

  const serializedPayload = JSON.stringify(payload);
  return Promise.allSettled(
    subscriptions.map((sub) =>
      webPush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.keys_p256dh,
            auth: sub.keys_auth
          }
        },
        serializedPayload
      )
    )
  ).then((results) => {
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const statusCode = result.reason?.statusCode;
        if (statusCode === 410 || statusCode === 404) {
          pushSubscriptionsDb.removeSubscription(subscriptions[index].endpoint);
        }
      }
    });
  });
}

const notificationChannels = [
  {
    id: 'webPush',
    // TODO: Web push still uses push_subscriptions. Do not remove that table until
    // browser push subscriptions are migrated into notification_channel_endpoints.
    isEnabled: (preferences) => Boolean(preferences?.channels?.webPush),
    send: ({ userId, payload }) => sendWebPushPayload(userId, payload)
  },
  {
    id: 'desktop',
    isEnabled: (preferences) => Boolean(preferences?.channels?.desktop),
    send: ({ userId, payload }) => sendDesktopNotificationToClients(userId, payload)
  }
];

function notifyUserIfEnabled({ userId, event }) {
  if (!userId || !event) {
    return;
  }

  const normalizedEvent = normalizeNotificationSession(event);
  const preferences = notificationPreferencesDb.getPreferences(userId);
  if (!isNotificationEventEnabled(preferences, normalizedEvent)) {
    return;
  }
  if (isDuplicate(normalizedEvent)) {
    return;
  }

  const payload = buildNotificationPayload(normalizedEvent);
  for (const channel of notificationChannels) {
    if (!channel.isEnabled(preferences)) {
      continue;
    }
    Promise.resolve(channel.send({ userId, event: normalizedEvent, payload })).catch((err) => {
      console.error(`Notification channel "${channel.id}" send error:`, err);
    });
  }
}

/**
 * Engines send their terminal `complete` before this push, so session-attention
 * has already classified the turn: when it ended waiting for the user, the
 * "нужен ответ" push is the one notification for it (one push per question).
 */
function isSessionWaitingForUser(provider, sessionId) {
  try {
    const row = resolveSessionRow(sessionId, provider);
    return sessionAttentionDb.get(row?.session_id || sessionId)?.state === 'waiting';
  } catch {
    return false;
  }
}

/**
 * The auto-relay's own handoff turn is not news: its result is the
 * «Перенёс в новый чат» push (or the failure push) that follows it. Only that
 * run is covered — a person's turn in the same chat pushes as usual.
 */
function isAutoRelayTurn(provider, sessionId) {
  try {
    const row = resolveSessionRow(sessionId, provider);
    return isServiceTurn(row?.session_id || sessionId);
  } catch {
    return false;
  }
}

/**
 * @param {{
 *   userId: number|string|null,
 *   provider: string,
 *   sessionId?: string|null,
 *   stopReason?: string,
 *   sessionName?: string|null
 * }} params
 */
function notifyRunStopped({ userId, provider, sessionId = null, stopReason = 'completed', sessionName = null }) {
  // The «нужен ответ» push replaces this one only while «Ждут тебя» is on;
  // switched off, this plain push is the only news of the turn (Решение §5).
  if (stopReason === 'completed' && sessionId && isModOn(userId, 'modAttention') && isSessionWaitingForUser(provider, sessionId)) {
    return;
  }
  if (sessionId && isAutoRelayTurn(provider, sessionId)) {
    return;
  }
  notifyUserIfEnabled({
    userId,
    event: createNotificationEvent({
      provider,
      sessionId,
      kind: 'stop',
      code: 'run.stopped',
      meta: { stopReason, sessionName },
      severity: 'info',
      dedupeKey: `${provider}:run:stop:${sessionId || 'none'}:${stopReason}`
    })
  });
}

function notifyRunFailed({ userId, provider, sessionId = null, error, sessionName = null }) {
  const errorMessage = normalizeErrorMessage(error);

  notifyUserIfEnabled({
    userId,
    event: createNotificationEvent({
      provider,
      sessionId,
      kind: 'error',
      code: 'run.failed',
      meta: { error: errorMessage, sessionName },
      severity: 'error',
      dedupeKey: `${provider}:run:error:${sessionId || 'none'}:${errorMessage}`
    })
  });
}

export {
  buildNotificationPayload,
  createNotificationEvent,
  notifyUserIfEnabled,
  notifyRunStopped,
  notifyRunFailed,
  sendWebPushPayload
};
