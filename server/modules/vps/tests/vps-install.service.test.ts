import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pickZone } from '@/modules/vps/vps-dns.service.js';
import {
  EXIT_SENTINEL,
  buildRunnerScript,
  buildStreamCommand,
  humanizeSshError,
  normalizeInstallRequest,
  parseExitSentinel,
  phaseLabel,
  scrubSecrets,
  shellQuote,
} from '@/modules/vps/vps-install.service.js';

// Мастер установки получает root-пароль от чужого сервера и ставит систему с
// нуля. Поэтому проверяем не красоту, а три вещи: кривой ввод не доедет до ssh,
// пароль не попадёт в лог, и обрыв связи не убьёт установку на сервере.

const VALID = {
  host: '203.0.113.10',
  password: 'hunter2-very-secret',
  domain: 'client.neo3.ru',
};

describe('мастер установки: разбор формы', () => {
  it('заполняет умолчания — порт 22, пользователь root, терминал выключен', () => {
    const params = normalizeInstallRequest({ ...VALID });
    assert.equal(params.port, 22);
    assert.equal(params.user, 'root');
    assert.equal(params.enableTerminal, false);
    assert.equal(params.domain, 'client.neo3.ru');
  });

  it('чистит домен, вставленный как ссылка', () => {
    assert.equal(normalizeInstallRequest({ ...VALID, domain: 'https://Client.Neo3.RU/setup' }).domain, 'client.neo3.ru');
  });

  it('не пускает пустой и битый адрес сервера', () => {
    assert.throws(() => normalizeInstallRequest({ ...VALID, host: '' }), /адрес сервера/i);
    assert.throws(() => normalizeInstallRequest({ ...VALID, host: 'не адрес!' }), /не похож на адрес/i);
  });

  it('требует хоть какой-то способ входа', () => {
    assert.throws(() => normalizeInstallRequest({ host: VALID.host, domain: VALID.domain }), /пароль root или приватный/i);
  });

  it('ловит вставленный не туда публичный ключ', () => {
    assert.throws(
      () => normalizeInstallRequest({ ...VALID, password: '', privateKey: 'ssh-ed25519 AAAAC3Nz... dima@mac' }),
      /не похоже на приватный ключ/i,
    );
  });

  it('объясняет, почему нужен именно root, а не молча падает на сервере', () => {
    assert.throws(() => normalizeInstallRequest({ ...VALID, user: 'ubuntu' }), /только от root/i);
  });

  it('не принимает домен без зоны и с портом', () => {
    for (const domain of ['localhost', 'neo3', 'client.neo3.ru:3001', '']) {
      assert.throws(() => normalizeInstallRequest({ ...VALID, domain }), /не похож на домен/i);
    }
  });

  it('проверяет порт', () => {
    assert.throws(() => normalizeInstallRequest({ ...VALID, port: 0 }), /от 1 до 65535/);
    assert.throws(() => normalizeInstallRequest({ ...VALID, port: 'двадцать два' }), /от 1 до 65535/);
    assert.equal(normalizeInstallRequest({ ...VALID, port: 2222 }).port, 2222);
  });
});

describe('мастер установки: секреты', () => {
  it('вырезает пароль и ключ из строк лога', () => {
    const line = `sshpass: failed with ${VALID.password} at line 3`;
    assert.equal(scrubSecrets(line, [VALID.password, undefined]), 'sshpass: failed with *** at line 3');
  });

  it('не трогает текст, если секрет короткий или пустой — иначе замажет пол-лога', () => {
    assert.equal(scrubSecrets('build ok', ['ok', '', undefined]), 'build ok');
  });
});

describe('мастер установки: команда для сервера', () => {
  it('зовёт install.sh ровно так, как тот разбирает аргументы', () => {
    const script = buildRunnerScript('client.neo3.ru', false);
    assert.match(script, /bash \/root\/neo3-install\.sh 'client\.neo3\.ru' --clone > \/root\/neo3-install\.log 2>&1/);
    assert.ok(!script.includes('--enable-terminal'));
  });

  it('ставит --enable-terminal третьим аргументом — install.sh ждёт его именно там', () => {
    assert.match(buildRunnerScript('client.neo3.ru', true), /'client\.neo3\.ru' --clone --enable-terminal/);
  });

  it('дописывает метку с кодом возврата — иначе отцепленную установку не проводить', () => {
    assert.match(buildRunnerScript('client.neo3.ru', false), new RegExp(`echo "${EXIT_SENTINEL}\\$\\?"`));
  });

  it('отцепляет установку от ssh: уснувший телефон не должен ломать сервер клиента', () => {
    const command = buildStreamCommand();
    assert.match(command, /setsid bash \/root\/neo3-run\.sh <\/dev\/null/);
    assert.match(command, /tail -n \+1 -f \/root\/neo3-install\.log/);
  });

  it('экранирует кавычки в аргументе', () => {
    assert.equal(shellQuote("a'b"), `'a'\\''b'`);
  });

  it('читает код возврата из метки', () => {
    assert.equal(parseExitSentinel(`${EXIT_SENTINEL}0`), 0);
    assert.equal(parseExitSentinel(`${EXIT_SENTINEL}137`), 137);
    assert.equal(parseExitSentinel('==> npm install'), null);
  });
});

describe('мастер установки: понятные сообщения', () => {
  it('переводит шаги install.sh на человеческий', () => {
    assert.equal(phaseLabel('==> npm install'), 'Установка зависимостей — самый долгий шаг, 3–6 минут');
    assert.equal(phaseLabel('==> Caddy reverse proxy for client.neo3.ru'), 'Домен и HTTPS-сертификат');
    assert.equal(phaseLabel('added 812 packages'), null);
  });

  it('вместо стектрейса ssh2 говорит, что именно проверить', () => {
    const at = { host: '203.0.113.10', port: 22 };
    assert.match(humanizeSshError(new Error('All configured authentication methods failed'), at), /не принял пароль/);
    assert.match(humanizeSshError(new Error('connect ECONNREFUSED 203.0.113.10:22'), at), /SSH там не слушает/);
    assert.match(humanizeSshError(new Error('connect ETIMEDOUT'), at), /не отвечает/);
    assert.match(humanizeSshError(new Error('Cannot parse privateKey: bad'), at), /приватный ключ/);
  });

  it('про обрыв связи говорит главное: установка продолжается сама', () => {
    assert.match(humanizeSshError(new Error('Connection lost'), { host: 'h', port: 22 }), /продолжается/);
  });
});

describe('авто-DNS: выбор зоны', () => {
  it('берёт самую точную зону, а не первую подходящую', () => {
    assert.equal(pickZone('a.client.neo3.ru', ['neo3.ru', 'client.neo3.ru']), 'client.neo3.ru');
    assert.equal(pickZone('client.neo3.ru', ['neo3.ru', 'tarariev.ru']), 'neo3.ru');
  });

  it('не считает своим чужой домен с похожим хвостом', () => {
    assert.equal(pickZone('evil-neo3.ru', ['neo3.ru']), null);
    assert.equal(pickZone('client.neo3.ru.attacker.com', ['neo3.ru']), null);
  });
});
