import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx$/.test(name) ? [full] : [];
  });

// Ряд «текст + кнопка сбоку» в обход SettingsRow: `justify-between` без
// перехода в колонку на телефоне (`flex-col`, `flex-wrap` или `sm:`/`md:`-ряд).
const SIDE_BY_SIDE = /className="flex (?:items-(?:center|start) )?justify-between[^"]*"/g;

test('в настройках нет строк «описание + кнопка сбоку», собранных в обход SettingsRow', () => {
  const offenders: string[] = [];
  for (const file of sources(root)) {
    if (file.endsWith('SettingsRow.tsx')) continue;
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(SIDE_BY_SIDE)) {
      offenders.push(`${path.relative(root, file)}: ${match[0]}`);
    }
  }
  // Допустимые исключения (заголовок раздела с одной короткой кнопкой, тумблеры,
  // однострочные пункты списка) названы явно.
  const allowed = [
    /VoiceSettingsTab\.tsx/, // тумблеры
    /ApiKeysSection\.tsx: className="flex items-center justify-between"/, // заголовок + «Новый»
    /GithubCredentialsSection\.tsx: className="flex items-center justify-between"/,
    /CreateUserSection\.tsx/,
    /ThemeTweakPreview\.tsx/, // макет темы, не строка настроек
    /PermissionsContent\.tsx/, // однострочные пункты со значком «убрать»
  ];
  const real = offenders.filter((line) => !allowed.some((rule) => rule.test(line)));
  assert.deepEqual(real, []);
});
