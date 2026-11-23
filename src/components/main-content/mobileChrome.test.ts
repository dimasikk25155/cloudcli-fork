import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import SettingsHeader from '../settings/view/SettingsHeader';

import MobileCanvasButton from './view/subcomponents/MobileCanvasButton';
import MobileMenuButton from './view/subcomponents/MobileMenuButton';

// Шапки телефона (истории 28, 29, 31): лист стекла вместо сплошной полосы,
// круглые стеклянные кнопки, полосы над полем ввода — тем же материалом.

(globalThis as { React?: typeof React }).React = React;

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const header = read('./view/subcomponents/MainContentHeader.tsx');
const mainContent = read('./view/MainContent.tsx');
const stateView = read('./view/subcomponents/MainContentStateView.tsx');

const classOf = (html: string, marker: RegExp): string => {
  const tag = html.match(marker);
  assert.ok(tag, `не нашёл элемент ${marker}`);
  return tag[0].match(/class="([^"]*)"/)?.[1] ?? '';
};

test('шапка чата — лист стекла без сплошной заливки фоном темы', () => {
  const root = header.match(/className="(pwa-header-safe pwa-header-air [^"]*)"/);
  assert.ok(root, 'корень шапки не найден');
  assert.match(root[1], /(^|\s)glass-sheet(\s|$)/);
  assert.doesNotMatch(root[1], /(^|\s)bg-background(\s|$|\/)/, 'шапка залита фоном темы');
  // Затухание краёв ряда вкладок красилось фоном темы — на стекле это пятна.
  assert.doesNotMatch(header, /from-background/);
  // Шапка загрузки — тот же лист.
  assert.match(stateView, /className="pwa-header-safe glass-sheet /);
});

test('кнопка ☰: круглая стеклянная, подпись по-русски', () => {
  const html = renderToStaticMarkup(React.createElement(MobileMenuButton, { onMenuClick: () => {} }));
  const classes = classOf(html, /<button[^>]*>/);
  assert.match(classes, /(^|\s)glass-button(\s|$)/);
  assert.match(classes, /(^|\s)pwa-menu-button(\s|$)/);
  assert.match(html, /aria-label="Открыть меню"/);
  assert.doesNotMatch(html, /Open menu/);
});

test('«домой» в шапке — круглая стеклянная кнопка', () => {
  const home = header.match(/onClick=\{onGoHome\}[\s\S]*?className="([^"]*)"/);
  assert.ok(home, 'кнопка «домой» не найдена');
  assert.match(home[1], /(^|\s)glass-button(\s|$)/);
});

test('«Холст» на телефоне — круглая стеклянная кнопка, открывает холст', () => {
  let opened = 0;
  const element = MobileCanvasButton({ onClick: () => { opened += 1; } });
  (element.props as { onClick: () => void }).onClick();
  assert.equal(opened, 1);
  const html = renderToStaticMarkup(element);
  const classes = classOf(html, /<button[^>]*>/);
  assert.match(classes, /(^|\s)glass-button(\s|$)/);
  assert.match(html, /aria-label="Открыть холст"/);
  assert.match(html, /data-workbench-toggle/);
  // На телефоне шапка получает эту кнопку, на компьютере — прежний переключатель.
  assert.match(mainContent, /isMobile\s*\?\s*\(?\s*<MobileCanvasButton/);
  assert.match(mainContent, /<WorkbenchToggle/);
});

test('шапка настроек — лист стекла, отступ под статус-бар сохранён', () => {
  const html = renderToStaticMarkup(React.createElement(SettingsHeader, { title: 'Настройки', onClose: () => {} }));
  const classes = classOf(html, /<div[^>]*>/);
  assert.match(classes, /(^|\s)pwa-settings-header(\s|$)/);
  assert.match(classes, /(^|\s)glass-sheet(\s|$)/);
  const back = classOf(html, /<button[^>]*aria-label="Назад"[^>]*>/);
  assert.match(back, /(^|\s)glass-button(\s|$)/);
  assert.match(back, /(^|\s)md:hidden(\s|$)/);
});

test('полосы над полем ввода и полоса веток — стекло, без своей заливки карточкой', () => {
  const bands: Array<[string, RegExp]> = [
    ['../session-hub/SessionHubBar.tsx', /className="[^"]*\bglass-pill\b[^"]*"/],
    ['../improvement-ideas/IdeaCards.tsx', /<details className="[^"]*\bglass-surface\b[^"]*"/],
    ['../crabs/CrabSquadBand.tsx', /className="[^"]*\bglass-surface\b[^"]*" data-crab-squad/],
    ['../relay/RelayBand.tsx', /className="[^"]*\bglass-surface\b[^"]*"\s+data-testid="relay-band"/],
    ['../threads/ThreadsBar.tsx', /className="[^"]*\bglass-sheet\b[^"]*" data-threads-bar/],
  ];
  for (const [file, glass] of bands) {
    const source = read(file);
    assert.match(source, glass, `${file}: нет класса стекла`);
    assert.doesNotMatch(source, /backdrop-blur/, `${file}: своё размытие`);
  }
  const relay = read('../relay/RelayBand.tsx');
  assert.equal(relay.match(/glass-surface[^"]*"\s+data-testid="relay-band"/g)?.length, 2, 'оба вида полосы переноса — стекло');
});
