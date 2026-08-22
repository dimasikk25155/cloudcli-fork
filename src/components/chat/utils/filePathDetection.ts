// Распознавание путей в сообщениях чата.
//
// Модель постоянно упоминает файлы прозой и в бэктиках, и это единственный способ
// добраться до файла, не переписывая его имя руками в поиск. Раньше правило было
// «путь — это строка без пробелов с расширением», и оно отсекало ровно те пути,
// которые встречаются чаще всего: `/home/agents/Antigravity Project/claude agent/…`.
// Пробелы здесь — норма, а не признак того, что перед нами команда.
//
// Отличать путь от команды приходится по другим приметам: флаги (`-f`, `--force`),
// кавычки, шелл-мусор и первое слово-команда. Всё, что похоже на shell, — не путь.

/** Первое слово этих команд означает, что дальше идут аргументы, а не путь. */
const COMMAND_WORDS = new Set([
  'cd', 'ls', 'cat', 'cp', 'mv', 'rm', 'mkdir', 'touch', 'chmod', 'chown', 'ln',
  'head', 'tail', 'grep', 'rg', 'find', 'sed', 'awk', 'echo', 'less', 'more', 'diff',
  'npm', 'npx', 'pnpm', 'yarn', 'node', 'tsx', 'python', 'python3', 'pip', 'uv', 'go',
  'git', 'docker', 'ssh', 'scp', 'rsync', 'curl', 'wget', 'tar', 'zip', 'unzip',
  'sudo', 'systemctl', 'journalctl', 'service', 'pkill', 'kill', 'ps', 'nohup', 'setsid',
  'bash', 'sh', 'zsh', 'source', 'export', 'env', 'set', 'cmd', 'powershell',
  'codex', 'vim', 'nano',
  // `claude` сюда не попадает намеренно: это имя рабочей папки («claude agent»),
  // а команда `claude …` и так отсеивается флагом или отсутствием расширения.
]);

// Шелл-пунктуация: конвейер, подстановка, маска, перенаправление, кавычки.
// Круглые скобки сюда НЕ входят: в вольте полно заметок вида
// «Возврат в море матросом — разведка (2026-07-30).md», и они тоже файлы.
// Подстановку `$(...)` ловит `$` из этого же набора.
const SHELL_NOISE = /[`|*?<>$"'{}[\]]|&&|\|\||;\s/;

/** Флаг вида `-f` или `--force` — верный признак команды, а не пути. */
const FLAG_TOKEN = /(^|\s)--?[A-Za-z]/;

const PROTOCOL = /^(https?:|ftp:|mailto:|tel:|data:|file:|www\.)/i;

// Домен без слэша неотличим от файла по одному только «расширению»:
// `cdn.sky-flame.online` и `notes.md` устроены одинаково. Разводим по зоне.
const DOMAIN = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.(com|ru|org|net|io|dev|app|ai|me|online|shop|site|xyz|pro|info|biz|su|kz|by|ua|uk|de|fr|tv|cc|co)$/i;

/** Путь начинается «от корня»: `/`, `~/`, `./`, `../` или `C:\`. */
const ANCHORED = /^(\/|~$|~[\\/]|\.{1,2}[\\/]|[A-Za-z]:[\\/])/;

const SEPARATOR = /[\\/]/;

/** Расширение из латиницы: отсекает версии (`2.1.218`) и сокращения. */
const EXTENSION = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;

const MAX_LENGTH = 240;

/** Убирает хвост `:строка` / `:строка:колонка` (`src/foo.ts:130`). */
export const stripLineSuffix = (value: string): string => value.replace(/:\d+(?::\d+)?$/, '');

/**
 * Похоже ли это на путь к файлу или папке.
 *
 * Осознанно пропускает пробелы: у Димы каждый второй путь — `Antigravity Project`.
 * Существует ли файл на самом деле, решает сервер при клике; здесь только вопрос
 * «это вообще путь или кусок команды».
 */
export function looksLikePath(value: string | undefined | null): value is string {
  if (!value) return false;

  const cleaned = stripLineSuffix(value.trim());
  if (!cleaned || cleaned === '#' || cleaned.length > MAX_LENGTH) return false;
  if (/[\n\r]/.test(cleaned)) return false;
  if (PROTOCOL.test(cleaned)) return false;
  if (SHELL_NOISE.test(cleaned)) return false;

  const hasSpace = /\s/.test(cleaned);
  const anchored = ANCHORED.test(cleaned);
  const hasSeparator = SEPARATOR.test(cleaned);
  // Расширение ищем в конце имени, а не после слэша папки.
  const withoutTrailingSlash = cleaned.replace(/[\\/]+$/, '');
  const hasExtension = EXTENSION.test(withoutTrailingSlash);
  const endsWithSlash = /[\\/]$/.test(cleaned);

  if (hasSpace) {
    // Команда с аргументами: `npm run build`, `cd /opt`, `tail -f x.log`.
    if (FLAG_TOKEN.test(cleaned)) return false;
    const firstWord = cleaned.split(/\s+/)[0].toLowerCase();
    if (COMMAND_WORDS.has(firstWord)) return false;
    // Со пробелами опора только одна — путь обязан кончаться именем файла или
    // слэшем папки. Без этого в ссылки уезжает проза: кусок текста, начатый со
    // слэша, формально «начинается от корня» и раньше проходил (проверено на
    // реальной истории чатов).
    if (!hasExtension && !endsWithSlash) return false;
  }

  if (!hasSeparator && DOMAIN.test(cleaned)) return false;

  if (anchored && hasSeparator) return true;
  if (endsWithSlash && hasSeparator) return true;
  if (hasSeparator && hasExtension) return true;
  // Голое имя файла в бэктиках (`README.md`) — тоже ссылка, но только без пробелов.
  return hasExtension && !hasSpace;
}

/** Подсказка для иконки: путь выглядит папкой (кончается слэшем или без расширения). */
export function looksLikeDirectory(value: string): boolean {
  const cleaned = stripLineSuffix(value.trim());
  if (/[\\/]$/.test(cleaned)) return true;
  return !EXTENSION.test(cleaned);
}

/**
 * Оборачивает адреса markdown-ссылок с пробелами в угловые скобки.
 *
 * По стандарту `[текст](/home/agents/Antigravity Project/f.md)` — не ссылка вовсе:
 * пробел обрывает адрес, и разметка отдаёт это простым текстом. Кликать нечего.
 * Форма `[текст](</home/… f.md>)` стандартом разрешена, поэтому достаточно
 * дописать скобки до разбора — дальше ссылка живёт как обычная.
 *
 * Код не трогаем: внутри бэктиков `<>` остались бы видны как мусор.
 */
export function bracketSpacedLinkTargets(markdown: string): string {
  if (!markdown || typeof markdown !== 'string' || !markdown.includes('](')) return markdown;

  const segments = markdown.split(/(```[\s\S]*?```|`[^`\n]*`)/g);

  return segments
    .map((segment, index) => {
      // Нечётные куски — это код (разделитель регулярки), они идут как есть.
      if (index % 2 === 1) return segment;

      return segment.replace(
        /(!?)\[([^\]\n]*)\]\(([^()\n]*)\)/g,
        (match, bang: string, text: string, target: string) => {
          if (bang) return match;
          const trimmed = target.trim();
          if (!trimmed || trimmed.startsWith('<') || !/\s/.test(trimmed)) return match;
          if (PROTOCOL.test(trimmed)) return match;
          if (!looksLikePath(trimmed)) return match;
          return `[${text}](<${trimmed}>)`;
        },
      );
    })
    .join('');
}

/**
 * Короткая подпись для пути: только имя файла с расширением.
 *
 * Дима читает чат с телефона и с проектора, а пути у него длиной в строку:
 * `/home/agents/Antigravity Project/Dimasik-Obsidian/Dimasik/wiki/concepts/x.md`.
 * Такая ссылка переносится на две строки и съедает ответ. Кликают по ней всё
 * равно, а не переписывают руками, поэтому показываем `x.md`, а полный путь
 * оставляем в подсказке при наведении (`title`) — скопировать по-прежнему можно.
 *
 * Короткие пути (`src/foo.ts`) не трогаем: прятать там нечего, а папка помогает
 * различить одноимённые файлы.
 */
const SHORTEN_THRESHOLD = 34;

export function shortenPathLabel(value: string): string {
  const cleaned = value.trim();
  if (!cleaned || !SEPARATOR.test(cleaned)) return cleaned;
  if (cleaned.length <= SHORTEN_THRESHOLD) return cleaned;

  // Хвост `:120` (номер строки) сохраняем: по нему видно, о каком месте речь.
  const lineSuffix = cleaned.match(/:\d+(?::\d+)?$/)?.[0] ?? '';
  const withoutSuffix = cleaned.slice(0, cleaned.length - lineSuffix.length);

  const endsWithSlash = /[\\/]$/.test(withoutSuffix);
  const segments = withoutSuffix.split(/[\\/]+/).filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) return cleaned;

  return `${last}${endsWithSlash ? '/' : ''}${lineSuffix}`;
}
