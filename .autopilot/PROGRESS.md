# Прогресс

Текущий прогон: 2026-11-02-improvement-ideas--wip. Мод идей: 75ea7f9a; HTML preview: e142b871 + security repair dffd551f. Исправление Markdown href %20: e8341086. Применение координируется общим выпуском (docs/coordinated-release-2026-11-02.md); не запускать второй рестарт.

## Договорились
Сохранить привычный «Планирование + обход», не заставлять переходить на Autopilot, не менять model/effort defaults. Идеи хранить в Obsidian и давать кнопку реализации.

## Не доделано
Применение мода идей и HTML preview в Neo3, production E2E в рамках согласованного общего выпуска, после завершения соседних работ. Browser QA недоступен: Edge ENOENT. HTML: полный suite 1598/1598 до repair, targeted 8/8 после; typecheck/lint и clean clone build PASS. Независимый HTTP с реальным resolver PASS. HTML показывает сохранённую страницу; root-relative assets требуют сервера приложения. Обычные исходники остаются кодом; Markdown читаемым.

## Известные баги
Предыдущий дубль ответа Tyres ещё не исправлялся: в сохранённом JSONL итог один, причина двойного UI отображения не воспроизведена. Это отдельная идея в Obsidian.

## Правки без автопилота
Не затрагивать чужой текущий Codex compatibility audit.
