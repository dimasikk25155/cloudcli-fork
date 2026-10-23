import { readGitSummary } from '../../modules/code-status/code-status.git.js';
import { defaultRegistryFile, defaultSecretsFile, readSiteStatus } from '../../modules/code-status/code-status.site.js';
/** Сколько живёт ответ без кнопки «обновить». */
export const CODE_STATUS_CACHE_MS = 60_000;
/** «Обновить» не чаще раза в столько на проект: частые тапы получают последний расчёт. */
export const CODE_STATUS_REFRESH_MIN_MS = 5_000;
/**
 * «Где мой код»: git-сводка проекта (всем, у кого есть доступ) и сайт (только
 * админу — проверка идёт токеном Димы). Ответ кэшируется на 60 с отдельно для
 * админа и не-админа; одновременные запросы делят один расчёт.
 */
export function createCodeStatusService(dependencies = {}) {
    const fetchImpl = dependencies.fetchImpl ?? ((url, init) => fetch(url, init));
    const cacheMs = dependencies.cacheMs ?? CODE_STATUS_CACHE_MS;
    const now = dependencies.now ?? Date.now;
    const cache = new Map();
    async function compute(projectPath, isAdmin) {
        const summary = await readGitSummary(projectPath);
        const site = isAdmin
            ? await readSiteStatus(projectPath, summary?.refs ?? null, summary?.git.branch ?? null, {
                fetchImpl,
                secretsFile: dependencies.secretsFile ?? defaultSecretsFile(),
                registryFile: dependencies.registryFile ?? defaultRegistryFile(),
            })
            : null;
        return { git: summary?.git ?? null, site, checkedAt: new Date(now()).toISOString() };
    }
    return {
        getCodeStatus(projectPath, options) {
            const isAdmin = options.isAdmin === true;
            const key = `${isAdmin ? 'admin' : 'user'}:${projectPath}`;
            const cached = cache.get(key);
            if (cached) {
                const age = now() - cached.at;
                // Идущий расчёт и только что сделанный делят все запросы, включая «обновить».
                const reuse = options.refresh
                    ? cached.running || age < CODE_STATUS_REFRESH_MIN_MS
                    : cached.running || age < cacheMs;
                if (reuse)
                    return cached.value;
            }
            const value = compute(projectPath, isAdmin);
            const entry = { at: now(), value, running: true };
            cache.set(key, entry);
            value.then(() => {
                entry.running = false;
            }, () => {
                // Упавший расчёт не держим в кэше.
                entry.running = false;
                if (cache.get(key) === entry)
                    cache.delete(key);
            });
            return value;
        },
    };
}
export const codeStatus = createCodeStatusService();
export function getCodeStatus(projectPath, options) {
    return codeStatus.getCodeStatus(projectPath, options);
}
//# sourceMappingURL=code-status.service.js.map