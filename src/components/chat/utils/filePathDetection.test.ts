import assert from 'node:assert/strict';
import test from 'node:test';

import { bracketSpacedLinkTargets, looksLikeDirectory, looksLikePath, shortenPathLabel, stripLineSuffix } from './filePathDetection.js';

test('пути с пробелами — самый частый случай — распознаются', () => {
  for (const value of [
    '/home/agents/Antigravity Project/claude agent/CLAUDE.md',
    '~/Antigravity Project/.secrets.env',
    '~/Antigravity Project/Dimasik-Obsidian/Dimasik/wiki/index.md',
    'claude agent/docs/handoff/2026-08-11-2214-brauzery.md',
    './Мои документы/отчёт.pdf',
    // Заметка вольта: пробелы, тире и скобки в имени — обычное дело.
    'Море/Возврат в море матросом — разведка (2026-07-30).md',
  ]) {
    assert.equal(looksLikePath(value), true, value);
  }
});

test('папки — тоже ссылка: до них надо как-то добираться', () => {
  assert.equal(looksLikePath('/opt/content-bots/'), true);
  assert.equal(looksLikePath('~/Antigravity Project/'), true);
  assert.equal(looksLikeDirectory('/opt/content-bots/'), true);
  assert.equal(looksLikeDirectory('/opt/content-bots'), true);
  assert.equal(looksLikeDirectory('/opt/bots/run.py'), false);
});

test('обычные ссылки на файлы работают как раньше', () => {
  assert.equal(looksLikePath('src/components/chat/view/Markdown.tsx'), true);
  assert.equal(looksLikePath('README.md'), true);
  assert.equal(looksLikePath('server/index.js:1495'), true);
});

test('команды путями не считаются', () => {
  for (const value of [
    'npm run build:client',
    'cd /opt/content-bots',
    'tail -f /var/log/syslog',
    'ssh -i ~/.ssh/id_brand_vps root@185.199.197.210',
    'rg -li "neo3" ~/Antigravity Project',
    'pkill -f "wisper/app.py"',
    'sudo systemctl restart neo3',
    'curl -s https://claude.neo3.ru/',
    'git commit -m "правка"',
  ]) {
    assert.equal(looksLikePath(value), false, value);
  }
});

test('проза и домены путями не считаются (ловушки с реальной истории чатов)', () => {
  for (const value of [
    // Кусок текста, начатый со слэша: формально «от корня», но это проза.
    '/кавычек и отдаёт кириллицу кракозябрами. Рабочий рецепт — файл + base64 +',
    '/start studio2026',
    'cdn.sky-flame.online',
    'kip.ns.cloudflare.com',
  ]) {
    assert.equal(looksLikePath(value), false, value);
  }
});

test('текст и числа путями не считаются', () => {
  for (const value of [
    '2.1.218',
    'км/ч',
    'и/или',
    '8 ГБ / 175 ГБ',
    'GET /api/projects/:id/file',
    'https://claude.neo3.ru/',
    'www.example.com',
    '#',
    '',
  ]) {
    assert.equal(looksLikePath(value), false, JSON.stringify(value));
  }
});

test('хвост со строкой отрезается', () => {
  assert.equal(stripLineSuffix('src/foo.ts:130'), 'src/foo.ts');
  assert.equal(stripLineSuffix('src/foo.ts:130:12'), 'src/foo.ts');
  assert.equal(stripLineSuffix('src/foo.ts'), 'src/foo.ts');
});

test('адрес ссылки с пробелами оборачивается в угловые скобки', () => {
  assert.equal(
    bracketSpacedLinkTargets('смотри [отчёт](/home/agents/Antigravity Project/D5-REPORT.md) внизу'),
    'смотри [отчёт](</home/agents/Antigravity Project/D5-REPORT.md>) внизу',
  );
});

test('ссылки без пробелов, картинки и адреса сайтов не трогаются', () => {
  const untouched = [
    '[файл](src/index.ts)',
    '![скрин](/tmp/shot 1.png)',
    '[сайт](https://claude.neo3.ru/ и ещё)',
    '[уже обёрнут](</home/a b/c.md>)',
  ];
  for (const value of untouched) {
    assert.equal(bracketSpacedLinkTargets(value), value, value);
  }
});

test('внутри кода ссылки не переписываются', () => {
  const source = 'текст\n```\n[x](/a b/c.md)\n```\nи `[y](/d e/f.md)` тоже';
  assert.equal(bracketSpacedLinkTargets(source), source);
});

test('короткая подпись: длинный путь ужимается до имени файла', () => {
  assert.equal(
    shortenPathLabel('/home/agents/Antigravity Project/Dimasik-Obsidian/Dimasik/wiki/concepts/x.md'),
    'x.md',
  );
  assert.equal(
    shortenPathLabel('/home/agents/Antigravity Project/claude agent/cloudcli-fork/src/app.tsx:120'),
    'app.tsx:120',
  );
  assert.equal(
    shortenPathLabel('/home/agents/Antigravity Project/claude agent/cloudcli-fork/src/'),
    'src/',
  );
});

test('короткая подпись: короткие пути и голые имена не трогаем', () => {
  assert.equal(shortenPathLabel('src/foo.ts'), 'src/foo.ts');
  assert.equal(shortenPathLabel('README.md'), 'README.md');
  assert.equal(
    shortenPathLabel('очень-длинное-имя-файла-без-единой-папки-внутри.md'),
    'очень-длинное-имя-файла-без-единой-папки-внутри.md',
  );
});
