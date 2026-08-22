import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifyLaunchdHealth,
  isControllableLabel,
  LABEL_RE,
  lsofPorts,
  parseDf,
  parseLaunchctlList,
  parseNetstat,
  parseSwapUsage,
  parseVmStat,
} from '@/modules/vps/vps.darwin.js';

// macOS отдаёт те же величины, что Linux, но другими командами и в другом
// формате. Проверяем ровно те места, где легко получить правдоподобное, но
// неверное число: удвоенный трафик, «занятая» память на пустом маке, дубли
// системного тома, и агент, который вышел с нулём и на самом деле здоров.

describe('darwin: память', () => {
  const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                              123456.
Pages active:                            100000.
Pages inactive:                          200000.
Pages speculative:                        50000.
Pages wired down:                         50000.
Pages occupied by compressor:             10000.`;

  it('считает занятым active + wired + compressed, не трогая inactive', () => {
    // 160000 страниц по 16 КБ. Если ошибочно приплюсовать inactive и
    // speculative, выйдет 410000 страниц — «мак забит» на ровном месте.
    assert.equal(parseVmStat(VM_STAT, 16384), 160000 * 16384);
  });

  it('разбирает vm.swapusage', () => {
    const swap = parseSwapUsage('vm.swapusage: total = 2048.00M  used = 512.00M  free = 1536.00M');
    assert.equal(swap.totalBytes, 2048 * 1024 * 1024);
    assert.equal(swap.usedBytes, 512 * 1024 * 1024);
    assert.equal(swap.pct, 25);
  });

  it('на пустой выдаче не делит на ноль', () => {
    assert.deepEqual(parseSwapUsage(''), { totalBytes: 0, usedBytes: 0, pct: 0 });
  });
});

describe('darwin: диски', () => {
  it('переводит килобайты в байты и схлопывает дубль системного тома', () => {
    const df = `Filesystem 1024-blocks      Used Available Capacity  Mounted on
/dev/disk3s1s1   483000000 200000000 283000000    42%    /
/dev/disk3s5     483000000 200000000 283000000    42%    /
/dev/disk3s6     483000000     10000 283000000     1%    /System/Volumes/VM
/dev/disk3s2     483000000 425000000  58000000    88%    /System/Volumes/Data
map auto_home            0         0         0   100%    /System/Volumes/Data/home`;
    const disks = parseDf(df);
    assert.equal(disks.length, 2, 'корень и Data; корень не задвоен, служебные тома скрыты');
    assert.equal(disks[0].mount, '/');
    assert.equal(disks[0].totalBytes, 483000000 * 1024);
    assert.equal(disks[0].pct, 42);
    assert.ok(!disks.some((disk) => disk.mount.includes('home')), 'map auto_home — не диск');
    assert.ok(!disks.some((disk) => disk.mount.endsWith('/VM')), 'служебные тома Apple прячем');
    assert.equal(disks[1].mount, '/System/Volumes/Data', 'а вот Data — главный том, его показываем');
  });
});

describe('darwin: сеть', () => {
  it('не удваивает байты, когда интерфейс повторён на каждый адрес', () => {
    const netstat = `Name  Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
en0   1500  <Link#1>    aa:bb:cc:dd:ee:ff   1000     0    1000000     900     0     500000     0
en0   1500  192.168.0/24  192.168.0.10       1000     0    1000000     900     0     500000     0
lo0   16384 <Link#2>                          50     0      10000      50     0      10000     0
utun3 1280  <Link#3>                         100     0      20000     100     0      20000     0`;
    assert.deepEqual(parseNetstat(netstat), { rx: 1000000, tx: 500000 });
  });
});

describe('darwin: сервисы launchd', () => {
  it('разбирает три колонки launchctl list', () => {
    const list = `PID\tStatus\tLabel
5419\t0\tcom.dimasik.neo3-local
-\t1\tcom.dimasik.upala
-\t0\tcom.dimasik.razovyy`;
    const parsed = parseLaunchctlList(list);
    assert.equal(parsed.length, 3);
    assert.deepEqual(parsed[0], { pid: 5419, lastExit: 0, label: 'com.dimasik.neo3-local' });
    assert.equal(parsed[1].pid, null);
    assert.equal(parsed[1].lastExit, 1);
  });

  it('живой PID — работает', () => {
    assert.equal(classifyLaunchdHealth(5419, 0, true), 'up');
  });

  it('ненулевой выход у KeepAlive-агента — падает по кругу', () => {
    assert.equal(classifyLaunchdHealth(null, 1, true), 'flapping');
  });

  it('разовый скрипт, вышедший с нулём, — не авария, а idle', () => {
    // Главная ловушка launchd: у одноразовой задачи «нет PID» это норма.
    // Пометить её как failed значит завалить панель ложными тревогами.
    assert.equal(classifyLaunchdHealth(null, 0, false), 'idle');
  });

  it('ненулевой выход без KeepAlive — упал', () => {
    assert.equal(classifyLaunchdHealth(null, 127, false), 'failed');
  });
});

describe('darwin: предохранители', () => {
  it('сам Neo3 и агенты Apple неуправляемы', () => {
    assert.equal(isControllableLabel('com.dimasik.neo3-local', true), false);
    assert.equal(isControllableLabel('com.apple.cloudd', false), false);
  });

  it('чужой агент вне ~/Library/LaunchAgents тоже неуправляем', () => {
    assert.equal(isControllableLabel('homebrew.mxcl.postgresql', false), false);
  });

  it('свой агент — управляем', () => {
    assert.equal(isControllableLabel('com.dimasik.watchdog', true), true);
  });

  it('метка не пускает слэш — иначе можно уехать в чужой домен launchctl', () => {
    assert.equal(LABEL_RE.test('com.dimasik.watchdog'), true);
    assert.equal(LABEL_RE.test('gui/501/com.apple.finder'), false);
    assert.equal(LABEL_RE.test('../etc/passwd'), false);
    assert.equal(LABEL_RE.test(''), false);
  });
});

describe('darwin: порты', () => {
  it('схлопывает повторы одного порта у форков процесса', () => {
    const lsof = `COMMAND   PID    USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node     5419 dimasik   22u  IPv4 0x1234              0t0  TCP *:3005 (LISTEN)
node     5419 dimasik   23u  IPv4 0x1234              0t0  TCP *:3005 (LISTEN)
ollama   6001 dimasik    3u  IPv4 0x5678              0t0  TCP 127.0.0.1:11434 (LISTEN)`;
    const ports = lsofPorts(lsof);
    assert.equal(ports.length, 2);
    assert.deepEqual(ports[0], { addr: '*:3005', proc: 'node' });
  });
});
