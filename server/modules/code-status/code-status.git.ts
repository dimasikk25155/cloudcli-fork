import { execFile } from 'node:child_process';

import type { CodeStatusGit } from '@/modules/code-status/code-status.types.js';

/** Сколько строк в каждом списке «что не дошло» отдаём клиенту. */
export const LIST_LIMIT = 20;

/** Внутренние сведения для сверки с сайтом; клиенту не уходят. */
export type GitRefs = {
  head: string | null;
  mainTip: string | null;
  /** Время последнего коммита main (мс), для сверки сборки без SHA. */
  mainTipTime: number | null;
};

export type GitSummary = { git: CodeStatusGit; refs: GitRefs };

/** `code`: код выхода git (0 — успех); null — git не запустился или убит по таймауту. */
type GitResult = { ok: boolean; code: number | null; stdout: string };

/**
 * Один вызов git без сети и без блокировок индекса. Ненулевой код выхода —
 * нормальный ответ («такой ветки нет»), поэтому это `ok:false`, а не исключение.
 */
function runGit(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: 10_000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
      },
      (error, stdout) => {
        const code = !error ? 0 : typeof error.code === 'number' ? error.code : null;
        resolve({ ok: !error, code, stdout: String(stdout ?? '') });
      },
    );
  });
}

async function gitLine(cwd: string, args: string[]): Promise<string | null> {
  const result = await runGit(cwd, args);
  const line = result.stdout.trim();
  return result.ok && line ? line : null;
}

function toCount(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function toLines(value: string | null): string[] {
  return (value ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
}

/** Пути из `git status --porcelain=v1 -z`; у переименования второй путь (старый) пропускаем. */
function parsePorcelain(output: string): string[] {
  const tokens = output.split('\0');
  const files: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const entry = tokens[index];
    if (entry.length < 4) continue;
    files.push(entry.slice(3));
    const code = entry[0];
    if (code === 'R' || code === 'C') index += 1;
  }
  return files;
}

/** main → master → цель origin/HEAD; иначе основной ветки нет. */
async function detectMainBranch(cwd: string): Promise<string | null> {
  for (const name of ['main', 'master']) {
    if (await gitLine(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}^{commit}`])) {
      return name;
    }
  }
  return gitLine(cwd, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
}

/** Git-сводка папки проекта или null, если это не git. Только локальные данные, без fetch. */
export async function readGitSummary(projectPath: string): Promise<GitSummary | null> {
  if ((await gitLine(projectPath, ['rev-parse', '--is-inside-work-tree'])) !== 'true') {
    return null;
  }

  const [symbolicBranch, head, mainBranch, statusResult, remotes] = await Promise.all([
    gitLine(projectPath, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    gitLine(projectPath, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']),
    detectMainBranch(projectPath),
    runGit(projectPath, ['status', '--porcelain=v1', '-z']),
    gitLine(projectPath, ['remote']),
  ]);

  const branch = symbolicBranch ?? (head ? head.slice(0, 7) : 'HEAD');
  const files = statusResult.ok ? parsePorcelain(statusResult.stdout) : [];
  const hasRemote = Boolean(remotes);

  let notInMain = 0;
  let notInMainList: string[] = [];
  let mainTip: string | null = null;
  let mainTipTime: number | null = null;
  if (mainBranch) {
    mainTip = await gitLine(projectPath, ['rev-parse', '--verify', '--quiet', `${mainBranch}^{commit}`]);
  }
  if (mainBranch && mainTip) {
    const [count, list, time] = await Promise.all([
      head ? gitLine(projectPath, ['rev-list', '--count', `${mainTip}..${head}`]) : Promise.resolve(null),
      head ? gitLine(projectPath, ['log', `-n${LIST_LIMIT}`, '--format=%h %s', `${mainTip}..${head}`]) : Promise.resolve(null),
      gitLine(projectPath, ['log', '-1', '--format=%ct', mainTip]),
    ]);
    notInMain = toCount(count);
    notInMainList = toLines(list);
    const seconds = Number.parseInt(time ?? '', 10);
    mainTipTime = Number.isFinite(seconds) ? seconds * 1000 : null;
  }

  let unpushed = 0;
  let unpushedList: string[] = [];
  if (hasRemote && head) {
    const [count, list] = await Promise.all([
      gitLine(projectPath, ['rev-list', '--count', head, '--not', '--remotes']),
      gitLine(projectPath, ['log', `-n${LIST_LIMIT}`, '--format=%h %s', head, '--not', '--remotes']),
    ]);
    unpushed = toCount(count);
    unpushedList = toLines(list);
  }

  return {
    git: {
      branch,
      mainBranch: mainTip ? mainBranch : null,
      uncommitted: files.length,
      notInMain,
      unpushed,
      hasRemote,
      lists: {
        files: files.slice(0, LIST_LIMIT),
        notInMain: notInMainList,
        unpushed: unpushedList,
      },
    },
    refs: { head, mainTip, mainTipTime },
  };
}

/**
 * Входит ли коммит `ancestor` в историю `descendant`.
 * `missing` — одного из коммитов нет в локальном репо (код 128), ответа нет.
 */
export async function isAncestor(
  projectPath: string,
  ancestor: string,
  descendant: string,
): Promise<'yes' | 'no' | 'missing'> {
  const result = await runGit(projectPath, ['merge-base', '--is-ancestor', ancestor, descendant]);
  if (result.code === 0) return 'yes';
  if (result.code === 1) return 'no';
  return 'missing';
}
