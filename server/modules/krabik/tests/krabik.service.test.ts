import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createKrabikService,
  describeTool,
  parseAgentGet,
  parseReportList,
  parseReportStatus,
  parseTranscript,
  PROMPT_MAX_CHARS,
} from '@/modules/krabik/krabik.service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TRANSCRIPT = readFileSync(path.join(here, 'fixtures', 'krabik-session.jsonl'), 'utf8');

const AGENT_GET = JSON.stringify({
  id: 'cli:agent:get',
  result: {
    agent: {
      agent: 'claude',
      agent_status: 'working',
      completion_seq: 7,
      name: 'krabik',
      terminal_title_stripped: '✳ Проверка ботов',
    },
    type: 'agent_info',
  },
});

type Call = { file: string; args: string[] };

function fakeExec(reply: (call: Call) => string | Error) {
  const calls: Call[] = [];
  const exec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    const out = reply({ file, args });
    if (out instanceof Error) throw out;
    return out;
  };
  return { calls, exec };
}

describe('krabik: состояние', () => {
  it('берёт статус, заголовок без значка и счётчик завершений', () => {
    assert.deepEqual(parseAgentGet(AGENT_GET), {
      reachable: true,
      status: 'working',
      title: 'Проверка ботов',
      completionSeq: 7,
    });
  });

  it('битый ответ или ошибка herdr — «нет связи», а не исключение', async () => {
    assert.equal(parseAgentGet('not json').reachable, false);
    const { exec } = fakeExec(() => new Error('ssh: connect timed out'));
    const state = await createKrabikService({ exec, herdrBin: 'herdr' }).getState();
    assert.equal(state.reachable, false);
    assert.equal(state.status, 'unknown');
  });
});

describe('krabik: переписка', () => {
  const messages = parseTranscript(TRANSCRIPT);

  it('показывает вопрос, ответ и свёрнутые шаги, без служебного', () => {
    assert.deepEqual(
      messages.map((m) => m.role),
      ['user', 'tool', 'assistant'],
    );
    assert.equal(messages[0].text, 'Проверь всех ботов');
    assert.equal(messages[1].text, 'выполняет: Список упавших служб\nчитает bot.log');
    assert.match(messages[2].text, /^Все боты живы/);
  });

  it('не показывает ответы инструментов, мета-строки, помощников и system-reminder', () => {
    const all = messages.map((m) => m.text).join('\n');
    assert.doesNotMatch(all, /tool_result|SECRET_OUTPUT|напоминание|помощник внутри/);
  });

  it('пропускает обрезанную первую строку хвоста', () => {
    const cut = `{"type":"user","message":{"content":"обрез` + '\n' + TRANSCRIPT;
    assert.equal(parseTranscript(cut).length, messages.length);
  });

  it('описывает шаги по-русски', () => {
    assert.equal(describeTool('Edit', { file_path: '/opt/bot/config.py' }), 'правит config.py');
    assert.equal(describeTool('Bash', { command: 'systemctl --failed' }), 'выполняет: systemctl --failed');
    assert.equal(describeTool('mcp__x__y', {}), 'инструмент mcp__x__y');
  });
});

describe('krabik: отчёты', () => {
  it('разбирает первую строку СТАТУС', () => {
    assert.deepEqual(parseReportStatus('СТАТУС: ОК'), { status: 'ok', summary: '' });
    assert.deepEqual(parseReportStatus('**СТАТУС: ПРОБЛЕМА — tyres-bot падает**'), {
      status: 'problem',
      summary: 'tyres-bot падает',
    });
    assert.equal(parseReportStatus('# Отчёт').status, 'none');
  });

  it('список: свежие сверху, мусорные имена отброшены', () => {
    const list = parseReportList(
      'old.md\t100\tСТАТУС: ОК\t# Проверка здоровья VPS NL — 22.10.2026\n../etc.md\t300\tx\t\nduty-2026-10-23.md\t200\tСТАТУС: ПРОБЛЕМА — диск 95%\t# Дежурство — 2026-10-23\n',
    );
    assert.deepEqual(list.map((r) => r.name), ['duty-2026-10-23.md', 'old.md']);
    assert.equal(list[0].status, 'problem');
    assert.equal(list[0].title, 'Дежурство');
    assert.equal(list[1].title, 'Проверка здоровья VPS NL');
  });

  it('readReport не пускает в ssh ничего кроме имени файла', async () => {
    const { calls, exec } = fakeExec(() => '# отчёт');
    const service = createKrabikService({ exec, sshBin: 'ssh', sshHost: 'vps' });
    for (const bad of ['../x.md', 'a b.md', 'x.md;rm -rf ~', '.hidden.md', 'x.txt']) {
      await assert.rejects(service.readReport(bad), { code: 'BAD_REPORT_NAME' });
    }
    assert.equal(calls.length, 0);
    assert.equal(await service.readReport('duty-2026-10-23.md'), '# отчёт');
    assert.equal(calls[0].args.at(-1), 'cat ~/krabik/reports/duty-2026-10-23.md');
  });
});

describe('krabik: команды', () => {
  it('текст задачи уходит отдельным аргументом herdr, без shell', async () => {
    const { calls, exec } = fakeExec(() => '{}');
    const service = createKrabikService({ exec, herdrBin: '/opt/homebrew/bin/herdr', machine: 'vps-nl' });
    await service.sendPrompt('  проверь $(whoami); `id` "кавычки"  ');
    assert.deepEqual(calls[0], {
      file: '/opt/homebrew/bin/herdr',
      args: ['--machine', 'vps-nl', 'agent', 'prompt', 'krabik', 'проверь $(whoami); `id` "кавычки"'],
    });
  });

  it('пустая и слишком длинная задача — отказ до вызова', async () => {
    const { calls, exec } = fakeExec(() => '{}');
    const service = createKrabikService({ exec });
    await assert.rejects(service.sendPrompt('   '), { code: 'EMPTY_PROMPT' });
    await assert.rejects(service.sendPrompt('x'.repeat(PROMPT_MAX_CHARS + 1)), { code: 'PROMPT_TOO_LONG' });
    assert.equal(calls.length, 0);
  });

  it('«Стоп» — клавиша Esc агенту', async () => {
    const { calls, exec } = fakeExec(() => '{}');
    await createKrabikService({ exec, machine: 'vps-nl' }).stop();
    assert.deepEqual(calls[0].args, ['--machine', 'vps-nl', 'agent', 'send-keys', 'krabik', 'esc']);
  });

  it('«Разбудить» понимает ok/started и ругается на остальное', async () => {
    let reply = 'started\n';
    const { exec } = fakeExec(() => reply);
    const service = createKrabikService({ exec });
    assert.equal(await service.wake(), 'started');
    reply = 'error не удалось\n';
    await assert.rejects(service.wake(), { code: 'KRABIK_START_FAILED' });
  });
});
