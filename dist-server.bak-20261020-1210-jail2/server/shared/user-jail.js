/**
 * Project jail for non-admin users (Славик, team, …).
 *
 * Every engine process (Claude, Codex, Grok) and every terminal a non-admin
 * starts runs as Dima's macOS user, so without a fence the agent could read
 * `.secrets.env`, other projects or run commands anywhere on the Mac. The jail
 * is a macOS Seatbelt profile applied with `/usr/bin/sandbox-exec`: the home
 * folder and external disks are closed, the project folder is open, plus the
 * engine's own service folders it cannot run without. Whatever the agent
 * spawns inherits the fence — Bash, scripts, MCP servers alike.
 *
 * Seatbelt cannot be nested: inside the jail an engine's own sandbox
 * (Codex workspace-write, Claude `sandbox`) fails, so jailed runs switch those
 * off and rely on this one.
 *
 * Admins are never jailed. Linux installs have no sandbox-exec: there the
 * project grants still filter what a teammate sees, but the engine is not
 * fenced. `NEO3_USER_JAIL=off` switches the jail off (emergencies only).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { userDb } from '../modules/database/index.js';
export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
/** Engines whose processes are wrapped. Other engines are closed to non-admins. */
export const JAILED_PROVIDERS = new Set(['claude', 'codex', 'grok']);
/** Is this user id an active admin? Role comes from the database only. */
function isAdminId(userId) {
    const id = Number(userId);
    if (!Number.isSafeInteger(id) || id <= 0)
        return false;
    return userDb.getUserById(id)?.role === 'admin';
}
/** Off switch for emergencies (`NEO3_USER_JAIL=off`); default is on. */
function jailDisabledByEnv() {
    return String(process.env.NEO3_USER_JAIL ?? '').toLowerCase() === 'off';
}
export function jailSupported() {
    return process.platform === 'darwin' && fs.existsSync(SANDBOX_EXEC);
}
/** Neo3's own install folder (the nearest package.json above this file). */
function findAppRoot() {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 6; i += 1) {
        if (fs.existsSync(path.join(dir, 'package.json')))
            return dir;
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return null;
}
const APP_ROOT = findAppRoot();
/**
 * Parts of Neo3 the jailed engine must read: the bundled Codex binary
 * (node_modules), the threads MCP server (dist-server) and the neo3-guards
 * mod (claude-plugins) and the secret-guard hook (scripts/hooks). Never the
 * whole folder — it holds `.env`.
 */
const APP_READ_DIRS = ['node_modules', 'dist-server', 'claude-plugins', 'scripts/hooks'];
function realDir(dir) {
    try {
        const resolved = fs.realpathSync(dir);
        return fs.statSync(resolved).isDirectory() ? resolved : null;
    }
    catch {
        return null;
    }
}
/**
 * Jail for a run started by `userId` in `projectPath`.
 * - admin (or jail switched off / unsupported platform) → `null`, no fence;
 * - non-admin with a real project folder → the jail;
 * - non-admin without a project folder → `'deny'`, the run must not start.
 */
export function userJailFor(userId, projectPath) {
    if (isAdminId(userId) || jailDisabledByEnv())
        return null;
    if (!jailSupported()) {
        // Linux client installs have no sandbox-exec; access to projects is still
        // filtered, but the engine itself is not fenced there.
        return null;
    }
    const root = projectPath ? realDir(projectPath) : null;
    if (!root || root === '/' || root === realDir(os.homedir()))
        return 'deny';
    return { root };
}
/** Text shown to a non-admin whose run cannot be fenced. */
export const JAIL_DENIED_MESSAGE = 'Запуск отклонён: у этого чата нет папки проекта, а работать вне своей папки нельзя. '
    + 'Если нужен доступ шире — передай запрос Диме.';
/** Text for engines that cannot be fenced (Cursor, Kimi, OpenCode, Gemini…). */
export const JAIL_PROVIDER_MESSAGE = 'Этот движок недоступен в командном доступе: используй Claude, Codex или Grok.';
/**
 * Instruction appended to the agent's system prompt, so it stops and tells the
 * person instead of trying to work around the fence.
 */
export function jailInstruction(jail) {
    return [
        `Ты работаешь в командном доступе: разрешена только папка проекта ${jail.root}`
            + (jail.readOnly ? ' (только чтение)' : '') + '.',
        'Файлы и команды за её пределами (родительские папки, другие проекты, домашняя папка, ключи, системные настройки) заблокированы системой — это не ошибка, обходить блокировку нельзя.',
        'Если задача требует чего-то вне папки проекта, не пытайся обойти: прямо скажи пользователю, что нужен доступ шире, и предложи переслать готовый запрос Диме — он выполнит его от своего пользователя.',
    ].join('\n');
}
/** Claude stores a project's transcripts under ~/.claude/projects/<cwd with non-alphanumerics → '-'>. */
function claudeProjectsKey(dir) {
    return dir.replace(/[^a-zA-Z0-9]/g, '-');
}
function sbString(value) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
function sbRegexLiteral(value) {
    return value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
/**
 * Seatbelt profile for one jail. Later rules win, so the order is:
 * close home + disks → reopen what engines need → close their private
 * history again → open the project.
 */
export function buildJailProfile(jail, home = os.homedir(), appRoot = APP_ROOT) {
    const h = (rel) => sbString(path.join(home, rel));
    const rw = '(allow file-read* file-write*';
    const lines = [
        '(version 1)',
        '(allow default)',
        // Home and external disks: nothing readable or writable by default.
        `(deny file-read* file-write* (subpath ${sbString(home)}) (subpath "/Volumes"))`,
        // stat() along the path is fine (realpath, cwd); listing or reading is not.
        '(allow file-read-metadata)',
        // Engines and their toolchains.
        `${rw} (subpath ${h('.claude')}) (regex #"^${sbRegexLiteral(path.join(home, '.claude.json'))}")`,
        `  (subpath ${h('.codex')}) (subpath ${h('.grok')})`,
        `  (subpath ${h('.local')}) (subpath ${h('.npm')}) (subpath ${h('.cache')})`,
        `  (subpath ${h('Library/Caches')}) (subpath ${h('Library/Keychains')}))`,
        `(allow file-read* (literal ${h('.gitconfig')}) (literal ${h('.npmrc')})`,
        `  (literal ${h('.zshrc')}) (literal ${h('.zprofile')}) (literal ${h('.zshenv')}) (literal ${h('.profile')})`,
        `  (subpath ${h('Library/Preferences')}))`,
        ...(appRoot
            ? [`(allow file-read* ${APP_READ_DIRS.map((dir) => `(subpath ${sbString(path.join(appRoot, dir))})`).join(' ')})`]
            : []),
        // Dima's own history inside the engine folders stays closed.
        `(deny file-read* file-write* (subpath ${h('.claude/projects')}) (subpath ${h('.claude/backups')})`,
        `  (subpath ${h('.claude/paste-cache')}) (subpath ${h('.claude/plans')}) (subpath ${h('.claude/night-shift')})`,
        `  (literal ${h('.claude/token-usage-log.md')}))`,
        `(deny file-read* (literal ${h('.claude/history.jsonl')}) (subpath ${h('.claude/file-history')}))`,
        `${rw} (regex #"^${sbRegexLiteral(path.join(home, '.claude/projects', claudeProjectsKey(jail.root)))}"))`,
        // The project itself.
        jail.readOnly
            ? `(allow file-read* (subpath ${sbString(jail.root)}))`
            : `${rw} (subpath ${sbString(jail.root)}))`,
    ];
    const readFiles = (jail.readFiles ?? []).filter((file) => path.isAbsolute(file));
    if (readFiles.length > 0) {
        lines.push(`(allow file-read* ${readFiles.map((file) => `(literal ${sbString(file)})`).join(' ')})`);
    }
    return lines.join('\n');
}
/** argv that starts `command args…` inside the jail. */
export function jailCommand(jail, command, args) {
    return { command: SANDBOX_EXEC, args: ['-p', buildJailProfile(jail), command, ...args] };
}
/**
 * Codex is started by its SDK from a binary path, so the jail is a tiny
 * wrapper script: profile and real binary travel in the child env.
 */
export function codexJailWrapperPath() {
    const dir = path.join(os.homedir(), '.cloudcli', 'jail');
    const file = path.join(dir, 'codex-jailed.sh');
    const body = '#!/bin/sh\n'
        + '# Written by Neo3 (server/shared/user-jail.ts): runs Codex inside the project jail.\n'
        + 'profile="$NEO3_JAIL_PROFILE"; real="$NEO3_JAIL_REAL"\n'
        // The SDK starts Codex in the server's folder, which the jail closes.
        + 'cd "$NEO3_JAIL_ROOT" || exit 1\n'
        + 'unset NEO3_JAIL_PROFILE NEO3_JAIL_REAL NEO3_JAIL_ROOT\n'
        + `exec ${SANDBOX_EXEC} -p "$profile" "$real" "$@"\n`;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    let current = '';
    try {
        current = fs.readFileSync(file, 'utf8');
    }
    catch { /* first run */ }
    if (current !== body) {
        fs.writeFileSync(file, body, { mode: 0o700 });
    }
    return file;
}
//# sourceMappingURL=user-jail.js.map