# Предложение дополнить `claude agent/CLAUDE.md`

Файл твой, я в него не писал. Ниже — раздел, который стоит добавить после «Дуэт», и две поправки.

## Поправки
1. Таблица «В Grok»: строка «Стоп» фоновой задачи — теперь **да** (и у Codex): `stopCodexTask`/`stopGrokTask` в `stopTaskFns`, процесс ищется в дереве движка (`server/shared/process-tree.ts`); не найден — «Стоп» не рисуется.
2. `MOD_KEYS` — теперь 22 (было 15): + `modWorkbench`, `modSessionHub`, `modSideChat`, `modGroups`, `modThinkingTime`, `modKeepAwake`, `modDiagnostics`; у записи `MODS` поле `engines` — строка поддержки движков на карточке.

## Новый раздел

```markdown
## Рабочий стол по роликам Claude Code 2.0 и Jev (04.11, ветка `feat/neo3-workbench-build`)

- Тема `claudeLight` («Светлая Claude»): блок в `src/index.css`, палитра xterm `terminalThemeFor(isDarkMode)`, тема до первой отрисовки — inline-скрипт `index.html` (`appTheme`, `appThemeColor`), Electron — IPC `neo3:theme-changed` (`electron/windowTheme.js`).
- Рабочий стол: `src/components/workbench/` — реестр вкладок `registerWorkbenchTabKind`/`openWorkbenchTab`/`useWorkbench`; холст рисует только активную вкладку — состояние вида хранить вне компонента; перед `openWorkbenchTab` проверять `modWorkbench`. Раскладка — ui-preferences `workbenchLayout`.
- Лимиты: `normalizeProviderLimits` (`src/utils/providerLimits.ts`), Grok — `known:false`.
- Артефакты: `server/modules/artifacts/` (`workspace_records` + снимки `~/.cloudcli/artifacts/<id>/`), запрет приватных путей по настоящему пути; агент — `workspace_action artifact.publish|list`.
- Побочный чат: связь `btw` в `shared/session-links.ts`, `POST /api/sessions/:id/btw`, скрытый `<btw_context>`; запуск — `btwService.setRunControl(createAutoRelayRunControl(...))` в `server/index.js`.
- Мастер-сессия: `server/modules/master-session/` (`/questions`, `/drafts`, `/send` с `batchId`), run-control — `setMasterSessionRunControl(createThreadRunControl(...))`.
- Группы/закрепы: таблицы `sidebar_groups`, `sidebar_group_items`, `session_pins`, кадр `sidebar_groups_changed`; профиль настроек — `server/modules/settings-profile/` (снимок перед применением), агент — `settings.propose`.
- «Думал N с · ответ за N с»: `run_durations.thinking_ms`, кадр `complete.thinkingDurationMs`; у Codex `codex exec` не присылает reasoning — только «ответ за».
- /doctor, /skill-doctor (админ), /advisor (Opus readOnly), keep-awake `caffeinate -i -w <pid>` — `server/modules/diagnostics/`, `keep-awake/`; команды через `builtInCommandsFor`/`executeBuiltInCommand` (`server/routes/commands.js`).
- Покрытие роликов и матрица движков — `docs/video-mods-coverage.md`; терминальный Claude Code — `docs/claude-code-terminal-pack.md`, `docs/claude-code-plan.md`.
- Подводные камни: в Claude CLI 2.1.317 в журнале сессии есть записи `api-request-blob` — пропускаются при чтении истории; MCP для инспектора — только `?fields=names` (полный адрес отдаёт значения env).
```
