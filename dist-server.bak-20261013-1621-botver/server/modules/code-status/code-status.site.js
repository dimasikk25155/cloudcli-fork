import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isAncestor } from '../../modules/code-status/code-status.git.js';
const VERCEL_API = 'https://api.vercel.com';
const REQUEST_TIMEOUT_MS = 8_000;
/** Сколько последних превью смотрим, чтобы найти сборку текущей ветки. */
const PREVIEW_SCAN = 20;
export function defaultSecretsFile() {
    return process.env.NEO3_SECRETS_FILE || path.join(os.homedir(), 'Antigravity Project', '.secrets.env');
}
export function defaultRegistryFile() {
    return process.env.NEO3_SITES_REGISTRY || path.join(os.homedir(), '.claude', 'skills', 'deploy-verify', 'sites.yaml');
}
async function readTextOrNull(file) {
    try {
        return await fs.readFile(file, 'utf8');
    }
    catch (error) {
        if (error?.code === 'ENOENT')
            return null;
        throw error;
    }
}
/**
 * Токен Vercel: переменная процесса, иначе ОДНА строка `VERCEL_TOKEN=` из файла
 * секретов (по образцу vps-dns). Остальные ключи файла в процесс не попадают.
 * Значение нигде не логируется и клиенту не уходит.
 */
async function readVercelToken(secretsFile) {
    const fromEnv = process.env.VERCEL_TOKEN?.trim();
    if (fromEnv)
        return fromEnv;
    const raw = await readTextOrNull(secretsFile).catch(() => null);
    if (!raw)
        return null;
    const line = raw.split('\n').find((entry) => /^\s*(export\s+)?VERCEL_TOKEN=/.test(entry));
    if (!line)
        return null;
    const value = line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
    return value || null;
}
async function readVercelLink(projectPath) {
    const raw = await readTextOrNull(path.join(projectPath, '.vercel', 'project.json')).catch(() => null);
    if (!raw)
        return null;
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed.projectId !== 'string' || !parsed.projectId)
            return null;
        return { projectId: parsed.projectId, orgId: typeof parsed.orgId === 'string' ? parsed.orgId : null };
    }
    catch {
        // Битый project.json = проект не привязан к Vercel.
        return null;
    }
}
/** Значение поля из flow-мапы реестра: `key: "value"` или `key: value`. */
function flowField(line, key) {
    const match = new RegExp(`[{,]\\s*${key}\\s*:\\s*(?:"([^"]*)"|'([^']*)'|([^,}]*))`).exec(line);
    if (!match)
        return null;
    const value = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    return value || null;
}
/** Прод-адрес проекта из реестра deploy-verify (совпадение по имени папки), если он подтверждён. */
export async function registryUrlFor(registryFile, projectPath) {
    const raw = await readTextOrNull(registryFile).catch(() => null);
    if (!raw)
        return null;
    const folder = path.basename(path.resolve(projectPath));
    for (const line of raw.split('\n')) {
        if (!/^\s*-\s*\{/.test(line))
            continue;
        if (flowField(line, 'project') !== folder)
            continue;
        const url = flowField(line, 'url');
        if (url && /^https?:\/\//i.test(url))
            return url;
    }
    return null;
}
function deploymentSha(deployment) {
    const meta = deployment.meta ?? {};
    for (const key of ['githubCommitSha', 'gitlabCommitSha', 'bitbucketCommitSha']) {
        const value = meta[key];
        if (typeof value === 'string' && /^[0-9a-f]{7,40}$/i.test(value))
            return value.toLowerCase();
    }
    return null;
}
function deploymentRef(deployment) {
    const meta = deployment.meta ?? {};
    for (const key of ['githubCommitRef', 'gitlabCommitRef', 'bitbucketCommitRef']) {
        const value = meta[key];
        if (typeof value === 'string' && value)
            return value;
    }
    return null;
}
function deploymentTime(deployment) {
    for (const value of [deployment.ready, deployment.created, deployment.createdAt]) {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0)
            return value;
    }
    return null;
}
function deploymentUrl(deployment) {
    if (typeof deployment.url !== 'string' || !deployment.url)
        return null;
    return /^https?:\/\//i.test(deployment.url) ? deployment.url : `https://${deployment.url}`;
}
async function listDeployments(fetchImpl, token, link, target, limit) {
    const query = new URLSearchParams({
        projectId: link.projectId,
        target,
        state: 'READY',
        limit: String(limit),
    });
    if (link.orgId?.startsWith('team_'))
        query.set('teamId', link.orgId);
    const response = await fetchImpl(`${VERCEL_API}/v6/deployments?${query.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
        // Код ответа без тела: в теле Vercel может эхом вернуть что угодно.
        throw new Error(`Vercel API ответил ${response.status}`);
    }
    const body = (await response.json());
    return Array.isArray(body?.deployments) ? body.deployments : [];
}
/** Свежая ли прод-сборка: по SHA, если он есть, иначе по времени против последнего коммита main. */
async function compareWithMain(projectPath, refs, sha, deployedAt) {
    const target = refs?.mainTip ?? refs?.head ?? null;
    if (!target)
        return 'unknown';
    if (sha) {
        if (target.toLowerCase().startsWith(sha) || sha.startsWith(target.toLowerCase()))
            return 'fresh';
        if (refs?.head && refs.head.toLowerCase().startsWith(sha))
            return 'fresh';
        // Прод собран из более нового коммита, в котором main уже есть — свежий;
        // коммит есть, а main в него не входит — старый; коммита у нас нет — не узнать.
        const relation = await isAncestor(projectPath, target, sha);
        if (relation === 'yes')
            return 'fresh';
        if (relation === 'no')
            return 'stale';
        return 'unknown';
    }
    if (deployedAt == null || refs?.mainTipTime == null)
        return 'unknown';
    return deployedAt >= refs.mainTipTime ? 'fresh' : 'stale';
}
/**
 * Сведения о сайте для админа: Vercel (если проект привязан), иначе реестр
 * deploy-verify, иначе null. Сбой сети/Vercel — `state:'unknown'`, не исключение.
 */
export async function readSiteStatus(projectPath, refs, branch, deps) {
    const [link, registryUrl] = await Promise.all([
        readVercelLink(projectPath),
        registryUrlFor(deps.registryFile, projectPath),
    ]);
    if (link) {
        const token = await readVercelToken(deps.secretsFile);
        if (!token)
            return { kind: 'vercel', url: registryUrl, state: 'unknown', previewUrl: null };
        try {
            const [production, previews] = await Promise.all([
                listDeployments(deps.fetchImpl, token, link, 'production', 1),
                listDeployments(deps.fetchImpl, token, link, 'preview', PREVIEW_SCAN).catch(() => []),
            ]);
            const preview = previews.find((item) => branch && deploymentRef(item) === branch) ?? previews[0] ?? null;
            const previewUrl = preview ? deploymentUrl(preview) : null;
            const latest = production[0];
            if (!latest) {
                return { kind: 'vercel', url: registryUrl, state: 'unknown', previewUrl };
            }
            const sha = deploymentSha(latest);
            const time = deploymentTime(latest);
            const site = {
                kind: 'vercel',
                url: registryUrl ?? deploymentUrl(latest),
                state: await compareWithMain(projectPath, refs, sha, time),
                previewUrl,
            };
            if (time != null)
                site.deployedAt = new Date(time).toISOString();
            if (sha)
                site.sha = sha;
            return site;
        }
        catch {
            // Сеть, таймаут, отозванный токен: сайт «не узнать», git-часть живёт.
            return { kind: 'vercel', url: registryUrl, state: 'unknown', previewUrl: null };
        }
    }
    if (registryUrl) {
        try {
            const response = await deps.fetchImpl(registryUrl, {
                method: 'GET',
                redirect: 'follow',
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            // Тело страницы не нужно — отпускаем соединение.
            void response.body?.cancel?.().catch(() => undefined);
            return { kind: 'registry', url: registryUrl, state: response.status < 400 ? 'up' : 'down' };
        }
        catch {
            // Сайт не ответил вовсе (DNS, TLS, таймаут).
            return { kind: 'registry', url: registryUrl, state: 'down' };
        }
    }
    return null;
}
//# sourceMappingURL=code-status.site.js.map