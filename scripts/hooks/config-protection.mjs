#!/usr/bin/env node
/**
 * PreToolUse-хук Neo3 (Edit|Write|MultiEdit): не даёт агенту «зеленить» проверки,
 * ослабляя их конфиги, вместо того чтобы чинить код. Идея — ECC config-protection
 * (affaan-m/ECC, MIT), своя короткая версия.
 *
 * Обычные правки конфигов пропускаются (например, регистрация нового файла
 * в `boundaries` eslint.config.js). Блокируется только ДОБАВЛЕНИЕ ослабления:
 * правило в 'off'/'warn'/0, новые ignores, strict/noImplicitAny → false,
 * skipLibCheck → true, @ts-nocheck / eslint-disable, обход husky.
 * Выход 2 = отказ, текст в stderr уходит агенту. Любой сбой разбора — пропуск.
 */
import fs from 'node:fs';
import path from 'node:path';

const CONFIG_NAME = /^(eslint\.config\.[cm]?[jt]s|\.eslintrc(\.\w+)?|tsconfig(\.[\w-]+)?\.json|\.prettierrc(\.\w+)?|prettier\.config\.[cm]?js|commitlint\.config\.[cm]?js|\.lintstagedrc(\.\w+)?)$/;

const WEAKENING = [
  [/['"]off['"]/, 'правило выключено (off)'],
  [/:\s*['"]warn['"]/, 'ошибка понижена до warn'],
  [/['"][\w@/-]+['"]\s*:\s*0\b/, 'правило выключено (0)'],
  [/\bignores\s*:|ignorePatterns|globalIgnores\(/, 'новые исключения из проверки'],
  [/"strict"\s*:\s*false/, 'strict выключен'],
  [/"noImplicitAny"\s*:\s*false/, 'noImplicitAny выключен'],
  [/"skipLibCheck"\s*:\s*true/, 'skipLibCheck включён'],
  [/"noUnused(Locals|Parameters)"\s*:\s*false/, 'проверка неиспользуемого выключена'],
  [/@ts-nocheck|eslint-disable/, 'отключение проверок в файле'],
  [/HUSKY\s*=\s*0|--no-verify/, 'обход pre-commit'],
];

function addedText(oldText, newText) {
  const before = new Set(String(oldText ?? '').split('\n').map((line) => line.trim()));
  return String(newText ?? '')
    .split('\n')
    .filter((line) => !before.has(line.trim()))
    .join('\n');
}

function findWeakening(text) {
  return WEAKENING.filter(([re]) => re.test(text)).map(([, why]) => why);
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(raw || '{}');
    const input = data.tool_input || {};
    const file = input.file_path || input.path || '';
    const isHusky = /(^|\/)\.husky\//.test(file);
    if (!file || (!CONFIG_NAME.test(path.basename(file)) && !isHusky)) process.exit(0);
    if (!fs.existsSync(file)) process.exit(0); // новый конфиг создавать можно

    let added = '';
    if (data.tool_name === 'Write') {
      added = addedText(fs.readFileSync(file, 'utf8'), input.content);
    } else if (data.tool_name === 'MultiEdit') {
      added = (input.edits || []).map((edit) => addedText(edit.old_string, edit.new_string)).join('\n');
    } else {
      added = addedText(input.old_string, input.new_string);
    }
    const reasons = isHusky && added.trim() ? ['правка хуков git (.husky)'] : findWeakening(added);
    if (reasons.length === 0) process.exit(0);
    process.stderr.write(
      `ЗАПРЕЩЕНО: правка ${path.basename(file)} ослабляет проверки (${reasons.join(', ')}). `
      + 'Не выключай линтер/типы/pre-commit, чтобы «стало зелёным», — чини сам код. '
      + 'Если ослабление правда нужно, объясни Диме зачем и попроси сделать это вручную.\n',
    );
    process.exit(2);
  } catch {
    process.exit(0);
  }
});
