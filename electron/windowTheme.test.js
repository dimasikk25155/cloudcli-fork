import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  DEFAULT_WINDOW_BACKGROUND,
  initialWindowBackground,
  normalizeThemeChange,
  readWindowTheme,
  writeWindowTheme,
} from './windowTheme.js';

describe('цвет окна по теме', () => {
  it('принимает только {isDark, background:#rrggbb}', () => {
    assert.deepEqual(normalizeThemeChange({ isDark: false, background: '#FAF9F5' }), { isDark: false, background: '#faf9f5' });
    assert.equal(normalizeThemeChange({ isDark: true, background: 'red' }), null);
    assert.equal(normalizeThemeChange({ isDark: 'no', background: '#000000' }), null);
    assert.equal(normalizeThemeChange({ isDark: true, background: '#000000; x' }), null);
    assert.equal(normalizeThemeChange(null), null);
  });

  it('стартовый цвет — сохранённый, иначе прежний тёмный', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'neo3-window-theme-'));
    const file = path.join(dir, 'window-theme.json');
    assert.equal(initialWindowBackground(file), DEFAULT_WINDOW_BACKGROUND);
    assert.equal(DEFAULT_WINDOW_BACKGROUND, '#0f172a');

    writeWindowTheme(file, { isDark: false, background: '#faf9f5' });
    assert.deepEqual(readWindowTheme(file), { isDark: false, background: '#faf9f5' });
    assert.equal(initialWindowBackground(file), '#faf9f5');

    writeFileSync(file, '{"isDark":false,"background":"javascript:1"}');
    assert.equal(initialWindowBackground(file), DEFAULT_WINDOW_BACKGROUND);
    writeFileSync(file, 'not json');
    assert.equal(readWindowTheme(file), null);
    assert.ok(readFileSync(file, 'utf8'));
  });
});
