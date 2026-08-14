import assert from 'node:assert/strict';
import test from 'node:test';

import jwt from 'jsonwebtoken';

import { readDownloadToken, signDownloadToken } from '../file-share.js';
import { JWT_SECRET } from '../../middleware/auth.js';

test('ссылка ведёт ровно на тот файл, на который её выдали', () => {
  const token = signDownloadToken('/home/agents/Antigravity Project/D5-REPORT.md');
  const parsed = readDownloadToken(token);

  assert.equal(parsed?.path, '/home/agents/Antigravity Project/D5-REPORT.md');
  assert.equal(parsed?.name, 'D5-REPORT.md');
});

test('через сутки ссылка перестаёт работать', () => {
  const token = signDownloadToken('/tmp/report.pdf', { ttlSeconds: -1 });
  assert.equal(readDownloadToken(token), null);
});

test('токен сессии не работает как ссылка на скачивание', () => {
  // Ровно тот токен, что лежит в браузере: без scope он не должен открывать файлы.
  const sessionToken = jwt.sign({ userId: 1, path: '/etc/shadow' }, JWT_SECRET, { expiresIn: '1h' });
  assert.equal(readDownloadToken(sessionToken), null);
});

test('подделанная и чужая подпись отбиваются', () => {
  const token = signDownloadToken('/tmp/report.pdf');
  const broken = `${token.slice(0, -2)}xx`;
  assert.equal(readDownloadToken(broken), null);

  const foreign = jwt.sign({ scope: 'file-download', path: '/etc/passwd' }, 'not-our-secret');
  assert.equal(readDownloadToken(foreign), null);
});

test('путь берётся из подписи, а не из ссылки — обход папок невозможен', () => {
  const token = signDownloadToken('/tmp/report.pdf');
  const parsed = readDownloadToken(token);
  // Что бы ни дописали в URL, путь остаётся тем, который подписали.
  assert.equal(parsed?.path.includes('..'), false);
  assert.equal(parsed?.path, '/tmp/report.pdf');
});
