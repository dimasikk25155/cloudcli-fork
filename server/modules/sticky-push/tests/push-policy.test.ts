import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { botUnitFromKey, isDeadBotKey } from '@/modules/sticky-push/sticky-push.service.js';
import { normalizePushPolicy } from '@/modules/sticky-push/push-policy.js';

describe('push-policy', () => {
  it('по умолчанию Консильери и боты включены, Мазда выключена', () => {
    const policy = normalizePushPolicy(null);
    assert.equal(policy.consigliere.enabled, true);
    assert.deepEqual(policy.consigliere.kinds, ['due', 'overdue']);
    assert.equal(policy.bots.enabled, true);
    assert.equal(policy.bots.grace_min, 5);
    assert.equal(policy.mazda.enabled, false);
  });

  it('глушилка бота и выключатель Консильери читаются из файла', () => {
    const policy = normalizePushPolicy({
      consigliere: { enabled: false },
      bots: { grace_min: 12, mute: ['tyres-bot.service'] },
      mazda: { enabled: true },
    });
    assert.equal(policy.consigliere.enabled, false);
    assert.equal(policy.bots.grace_min, 12);
    assert.deepEqual(policy.bots.mute, ['tyres-bot.service']);
    assert.equal(policy.mazda.enabled, true);
  });
});

describe('ключ мёртвого бота', () => {
  it('режет unit из ключа панели', () => {
    assert.equal(isDeadBotKey('svc:tyres-bot.service:failed'), true);
    assert.equal(isDeadBotKey('svc:job-hunter.service:flapping'), true);
    assert.equal(isDeadBotKey('disk:/:90'), false);
    assert.equal(botUnitFromKey('svc:tyres-bot.service:failed'), 'tyres-bot.service');
  });
});
