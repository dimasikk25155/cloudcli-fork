# Границы и правила

## Существующие решения
См. notes.md. Общий run registry -> сбор кандидатов, complete -> persistent capture, самостоятельный мод improvement-ideas -> repository, routes, vault writer. Не вызывать локальную модель.

## Контракт
GET /api/improvement-ideas?sessionId=... -> {ideas:[{id,sessionId,projectName,text,status,createdAt,vaultPath?,vaultError?}]}.
POST /api/improvement-ideas/:id/decision {action: implement | later}; POST /:id/sync. Только authenticated admin, общий canUserAccessSession, мод включён; id и текст серверные. Повторный implement не порождает второй запуск. busy сохраняет прежнее состояние. После рестарта starting не ретраится автоматически. Состояние started не означает done.
createIdeaRunControl(dependencies) -> run control для сервиса; сохраняет model/effort/workMode/permissionMode через lastRunOptions, fallback normal permissions. Plan-only -> понятный отказ, не молча расширять права. Prompt сохраняет бюджет/время/границы оригинальной задачи и одобряет ровно текст идеи.
Shared DTO можно поместить в shared/improvement-ideas.ts. Новый ключ modImprovementIdeas в shared/mods.ts.

## UI
Слот relayBand ChatInterface.tsx. Самостоятельный компонент, auth admin + mod hook. Карточка без изменения общих стилей: текст, статус, Реализовать/Позже, раскрываемый список отложенных, ошибка/повтор экспорта. Использовать существующие токены и компоненты. Чтение по complete/reconnect и короткий poll только пока карточки смонтированы.

## Хранилище Obsidian
Один фиксированный реестр проекта wiki/ideas/neo3-<server-derived-project-hash>.md. Обновлять только собственный маркированный блок; сохранить человеческие дополнения. Стабильная запись после рестарта и повторного захвата; существующий чужой файл или symlink не перезаписывать. Путь vault берётся из существующего vaultDir. Доступный поиску текст: проект, исходная сессия, дата, идея, статус. Ошибки экспорта не теряют идею в БД. Секреты reject до DB/vault; не писать исходное содержимое в лог.

## Правила проекта
Никаких новых пакетов, установки, production DB, dist/dist-server, restart/deploy, stash/reset/clean. Не трогать пользовательские незакоммиченные правки, не создавать новые глобальные инструкции. Рабочая ветка audit/codex-compat-20261102 принадлежит параллельной работе. Коммиты только своих путей и только после проверки; при смешанных правках передать список, не захватывать чужое.

## Проверки
npm run typecheck (client+server, no emit). Тесты только с временными HOME и DATABASE_PATH; запуск через node_modules/.bin/tsx --tsconfig server/tsconfig.json --test <paths>. Не переопределять HOME переменной shell: env HOME=<temp> DATABASE_PATH=<temp>/auth.db command. eslint только изменённых исходников. Изолированная Vite сборка в mktemp, не обычный npm run build. Полный npm test сам изолирует HOME/DB; TMPDIR должен быть realpath(os.tmpdir()).
