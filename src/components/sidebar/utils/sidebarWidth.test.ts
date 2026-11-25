import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_STORAGE_KEY,
  clampSidebarWidth,
  parseStoredSidebarWidth,
  readSidebarWidth,
  sidebarMaxWidthFor,
  sidebarWidthForKey,
  writeSidebarWidth,
} from './sidebarWidth.js';

const withStorage = (fn: (store: Map<string, string>) => void) => {
  const store = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    },
  });
  try {
    fn(store);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
};

test('clampSidebarWidth: держит ширину между минимумом и максимумом', () => {
  assert.equal(clampSidebarWidth(100), SIDEBAR_MIN_WIDTH);
  assert.equal(clampSidebarWidth(5000), SIDEBAR_MAX_WIDTH);
  assert.equal(clampSidebarWidth(333.6), 334);
  assert.equal(clampSidebarWidth(Number.NaN), SIDEBAR_DEFAULT_WIDTH);
});

test('clampSidebarWidth: в узком окне чату остаётся место', () => {
  assert.equal(sidebarMaxWidthFor(1920), SIDEBAR_MAX_WIDTH);
  assert.equal(sidebarMaxWidthFor(900), 900 - 480);
  assert.equal(clampSidebarWidth(560, 900), 420);
  // Совсем узкое окно — не меньше минимума.
  assert.equal(sidebarMaxWidthFor(600), SIDEBAR_MIN_WIDTH);
  assert.equal(clampSidebarWidth(400, 600), SIDEBAR_MIN_WIDTH);
});

test('parseStoredSidebarWidth: мусор и пусто — прежние 288', () => {
  assert.equal(parseStoredSidebarWidth(null), SIDEBAR_DEFAULT_WIDTH);
  assert.equal(parseStoredSidebarWidth(''), SIDEBAR_DEFAULT_WIDTH);
  assert.equal(parseStoredSidebarWidth('abc'), SIDEBAR_DEFAULT_WIDTH);
  assert.equal(parseStoredSidebarWidth('400'), 400);
  assert.equal(parseStoredSidebarWidth('9999'), SIDEBAR_MAX_WIDTH);
});

test('read/writeSidebarWidth: запоминает на устройстве, обычная ширина — без записи', () => {
  withStorage((store) => {
    assert.equal(readSidebarWidth(), SIDEBAR_DEFAULT_WIDTH);
    writeSidebarWidth(420);
    assert.equal(store.get(SIDEBAR_WIDTH_STORAGE_KEY), '420');
    assert.equal(readSidebarWidth(), 420);
    writeSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
    assert.equal(store.has(SIDEBAR_WIDTH_STORAGE_KEY), false);
    assert.equal(readSidebarWidth(), SIDEBAR_DEFAULT_WIDTH);
  });
});

test('readSidebarWidth: без localStorage — обычная ширина, без исключения', () => {
  assert.equal(readSidebarWidth(), SIDEBAR_DEFAULT_WIDTH);
});

test('sidebarWidthForKey: стрелки, Shift, Home/End, Enter', () => {
  assert.equal(sidebarWidthForKey('ArrowRight', 300, false), 316);
  assert.equal(sidebarWidthForKey('ArrowLeft', 300, true), 236);
  assert.equal(sidebarWidthForKey('ArrowLeft', 230, false), SIDEBAR_MIN_WIDTH);
  assert.equal(sidebarWidthForKey('Home', 400, false), SIDEBAR_MIN_WIDTH);
  assert.equal(sidebarWidthForKey('End', 300, false, 1000), 520);
  assert.equal(sidebarWidthForKey('Enter', 500, false), SIDEBAR_DEFAULT_WIDTH);
  assert.equal(sidebarWidthForKey('a', 300, false), null);
});
