import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ThemePicker from './ThemePicker.js';

// Порядок и названия — из спецификации («Темы: что было и что стало»), не из кода.
const EXPECTED_ORDER = ['ember', 'codex', 'bio', 'neon', 'glass', 'claudeLight'];
const EXPECTED_LABELS = ['Оранжевая', 'Графит', 'Био', 'Неон', 'Бирюзовая', 'Светлая Claude'];
const EXPECTED_VARIANTS = ['Голубой', 'Розовый', 'Мятный', 'Синий', 'Зелёный', 'Сиреневый', 'Янтарный', 'Лаймовый'];

const render = (theme: string, neonVariant = 'city') =>
  renderToStaticMarkup(
    React.createElement(ThemePicker, {
      theme,
      neonVariant,
      onThemeChange: () => undefined,
      onNeonVariantChange: () => undefined,
    }),
  );

const themeCards = (html: string) => [...html.matchAll(/<button[^>]*data-theme-card="([^"]+)"[^>]*>/g)];

test('шесть карточек в порядке реестра, у каждой название', () => {
  const html = render('ember');
  assert.deepEqual(themeCards(html).map((match) => match[1]), EXPECTED_ORDER);
  for (const label of EXPECTED_LABELS) {
    assert.ok(html.includes(`>${label}<`), `нет подписи «${label}»`);
  }
});

test('выбрана одна карточка: aria-pressed только у неё', () => {
  const cards = themeCards(render('bio')).map((match) => match[0]);
  const pressed = cards.filter((tag) => tag.includes('aria-pressed="true"'));
  assert.equal(pressed.length, 1);
  assert.match(pressed[0], /data-theme-card="bio"/);
  assert.equal(cards.filter((tag) => tag.includes('aria-pressed="false"')).length, 5);
});

test('карточка живёт своей темой и показывает её же стекло, а не нарисованные цвета', () => {
  const html = render('glass');
  assert.match(html, /<button[^>]*data-theme="glass"[^>]*data-theme-card="glass"|<button[^>]*data-theme-card="glass"[^>]*data-theme="glass"/);
  assert.match(html, /var\(--glass-bg\)/);
  assert.match(html, /var\(--font-ui\)/);
  assert.doesNotMatch(html, /#[0-9a-fA-F]{3,8}\b/);
});

test('ряд вариантов «Неона» — только при выбранном неоне, 8 штук с подписями', () => {
  assert.doesNotMatch(render('ember'), /data-neon-variants/);
  const html = render('neon', 'zen');
  assert.match(html, /data-neon-variants/);
  const variants = [...html.matchAll(/<button[^>]*data-neon-variant="([^"]+)"[^>]*aria-label="([^"]+)"[^>]*>/g)];
  assert.deepEqual(variants.map((match) => match[2]), EXPECTED_VARIANTS);
  const selected = [...html.matchAll(/<button[^>]*data-neon-variant="zen"[^>]*>/g)][0][0];
  assert.match(selected, /aria-pressed="true"/);
  assert.equal([...html.matchAll(/data-neon-variant="[^"]+"[^>]*aria-pressed="true"/g)].length, 1);
});

test('карточка «Неона» показывает выбранный вариант своим атрибутом', () => {
  assert.match(render('neon', 'synthwave'), /data-theme-card="neon"[^>]*data-theme-variant="synthwave"|data-theme-variant="synthwave"[^>]*data-theme-card="neon"/);
});

test('карточки — кнопки с зоной нажатия не меньше 44 px', () => {
  for (const [tag] of themeCards(render('ember'))) {
    assert.match(tag, /type="button"/);
    const height = Number(/min-h-\[(\d+)px\]/.exec(tag)?.[1]);
    assert.ok(height >= 44, `высота ${height}`);
  }
});
