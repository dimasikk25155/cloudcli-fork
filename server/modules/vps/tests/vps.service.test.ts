import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  UNIT_RE,
  classifyHealth,
  explainFailure,
  groupErrors,
  getBotsHealth,
  interpretHeartbeat,
  isControllable,
  parseJournalLine,
  parseLogFilePath,
  parseShowBlocks,
} from '@/modules/vps/vps.service.js';

// Панель сервера умеет останавливать сервисы, поэтому проверяем в первую
// очередь не красоту вывода, а то, что она не может выстрелить себе в ногу.

describe('панель сервера: что разрешено трогать', () => {
  it('не даёт остановить сервисы, которые держат сам доступ к панели', () => {
    for (const unit of [
      'neo3.service',
      'ssh.service',
      'sshd.service',
      'tailscaled.service',
      'docker.service',
      'containerd.service',
      'cloudflared.service',
      'cloudflared-agents.service',
      'systemd-journald.service',
      'user@1002.service',
      'getty@tty1.service',
    ]) {
      assert.equal(isControllable(unit, `/etc/systemd/system/${unit}`), false, `${unit} должен быть защищён`);
    }
  });

  it('не даёт трогать пакетные юниты дистрибутива', () => {
    assert.equal(isControllable('cron.service', '/lib/systemd/system/cron.service'), false);
    assert.equal(isControllable('postgresql@14-main.service', '/lib/systemd/system/postgresql@.service'), false);
  });

  it('разрешает управлять своими ботами', () => {
    for (const unit of ['content-bots.service', 'tyres-bot.service', 'jobs-moderation-bot.service']) {
      assert.equal(isControllable(unit, `/etc/systemd/system/${unit}`), true, `${unit} должен быть управляемым`);
    }
  });

  it('отсекает имена, которыми можно подсунуть лишнюю команду', () => {
    for (const bad of [
      'content-bots.service; rm -rf /',
      'content-bots.service && reboot',
      '../../etc/passwd.service',
      'content bots.service',
      'content-bots',
      '',
    ]) {
      assert.equal(UNIT_RE.test(bad), false, `«${bad}» не должно проходить проверку имени`);
    }
    assert.equal(UNIT_RE.test('content-bots.service'), true);
    assert.equal(UNIT_RE.test('postgresql@14-main.service'), true);
  });
});

describe('панель сервера: состояние сервиса', () => {
  it('различает живой, упавший, отработавший и выключенный', () => {
    assert.equal(classifyHealth({ ActiveState: 'active', SubState: 'running' }, 0), 'up');
    assert.equal(classifyHealth({ ActiveState: 'failed', SubState: 'failed' }, 0), 'failed');
    assert.equal(classifyHealth({ ActiveState: 'active', SubState: 'exited' }, 0), 'idle');
    assert.equal(classifyHealth({ ActiveState: 'inactive', SubState: 'dead' }, 0), 'down');
  });

  it('ловит бота, который падает и перезапускается по кругу', () => {
    assert.equal(classifyHealth({ ActiveState: 'active', SubState: 'running' }, 7), 'flapping');
  });

  // Боевой случай: tyres-bot с 9410 перезапусками половину времени висит в
  // activating/auto-restart. Если смотреть только на ActiveState, авария
  // выглядит как «сервис просто выключен» — и алерт не приходит никогда.
  it('не принимает сервис в фазе авто-перезапуска за выключенный', () => {
    assert.equal(classifyHealth({ ActiveState: 'activating', SubState: 'auto-restart' }, 9410), 'flapping');
    assert.equal(classifyHealth({ ActiveState: 'activating', SubState: 'auto-restart' }, 0), 'flapping');
  });

  it('не путает обычный запуск с аварией', () => {
    assert.equal(classifyHealth({ ActiveState: 'activating', SubState: 'start' }, 0), 'up');
  });
});

describe('панель сервера: чтение логов', () => {
  it('отделяет служебные сообщения systemd от вывода процесса', () => {
    const systemd = parseJournalLine(
      '2026-08-11T20:30:47+0300 urban-face systemd[1]: tyres-bot.service: Scheduled restart job, restart counter is at 13484.',
    );
    assert.equal(systemd.level, 'system');
    assert.equal(systemd.text, 'tyres-bot.service: Scheduled restart job, restart counter is at 13484.');

    const process = parseJournalLine(
      '2026-08-11T20:30:47+0300 urban-face python[467415]: aiogram.exceptions.TelegramUnauthorizedError: Unauthorized',
    );
    assert.equal(process.level, 'error');
    assert.equal(process.ts, '2026-08-11T20:30:47+0300');
  });

  it('не теряет строку, которую не смог разобрать', () => {
    const line = parseJournalLine('какая-то строка без формата');
    assert.equal(line.text, 'какая-то строка без формата');
  });

  // Половина ботов пишет не в журнал, а в файл: без этого вкладка «Логи»
  // показывала им «записей нет», хотя лог лежит рядом и полон трассировок.
  it('находит собственный лог-файл сервиса в юните', () => {
    const unit = [
      '[Service]',
      'ExecStart=/opt/tyres-bot/.venv/bin/python /opt/tyres-bot/bot.py',
      'StandardOutput=append:/opt/tyres-bot/logs/bot.log',
      'StandardError=append:/opt/tyres-bot/logs/bot.log',
    ].join('\n');
    assert.equal(parseLogFilePath(unit), '/opt/tyres-bot/logs/bot.log');
    assert.equal(parseLogFilePath('[Service]\nStandardOutput=journal'), null);
  });
});

describe('панель сервера: почему упал', () => {
  // Боевой случай 11.08: после переезда на VPS сессия Telethon осталась и на
  // маке, Telegram отозвал ключ, два бота ушли в бесконечный рестарт.
  it('узнаёт отозванную сессию Telegram', () => {
    const explained = explainFailure(
      "telethon.errors.rpcerrorlist.AuthKeyDuplicatedError: The authorization key (session file) was used under two different IP addresses simultaneously",
    );
    assert.match(explained?.reason ?? '', /отозвал сессию/i);
    assert.match(explained?.advice ?? '', /session/i);
  });

  it('узнаёт мёртвый токен бота', () => {
    const explained = explainFailure('aiogram.exceptions.TelegramUnauthorizedError: Telegram server says - Unauthorized');
    assert.match(explained?.reason ?? '', /не принимает токен/i);
  });

  it('подставляет имя недостающей библиотеки в подсказку', () => {
    const explained = explainFailure("ModuleNotFoundError: No module named 'telethon'");
    assert.match(explained?.reason ?? '', /telethon/);
    assert.match(explained?.advice ?? '', /pip install telethon/);
  });

  it('объясняет коды systemd, когда сам процесс ничего не написал', () => {
    assert.match(explainFailure('', { exitCode: 203 })?.reason ?? '', /неверный путь/i);
    assert.match(explainFailure('', { result: 'oom-kill' })?.reason ?? '', /память/i);
  });

  it('молчит, когда причина неизвестна, вместо того чтобы выдумать', () => {
    assert.equal(explainFailure('обычная строка лога', { exitCode: 1 }), null);
  });
});

describe('панель сервера: свежие ошибки', () => {
  it('схлопывает повторы одной ошибки в одну строку со счётчиком', () => {
    const groups = groupErrors([
      { ts: '2026-08-11T10:00:00', source: 'python', text: 'Ошибка соединения, попытка 1' },
      { ts: '2026-08-11T10:01:00', source: 'python', text: 'Ошибка соединения, попытка 2' },
      { ts: '2026-08-11T10:02:00', source: 'python', text: 'Ошибка соединения, попытка 3' },
      { ts: '2026-08-11T10:03:00', source: 'node', text: 'Другая беда' },
    ]);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].count, 3);
    assert.equal(groups[0].text, 'Ошибка соединения, попытка 3', 'показывать надо последний вариант строки');
    assert.equal(groups[1].count, 1);
  });

  it('не сливает вместе ошибки разных сервисов', () => {
    const groups = groupErrors([
      { ts: '1', source: 'bot-a', text: 'упал' },
      { ts: '2', source: 'bot-b', text: 'упал' },
    ]);
    assert.equal(groups.length, 2);
  });
});

describe('панель сервера: разбор вывода systemd', () => {
  it('читает несколько юнитов из одного ответа', () => {
    const blocks = parseShowBlocks(
      [
        'Id=a.service\nDescription=Первый\nActiveState=active',
        'Id=b.service\nDescription=Второй\nActiveState=failed',
      ].join('\n\n'),
    );
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].Description, 'Первый');
    assert.equal(blocks[1].ActiveState, 'failed');
  });

  it('не теряет значения со знаком равенства внутри', () => {
    const [block] = parseShowBlocks('Id=x.service\nDescription=bot --flag=1 --other=2');
    assert.equal(block.Description, 'bot --flag=1 --other=2');
  });

  it('пропускает пустые блоки вместо того, чтобы падать', () => {
    assert.deepEqual(parseShowBlocks('\n\n'), []);
  });
});

describe('панель сервера: пульс WhatsApp-ботов', () => {
  const now = 1_789_100_000_000;

  it('считает свежий connected=true живым', () => {
    const row = interpretHeartbeat(
      'tyres-wa-kz',
      'Tyres KZ',
      JSON.stringify({ connected: true, ts: now - 15_000 }),
      now,
    );
    assert.equal(row.ok, true);
    assert.equal(row.detail, 'на связи');
  });

  it('ловит протухший пульс, даже если connected ещё true', () => {
    const row = interpretHeartbeat(
      'tyres-wa-7su',
      '7su',
      JSON.stringify({ connected: true, ts: now - 120_000 }),
      now,
    );
    assert.equal(row.ok, false);
    assert.equal(row.detail, 'завис или не стучится');
  });

  it('отличает отвал WhatsApp от пропавшего файла', () => {
    const disconnected = interpretHeartbeat(
      'tyres-wa-kz',
      'Tyres KZ',
      JSON.stringify({ connected: false, ts: now }),
      now,
    );
    assert.equal(disconnected.detail, 'WhatsApp отвалился');

    const missing = interpretHeartbeat('tyres-wa-7su', '7su', null, now);
    assert.equal(missing.ok, false);
    assert.equal(missing.detail, 'нет пульса');
  });

  it('показывает все четыре WhatsApp-линии, даже когда у какой-то нет пульса', () => {
    const ids = getBotsHealth().bots.map((bot) => bot.id);
    assert.deepEqual(ids, ['tyres-wa-kz', 'tyres-wa-7su', 'tyres-wa-7su-kira', 'tyres-wa-store']);
  });
});
