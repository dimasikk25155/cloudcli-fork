# F2 — Проверка внешнего корня превью

**Требования:** G07, G10
**Зависит от:** 02
**Зона:** `server/modules/file-preview/file-preview.service.ts` · `server/modules/file-preview/tests/file-preview.test.ts`
**Волна:** 4
**Ревью:** да — ремонт ветки
**Модель:** сильная

## Критерии приёмки
- [ ] FIX NOW: Security · file-preview.service.ts:22–24 · Для admin outside-project имя секретной папки исчезает из проверки: при /tmp/secrets/index.html корнем становится /tmp/secrets, а safeRelative получает только index.html. Публичный grant разрешает чтение разрешённых расширений из этой папки. Условие: до выдачи grant проверять секретные компоненты самого внешнего корня; добавить отказ для secrets/index.html и credentials/index.html вне проекта.

## Разделы спецификации
spec.md § Просмотр файлов; interfaces.md § Просмотр HTML.

## Из брифа
> «когда я жму на html я хочу увидеть сайт а не код»

## Ограничения
Только два файла зоны, не трогать другие правки. Test temporary HOME/DB, no production/restart/deps. Cause and failing regression first; parent commits.
