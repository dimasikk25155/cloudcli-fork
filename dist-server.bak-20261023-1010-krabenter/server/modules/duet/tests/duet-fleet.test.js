import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSnapshot, canRestart, checkServices, diffSnapshots, parseRegistry, restartService, serviceId, } from '../../../modules/duet/duet-fleet.js';
const REGISTRY = `
services:
  # комментарий - { machine: vps-nl, method: systemd, target: fake.service, crit: crit, label: "нет" }
  - { machine: vps-nl,  method: systemd, target: pulse-bot.service, crit: crit, label: "pulse-bot — бот" }
  - { machine: vps-nl,  method: docker,  target: n8n,               crit: crit, label: "n8n — оркестратор" }
  - { machine: windows, method: http,    target: "http://localhost:11435/api/tags", crit: opt, label: "Ollama" }
  - { machine: mac,     method: launchd, target: ru.neo3.tyres-wa-bot, crit: crit, label: "tyres WA" }
  - { machine: vps-nl,  method: systemd, target: "bad; rm -rf /", crit: opt, label: "злой" }
  - { machine: vps-nl,  method: cron,    target: x, crit: opt, label: "неизвестный метод" }
`;
test('parseRegistry: строки сервисов, комментарии и неизвестные методы пропускаются', () => {
    const services = parseRegistry(REGISTRY);
    assert.deepEqual(services.map((s) => s.target), [
        'pulse-bot.service', 'n8n', 'http://localhost:11435/api/tags', 'ru.neo3.tyres-wa-bot', 'bad; rm -rf /',
    ]);
    assert.equal(services[0].label, 'pulse-bot — бот');
    assert.equal(services[0].crit, true);
    assert.equal(services[2].crit, false);
    assert.equal(services[0].id, serviceId('vps-nl', 'systemd', 'pulse-bot.service'));
    assert.match(services[0].id, /^[0-9a-f]{10}$/);
});
function fakeExec(handler, calls = []) {
    return async (command, args) => {
        calls.push([command, ...args]);
        return handler(command, args);
    };
}
test('checkServices: VPS одной пачкой, опасное имя не уходит в ssh', async () => {
    const services = parseRegistry(REGISTRY);
    const calls = [];
    const exec = fakeExec((command, args) => {
        const remote = args[args.length - 1] ?? '';
        if (command === 'ssh' && remote.startsWith('systemctl is-active'))
            return { code: 3, stdout: 'inactive\n' };
        if (command === 'ssh')
            return { code: 0, stdout: 'n8n\tmissing\n' };
        if (command === 'curl')
            return { code: 0, stdout: '200' };
        if (command === 'launchctl')
            return { code: 0, stdout: '{ "PID" = 123; }' };
        return { code: 1, stdout: '' };
    }, calls);
    const statuses = await checkServices(services, exec);
    const by = (target) => statuses.get(services.find((s) => s.target === target).id);
    assert.equal(by('pulse-bot.service'), 'down');
    assert.equal(by('n8n'), 'missing');
    assert.equal(by('http://localhost:11435/api/tags'), 'up');
    assert.equal(by('ru.neo3.tyres-wa-bot'), 'up');
    assert.equal(by('bad; rm -rf /'), 'unknown');
    assert.ok(calls.every((call) => !call.join(' ').includes('rm -rf')));
});
test('checkServices: VPS не отвечает → unreachable, а не down', async () => {
    const services = parseRegistry(REGISTRY).filter((s) => s.machine === 'vps-nl' && s.method === 'systemd');
    const statuses = await checkServices(services, fakeExec(() => ({ code: 255, stdout: '' })));
    assert.equal(statuses.get(services[0].id), 'unreachable');
});
test('diffSnapshots: первый снимок молчит, падение и подъём ловятся, заглушённое — нет', () => {
    const services = parseRegistry(REGISTRY).slice(0, 2);
    const [pulse, n8n] = services;
    const t0 = new Date('2026-10-23T06:00:00Z');
    const first = buildSnapshot(services, new Map([[pulse.id, 'up'], [n8n.id, 'up']]), [], null, t0);
    assert.deepEqual(diffSnapshots(null, first, []), { fell: [], recovered: [] });
    const t1 = new Date('2026-10-23T06:15:00Z');
    const second = buildSnapshot(services, new Map([[pulse.id, 'down'], [n8n.id, 'down']]), [], first, t1);
    const diff = diffSnapshots(first, second, [n8n.id]);
    assert.deepEqual(diff.fell.map((e) => e.id), [pulse.id]);
    assert.equal(second.services[0].since, t1.toISOString());
    const t2 = new Date('2026-10-23T06:30:00Z');
    const third = buildSnapshot(services, new Map([[pulse.id, 'up'], [n8n.id, 'down']]), [], second, t2);
    assert.deepEqual(diffSnapshots(second, third, []).recovered.map((e) => e.id), [pulse.id]);
    assert.equal(third.services[1].since, t1.toISOString(), 'статус тот же — время начала сохраняется');
});
test('restartService: systemd/docker по ssh, launchd через kickstart, опасное — отказ без вызова', async () => {
    const services = parseRegistry(REGISTRY);
    const calls = [];
    const exec = fakeExec(() => ({ code: 0, stdout: '' }), calls);
    await restartService(services[0], exec);
    await restartService(services[1], exec);
    await restartService(services[3], exec);
    assert.equal(calls[0][calls[0].length - 1], 'systemctl restart pulse-bot.service 2>&1');
    assert.equal(calls[1][calls[1].length - 1], 'docker restart n8n 2>&1');
    assert.deepEqual(calls[2].slice(0, 3), ['launchctl', 'kickstart', '-k']);
    assert.equal(canRestart(services[2]), false, 'http не перезапускается');
    const bad = await restartService(services[4], exec);
    assert.equal(bad.code, 1);
    assert.equal(calls.length, 3);
});
//# sourceMappingURL=duet-fleet.test.js.map