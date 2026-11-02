import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { IdeaRow } from '@/modules/database/index.js';

const START = '<!-- neo3-ideas:start -->';
const END = '<!-- neo3-ideas:end -->';
const statuses = { proposed: 'Предложено', later: 'Позже', starting: 'Запуск не подтверждён; проверь исходный чат', started: 'Запущено (результат см. в чате)' };

/** Dedicated managed section: human additions outside it survive every sync. */
export async function writeIdeasVault(root: string, projectPath: string, userId: number, rows: IdeaRow[]): Promise<string> {
  const canonicalRoot = await fs.realpath(root);
  let directory = canonicalRoot;
  for (const part of ['wiki', 'ideas']) {
    directory = path.join(directory, part);
    await fs.mkdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory) throw Error('Unsafe vault directory');
  }
  const key = createHash('sha256').update(`${userId}\0${projectPath}`).digest('hex').slice(0, 20);
  const relative = `wiki/ideas/neo3-${key}.md`;
  const target = path.join(canonicalRoot, relative);
  let previous: string | null = null;
  try {
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Unsafe vault file');
    previous = await fs.readFile(target, 'utf8');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const heading = `---\ncreated: ${rows.at(-1)?.created_at.slice(0, 10) ?? new Date().toISOString().slice(0, 10)}\ntags: [neo3, ideas]\n---\n# Improvement ideas — ${path.basename(projectPath).replace(/[\r\n]/g, ' ')}\n\nПредложения, а не завершённая работа. Проект: ${projectPath.replace(/[\r\n]/g, ' ')}\n\n`;
  const content = rows.map(row => `## Идея ${row.id}\n\n${row.text}\n\n- Статус: ${statuses[row.status]}\n- Дата: ${row.created_at}\n- Исходный чат: /session/${encodeURIComponent(row.session_id)}\n`).join('\n');
  const block = `${START}\n${content}\n${END}`;
  let output: string;
  if (previous === null) output = `${heading}${block}\n\nСвязи: [[agents-web-ui]]\n`;
  else {
    if (previous.split(START).length !== 2 || previous.split(END).length !== 2 || previous.indexOf(END) < previous.indexOf(START)) throw Error('Unowned vault file');
    output = previous.slice(0, previous.indexOf(START)) + block + previous.slice(previous.indexOf(END) + END.length);
  }
  const temporary = path.join(directory, `.neo3-ideas-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, output, { flag: 'wx', mode: 0o600 });
    if (previous === null) {
      // Exclusive link refuses a file that appeared after the initial read.
      await fs.link(temporary, target);
    } else {
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || await fs.readFile(target, 'utf8') !== previous) throw Error('Vault file changed; retry');
      await fs.rename(temporary, target);
    }
  } finally { await fs.unlink(temporary).catch(() => {}); }
  return relative;
}
