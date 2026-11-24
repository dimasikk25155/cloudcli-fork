import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Zap } from 'lucide-react';

import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
} from '../../../../shared/view/ui/PromptInput';

import EffortControl from './EffortControl';
import PromptCacheChip from './PromptCacheChip';
import TokenUsageSummary from './TokenUsageSummary';
import UsageLimitsBadge from './UsageLimitsBadge';
import { ChipLabel, PERMISSION_MODE_TONE, WORK_MODE_ICON, WorkModeFace } from './composerChips';

// Поле ввода на телефоне (история 27 и 42): стеклянная карточка, внутри —
// круги и пилюли стекла, «отправить» — залитый круг; режим работы и уровень
// размышления — только значок, проценты видны целиком.

(globalThis as { React?: typeof React }).React = React;

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(here, '..', '..', '..', '..');
const css = readFileSync(path.join(srcRoot, 'index.css'), 'utf8');
const composerSource = readFileSync(path.join(here, 'ChatComposer.tsx'), 'utf8');

const classOf = (html: string, marker: RegExp): string => {
  const tag = html.match(marker);
  assert.ok(tag, `не нашёл элемент ${marker}`);
  return tag[0].match(/class="([^"]*)"/)?.[1] ?? '';
};

test('карточка поля ввода — стекло, без своей заливки, размытия и черты над кнопками', () => {
  const html = renderToStaticMarkup(
    React.createElement(PromptInput, null, React.createElement(PromptInputFooter, null, 'ряд')),
  );
  const form = classOf(html, /<form[^>]*data-slot="prompt-input"[^>]*>/);
  assert.match(form, /(^|\s)glass-surface(\s|$)/);
  assert.doesNotMatch(form, /backdrop-blur|bg-card|rounded-xl|shadow-sm|border-border/);
  const footer = classOf(html, /<div[^>]*data-slot="prompt-input-footer"[^>]*>/);
  assert.match(footer, /(^|\s)composer-footer(\s|$)/);
  assert.doesNotMatch(footer, /border-t/, 'черта над рядом кнопок осталась');
});

test('кнопки карточки: круг стекла и залитый круг «отправить»', () => {
  const button = renderToStaticMarkup(React.createElement(PromptInputButton, { 'aria-label': 'Вложение' }, '+'));
  const round = classOf(button, /<button[^>]*>/);
  assert.match(round, /(^|\s)glass-button(\s|$)/);
  assert.match(round, /(^|\s)composer-chip(\s|$)/);
  const submit = renderToStaticMarkup(React.createElement(PromptInputSubmit, { className: 'composer-submit' }));
  const primary = classOf(submit, /<button[^>]*>/);
  assert.match(primary, /(^|\s)glass-button-primary(\s|$)/);
  assert.match(primary, /(^|\s)composer-submit(\s|$)/);
  assert.doesNotMatch(primary, /rounded-lg|h-10 w-14|bg-primary/, 'у «отправить» осталась прежняя прямоугольная форма');
});

test('режим работы: значок и подпись, которую телефон прячет; у «Обычного» — молния', () => {
  assert.equal(WORK_MODE_ICON.autopilot, Zap);
  assert.equal(new Set(Object.values(WORK_MODE_ICON)).size, 4, 'у режимов работы совпали значки');
  const html = renderToStaticMarkup(React.createElement(WorkModeFace, { mode: 'autopilot', label: 'Обычный' }));
  assert.match(html, /lucide-zap/);
  assert.match(html, /<span class="composer-chip-label">Обычный<\/span>/);
});

test('уровень размышления: свой значок (не молния режима), подпись — в aria-label и в прячущейся метке', () => {
  const options = [{ value: 'low' }, { value: 'medium' }, { value: 'high' }] as never;
  const html = renderToStaticMarkup(
    React.createElement(EffortControl, { modelLabel: 'Opus 5.5', effort: 'medium', defaultEffort: 'medium', options, onSelect: () => {} }),
  );
  const trigger = html.match(/<button[^>]*aria-haspopup="dialog"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? '';
  assert.match(trigger, /aria-label="Уровень размышления: Средний"/);
  assert.match(trigger, /class="[^"]*\bglass-pill\b/);
  assert.match(trigger, /lucide-brain/);
  assert.doesNotMatch(trigger, /lucide-zap/, 'молния занята режимом работы');
  assert.match(trigger, /<span class="composer-chip-label">Средний<\/span>/);
});

test('подпись чипа прячется на телефоне и в узком поле ввода, а проценты — никогда', () => {
  assert.equal(renderToStaticMarkup(React.createElement(ChipLabel, null, 'Средний')), '<span class="composer-chip-label">Средний</span>');

  const phone = css.match(/@media \(max-width: 767px\) \{\s*\/\* composer:compact \*\/([\s\S]*?)\n  \}/);
  assert.ok(phone, 'нет телефонной ветки composer:compact');
  const narrow = css.match(/@container composer \(max-width: (\d+)px\) \{\s*\/\* composer:compact \*\/([\s\S]*?)\n  \}/);
  assert.ok(narrow, 'нет ветки composer:compact для узкого поля ввода (второй чат)');
  assert.match(css, /\[data-slot='prompt-input'\]\s*\{[^}]*container:\s*composer \/ inline-size/);
  const squash = (value: string) => value.replace(/\s+/g, ' ').trim();
  assert.equal(squash(phone[1]), squash(narrow[2]), 'телефон и узкое поле ввода расходятся в раскладке');
  for (const branch of [phone[1], narrow[2]]) {
    assert.match(branch, /\.composer-chip-label[^{]*\{\s*display:\s*none/);
    // Чипы с процентом уходят на свою строку и не прячутся под прокрутку ряда.
    assert.match(branch, /\.composer-meters\s*\{[^}]*flex-basis:\s*100%/);
    assert.doesNotMatch(branch, /composer-meter[^{]*\{[^}]*display:\s*none/);
  }

  // Число с «%» стоит вне прячущейся метки.
  const context = renderToStaticMarkup(React.createElement(TokenUsageSummary, { usage: { used: 260000 }, contextWindow: 1000000 }));
  assert.match(context, /class="[^"]*\bcomposer-meter\b[^"]*"/);
  assert.match(context, /class="[^"]*\bglass-pill\b[^"]*"/);
  assert.match(context, />26%</);
  assert.doesNotMatch(context, /composer-chip-label/);
  assert.match(context, /<svg/, 'у процента нет значка');

  const limits = renderToStaticMarkup(React.createElement(UsageLimitsBadge, { model: 'opus', provider: 'claude' }));
  assert.match(limits, /class="[^"]*\bcomposer-meter\b[^"]*"/);
  assert.match(limits, />5ч[^<]*</);
  assert.match(limits, /<svg/);
  assert.doesNotMatch(limits, /<span class="composer-chip-label">[^<]*5ч/);

  const cache = renderToStaticMarkup(
    React.createElement(PromptCacheChip, { variant: 'compact', lastModelAt: Date.now() - 60_000, isRunning: false }),
  );
  assert.match(cache, /class="[^"]*\bcomposer-meter\b[^"]*"/);
  assert.match(cache, /мин/);
});

test('режимы разрешений различимы цветами статусов темы, а не жёсткой палитрой', () => {
  assert.match(PERMISSION_MODE_TONE.plan.dot, /\bbg-info\b/);
  assert.match(PERMISSION_MODE_TONE.bypassPermissions.dot, /\bbg-warning\b/);
  assert.match(PERMISSION_MODE_TONE.default.dot, /\bbg-muted-foreground\b/);
  const dots = new Set(Object.values(PERMISSION_MODE_TONE).map((tone) => tone.dot));
  assert.equal(dots.size, Object.keys(PERMISSION_MODE_TONE).length, 'у двух режимов одна точка');
  for (const tone of Object.values(PERMISSION_MODE_TONE)) {
    assert.doesNotMatch(`${tone.dot} ${tone.button}`, /(blue|orange|violet|gray)-\d|dark:/);
  }
});

test('в ряду поля ввода всё на месте: вложение, режимы, модель, размышление, проценты, голос, отправка', () => {
  for (const group of ['composer-meters', 'composer-actions']) {
    assert.match(composerSource, new RegExp(`className="[^"]*\\b${group}\\b`), `нет группы ${group}`);
  }
  const toolsAt = composerSource.indexOf('<PromptInputTools>');
  const metersAt = composerSource.indexOf('composer-meters');
  const actionsAt = composerSource.indexOf('composer-actions');
  assert.ok(toolsAt > 0 && toolsAt < metersAt && metersAt < actionsAt, 'порядок групп: кнопки, показания, действия');
  const tools = composerSource.slice(toolsAt, metersAt);
  for (const piece of ['openImagePicker', 'onSelectPermissionMode', 'onSelectWorkMode', 'onSelectModel', '<EffortControl', 'onClearInput']) {
    assert.ok(tools.includes(piece), `${piece} не в ряду кнопок`);
  }
  const meters = composerSource.slice(metersAt, actionsAt);
  for (const piece of ['<PromptCacheChip', '<TokenUsageSummary', '<UsageLimitsBadge']) {
    assert.ok(meters.includes(piece), `${piece} не в строке процентов`);
  }
  const actions = composerSource.slice(composerSource.indexOf('composer-actions'));
  for (const piece of ['<VoiceInputButton', '<PromptInputSubmit', 'onAbortSession', 'voiceStop({ send: true })']) {
    assert.ok(actions.includes(piece), `${piece} не в правой группе`);
  }
  // Подписи режима и модели остаются для чтения с экрана.
  assert.match(composerSource, /aria-label=\{`\$\{t\('workMode\.title'[^`]*\$\{workModeLabel\}`\}/);
});

const PALETTE = /\b(?:bg|text|border|ring|from|to|via|fill|stroke|decoration|outline|divide|placeholder)-(?:gray|slate|zinc|neutral|stone|red|green|blue|amber|orange|emerald|yellow|rose|violet|purple|indigo|pink|teal|cyan|sky|lime|fuchsia)-\d{2,3}\b|\btext-white\b|\bbg-white\b|\bdark:/;

test('оболочка чата без жёсткой палитры и пар dark:', () => {
  const files = [
    'components/chat/view/subcomponents/ChatComposer.tsx',
    'components/chat/view/subcomponents/composerChips.tsx',
    'components/chat/view/subcomponents/ChatMessagesPane.tsx',
    'components/chat/view/subcomponents/Markdown.tsx',
    'components/chat/view/subcomponents/EffortControl.tsx',
    'components/chat/view/subcomponents/TokenUsageSummary.tsx',
    'components/chat/view/subcomponents/UsageLimitsBadge.tsx',
    'components/chat/view/subcomponents/CodexUsageLimitsBadge.tsx',
    'components/chat/view/subcomponents/PromptCacheChip.tsx',
    'components/chat/view/subcomponents/VoiceInputButton.tsx',
    'components/main-content/view/subcomponents/MainContentHeader.tsx',
    'components/main-content/view/subcomponents/MobileMenuButton.tsx',
    'components/panels/PanelModal.tsx',
    'components/panels/PanelBackButton.tsx',
    'components/settings/view/SettingsHeader.tsx',
    'shared/view/ui/PromptInput.tsx',
  ];
  for (const file of files) {
    const source = readFileSync(path.join(srcRoot, file), 'utf8');
    const hit = source.match(PALETTE);
    assert.equal(hit, null, `${file}: «${hit?.[0]}»`);
    // Чёрный — только затемнение оверлея (bg-black/NN), сплошного нет.
    assert.doesNotMatch(source, /\bbg-black(?!\/)/, `${file}: сплошной bg-black`);
  }
});

test('в зоне чата и панелей размытие — только классами стекла', () => {
  const zone = [
    'components/chat', 'shared/view/ui', 'components/main-content', 'components/panels', 'components/session-hub',
    'components/relay', 'components/crabs', 'components/improvement-ideas', 'components/threads', 'components/app-icon',
  ];
  const files: string[] = [path.join(srcRoot, 'components/settings/view/SettingsHeader.tsx')];
  for (const dir of zone) {
    (function walk(current: string) {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(tsx|ts|css)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) files.push(full);
      }
    })(path.join(srcRoot, dir));
  }
  assert.ok(files.length > 100, 'зона не прочитана');
  for (const file of files) {
    const relative = path.relative(srcRoot, file);
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const hit = code.match(/backdrop-blur(?:-[a-z0-9]+)?|backdropFilter|backdrop-filter/);
    assert.equal(hit, null, `${relative}: «${hit?.[0]}» — стекло делается классами .glass-*`);
  }
});
