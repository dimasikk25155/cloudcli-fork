/**
 * «Дуэт» — напарник Димы по ботам и сервисам (свой аналог Claude Duet).
 * Типы общего состояния: файл `~/.cloudcli/duet/state.json` и ответ `/api/duet/state`.
 */
export const DEFAULT_SETTINGS = {
    briefTime: '08:30',
    checkEveryMin: 15,
    ideasEveryDays: 7,
    muted: [],
    projects: {},
};
export function emptyState() {
    return {
        version: 1,
        settings: { ...DEFAULT_SETTINGS, muted: [], projects: {} },
        snapshot: null,
        lastBriefAt: null,
        lastIncidentBriefAt: null,
        lastIdeasAt: null,
        briefs: [],
        events: [],
        decisions: [],
        ideas: [],
    };
}
//# sourceMappingURL=duet.types.js.map