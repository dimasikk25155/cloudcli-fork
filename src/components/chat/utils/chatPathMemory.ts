// Память путей внутри одного чата.
//
// Агент сначала называет файл полностью (`/Users/…/voice-messages/ru.ogg`), а
// дальше по тексту — коротко (`ru.ogg`). Короткое имя сервер ищет перебором
// папок с лимитом по времени, и в большом дереве (домашняя папка, весь
// `Antigravity Project`) не успевает: Дима получал «Файл не найден» с путём
// внутри текущего проекта (20.11). Человек при этом имеет в виду ровно тот файл,
// который в этом же чате уже звучал полностью, — его и подставляем.
//
// Запоминаем при отрисовке ссылки, подставляем при клике. Область — чат
// (id из адреса), чтобы одноимённый файл из другого чата не подменил нужный.

const SEPARATOR = /[\\/]/;
// Только пути «от корня»: относительный `docs/ru.ogg` сам по себе неоднозначен.
const ANCHORED = /^(\/|~[\\/]|[A-Za-z]:[\\/])/;

const memory = new Map<string, Map<string, string>>();

const baseName = (value: string): string => {
  const parts = value.replace(/[\\/]+$/, '').split(/[\\/]/);
  return (parts[parts.length - 1] ?? '').toLowerCase();
};

const scopeKey = (scope: string | null | undefined): string => scope || 'global';

/** Запомнить полный путь, упомянутый в чате `scope`. Позднее упоминание побеждает. */
export function rememberChatPath(scope: string | null | undefined, filePath: string): void {
  const value = filePath.trim();
  if (!ANCHORED.test(value)) return;
  const name = baseName(value);
  if (!name) return;
  const key = scopeKey(scope);
  let paths = memory.get(key);
  if (!paths) {
    paths = new Map();
    memory.set(key, paths);
  }
  paths.set(name, value);
}

/**
 * Полный путь для голого имени файла, если такой файл уже звучал в этом чате.
 * Путь с папками и незнакомое имя возвращаются как есть.
 */
export function expandChatPath(scope: string | null | undefined, filePath: string): string {
  const value = filePath.trim();
  if (!value || SEPARATOR.test(value)) return filePath;
  return memory.get(scopeKey(scope))?.get(value.toLowerCase()) ?? filePath;
}

/** Только для тестов. */
export function resetChatPathMemory(): void {
  memory.clear();
}
