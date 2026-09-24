# Проверка исходного CloudCLI без применения

`node scripts/check-upstream-updates.js` читает только публичные API официального
`siteboon/claudecodeui` и локальную Git-историю. Авторизация GitHub не используется.
Единый сервис вызывают скрипт и защищённые admin API:

- `GET /api/system/upstream` — сохранённый отчёт, без сетевой проверки;
- `POST /api/system/upstream/check` — проверка, без установки;
- `POST /api/system/update` — **409 UPSTREAM_APPROVAL_REQUIRED** во всех режимах,
  в том числе platform/npm/git. Поле `approved: true` не включает установку.

Отчёт: `~/.cloudcli/upstream-update-report.json` (атомарная запись, mode 0600).
В нём отдельно текущий fork SHA/версия/dirty, стабильный release с точным commit SHA,
свежий main SHA, время, кандидаты, пересечения путей и необходимость согласования.
Версия package.json не определяет отсутствие функции. При наличии Git-объектов
`merge-base`, `rev-list` и `git cherry` различают историю и эквивалентные патчи;
ручные переносы требуют проверки. Если свежего SHA нет локально — явно unknown,
сравнение ограничено release→main. Скрипт даже не делает `git fetch`.

GitHub responses ограничены 4 MiB, одна проверка сети — 60 секунд, команды Git —
8 секунд каждая. API latest release исключает prerelease/draft. Redirect запрещён.
Скрипт не читает ключи и не исполняет текст GitHub. При ошибке сохраняется последний
успешный отчёт с `status:error`, `stale:true` и временем попытки; exit code скрипта 1.
Данные старше 36 часов помечаются устаревшими при чтении. Повторные вызовы безопасны:
в одном процессе общий Promise, между процессами исключающий `.json.lock`.
Оставшийся после аварийного завершения lock не удаляется автоматически: проверьте PID
из `~/.cloudcli/upstream-update-report.json.lock`, отсутствие работающей проверки,
затем удалите **только этот lock**, не отчёт. Одновременная проверка возвращает 202.

## Ежедневный запуск на Mac

Шаблон: `scripts/com.dimasik.neo3-upstream-check.plist`, 09:15 локального времени,
`RunAtLoad=true`. Это отдельное задание; существующее обновление CLI движков не меняется.
Шаблон содержит текущие абсолютные пути Mac; при переносе их нужно скорректировать.
До review оркестратора шаблон **не установлен**. Команды финального применения:

```sh
mkdir -p "$HOME/.cloudcli" "$HOME/Library/LaunchAgents"
plutil -lint scripts/com.dimasik.neo3-upstream-check.plist
cp scripts/com.dimasik.neo3-upstream-check.plist "$HOME/Library/LaunchAgents/"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.dimasik.neo3-upstream-check.plist"
launchctl print "gui/$(id -u)/com.dimasik.neo3-upstream-check"
```

`RunAtLoad` выполняет первую реальную проверку. Подтверждать её нужно свежим
`checkedAt`/`status:ok` в отчёте и `upstream-check.log`, а не только loaded state.
Будущую ежедневную периодичность первый запуск не доказывает. Если label уже существует,
не дублировать bootstrap: сначала проверить текущую конфигурацию.

## Что согласовывается дальше

Конкретный набор кандидатов и SHA main из отчёта. После согласования человека агент
готовит отдельный worktree, сохраняет незавершённую работу, делает выборочный перенос,
проверяет конфликты и текущие модели/effort/context, запускает тесты и изолированные
сборки, готовит точку отката. Выкатка — отдельное согласованное действие. Checker
не выполняет ни один из этих этапов, не merge/pull/install/build/restart.

Полный upstream merge особенно опасен из-за разных путей `src/modules`/`src/components`
и возвращения TaskMaster. Полезность кандидатов проверяется отдельно; опубликованный
релиз 1.37.3 уже частично перенесён вручную в форк с package version 1.37.0.
