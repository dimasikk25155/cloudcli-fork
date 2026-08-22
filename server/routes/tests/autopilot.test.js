import assert from 'node:assert/strict';
import test from 'node:test';

import jwt from 'jsonwebtoken';

import { readDashboardToken, signDashboardToken, serveAutopilotAsset } from '../autopilot.js';
import { JWT_SECRET } from '../../middleware/auth.js';

/** Ответ, у которого можно спросить, чем всё кончилось. */
function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    type() {
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };
}

test('ссылка ведёт ровно в ту папку прогона, на которую её выдали', () => {
  const token = signDashboardToken('/home/agents/project/.autopilot');
  assert.equal(readDashboardToken(token)?.dir, '/home/agents/project/.autopilot');
});

test('через двенадцать часов ссылка перестаёт работать', () => {
  const token = signDashboardToken('/home/agents/project/.autopilot', { ttlSeconds: -1 });
  assert.equal(readDashboardToken(token), null);
});

test('токен сессии не работает как ссылка на дашборд', () => {
  // Тот самый токен из браузера: без scope он не должен открывать чужие папки.
  const sessionToken = jwt.sign({ userId: 1, dir: '/home/agents' }, JWT_SECRET, { expiresIn: '1h' });
  assert.equal(readDashboardToken(sessionToken), null);
});

test('подделанная и чужая подпись отбиваются', () => {
  const token = signDashboardToken('/home/agents/project/.autopilot');
  assert.equal(readDashboardToken(`${token.slice(0, -2)}xx`), null);

  const foreign = jwt.sign({ scope: 'autopilot-dashboard', dir: '/etc' }, 'not-our-secret');
  assert.equal(readDashboardToken(foreign), null);
});

test('по ссылке отдаются только два файла дашборда', async () => {
  // Рядом с ними в `.autopilot/` лежат бриф, спецификация и таски — если имя
  // файла брать из URL, ссылка на дашборд станет ссылкой на всю папку.
  const token = signDashboardToken('/home/agents/project/.autopilot');

  for (const file of ['spec.md', 'manifest.md', '../.secrets.env', 'README.md']) {
    const res = fakeRes();
    await serveAutopilotAsset({ params: { token, file } }, res);
    assert.equal(res.statusCode, 404, `${file} не должен отдаваться`);
  }
});

test('без действительного токена дашборд не отдаётся', async () => {
  const res = fakeRes();
  await serveAutopilotAsset({ params: { token: 'nonsense', file: 'dashboard.html' } }, res);
  assert.equal(res.statusCode, 401);
});
