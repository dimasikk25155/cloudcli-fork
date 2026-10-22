import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createKrabikWatch, type KrabikNotice } from '@/modules/krabik/krabik-watch.service.js';
import type { KrabikMessage, KrabikReport, KrabikState } from '@/modules/krabik/krabik.service.js';

type World = {
  state: KrabikState;
  messages: KrabikMessage[];
  reports: KrabikReport[];
  on: boolean;
};

function setup(initial: Partial<World> = {}, memory: { seq: number; waiting: boolean } | null = null) {
  const world: World = {
    state: { reachable: true, status: 'idle', title: 'Проверка', completionSeq: 1 },
    messages: [],
    reports: [],
    on: true,
    ...initial,
  };
  let saved = memory;
  const sent: KrabikNotice[] = [];
  const watch = createKrabikWatch({
    service: {
      getState: async () => world.state,
      getMessages: async () => world.messages,
      listReports: async () => world.reports,
    },
    notify: async (notice) => {
      sent.push(notice);
    },
    isOn: () => world.on,
    load: async () => saved,
    save: async (next) => {
      saved = next;
    },
  });
  return { world, watch, sent, memory: () => saved };
}

const msg = (role: KrabikMessage['role'], text: string): KrabikMessage => ({ id: text, role, text, at: null });

describe('сторож Крабика', () => {
  it('первый проход только запоминает — старое «закончил» не повторяется', async () => {
    const { watch, sent, memory } = setup({ state: { reachable: true, status: 'idle', title: '', completionSeq: 5 } });
    assert.deepEqual(await watch.tick(), []);
    assert.equal(sent.length, 0);
    assert.deepEqual(memory(), { seq: 5, waiting: false });
  });

  it('вырос счётчик — одно «Крабик закончил» с началом ответа', async () => {
    const { world, watch, sent } = setup({}, { seq: 1, waiting: false });
    world.state = { ...world.state, completionSeq: 4 };
    world.messages = [msg('user', 'Проверь ботов'), msg('assistant', 'Все боты живы.')];
    await watch.tick();
    assert.deepEqual(sent, [{ kind: 'done', title: 'Крабик закончил', body: 'Все боты живы.' }]);
    // Пропущенные пока мак спал ходы не дают лавину: следующий проход молчит.
    await watch.tick();
    assert.equal(sent.length, 1);
  });

  it('дежурство с СТАТУС: ОК молчит, с ПРОБЛЕМОЙ — пишет', async () => {
    const ok = setup({}, { seq: 1, waiting: false });
    ok.world.state = { ...ok.world.state, completionSeq: 2 };
    ok.world.messages = [msg('user', 'ДЕЖУРСТВО 2026-10-23. Быстрый обход'), msg('assistant', 'Всё в порядке')];
    ok.world.reports = [{ name: 'duty-2026-10-23.md', mtime: 2, status: 'ok', summary: '', title: '' }];
    await ok.watch.tick();
    assert.equal(ok.sent.length, 0);

    const bad = setup({}, { seq: 1, waiting: false });
    bad.world.state = { ...bad.world.state, completionSeq: 2 };
    bad.world.messages = ok.world.messages;
    bad.world.reports = [{ name: 'duty-2026-10-23.md', mtime: 2, status: 'problem', summary: 'диск 95%', title: '' }];
    await bad.watch.tick();
    assert.deepEqual(bad.sent, [{ kind: 'duty-problem', title: 'Крабик: на сервере проблема', body: 'диск 95%' }]);
  });

  it('ждёт ответа — одно сообщение, пока не ответили', async () => {
    const { world, watch, sent } = setup({}, { seq: 1, waiting: false });
    world.state = { ...world.state, status: 'blocked' };
    world.messages = [msg('assistant', 'Удалить старые бэкапы на 59 ГБ?')];
    await watch.tick();
    await watch.tick();
    assert.deepEqual(sent, [{ kind: 'waiting', title: 'Крабик ждёт ответа', body: 'Удалить старые бэкапы на 59 ГБ?' }]);
  });

  it('Herdr перезапускался (счётчик меньше) — молча начинает заново', async () => {
    const { world, watch, sent, memory } = setup({}, { seq: 40, waiting: false });
    world.state = { ...world.state, completionSeq: 2 };
    await watch.tick();
    assert.equal(sent.length, 0);
    assert.equal(memory()?.seq, 2);
  });

  it('мод выключен или нет связи — ничего не делает и не трогает память', async () => {
    const off = setup({ on: false }, { seq: 1, waiting: false });
    off.world.state = { ...off.world.state, completionSeq: 9 };
    await off.watch.tick();
    assert.deepEqual(off.memory(), { seq: 1, waiting: false });

    const down = setup({}, { seq: 1, waiting: false });
    down.world.state = { reachable: false, status: 'unknown', title: '', completionSeq: 0 };
    await down.watch.tick();
    assert.equal(down.sent.length, 0);
    assert.deepEqual(down.memory(), { seq: 1, waiting: false });
  });
});
