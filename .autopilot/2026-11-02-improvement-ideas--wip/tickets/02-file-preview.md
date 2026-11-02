# 02 — HTML открывается страницей

**Требования:** G07, G08, G09, G10
**Зависит от:** —
**Зона:** `src/components/code-editor/` · `src/utils/api.ts` · `src/utils/api/` · `server/modules/file-preview/` · `server/index.js`
**Волна:** 3
**Ревью:** нет
**Модель:** сильная

## Что должно заработать
Клик по HTML из ответа открывает страницу, с CSS/JS/картинками. Код и отдельная вкладка доступны понятными кнопками. Другие типы сохраняют подходящий просмотр.

## Из брифа, дословно
> «когда я жму на html я хочу увидеть сайт а не код»
> «кликом в веб интерфейсе нажжать на твой ответ на гиперссылку»
> «если он не .md то в идеале открыть его в браузере html страницой»
> «хочу видеть все своими глазами либо в превью по ссылке или уже на мейн»

## Разделы спецификации
spec.md § Просмотр файлов; interfaces.md § Просмотр HTML; notes-file-preview.md.

## Критерии приёмки
- [ ] HTML/HTM default rendered; changing files resets mode; diff remains code; Markdown rendered unchanged.
- [ ] Relative CSS/image/JS resolve within allowed root including spaces/Cyrillic paths. New-tab preview uses same protected resource hierarchy. Address root-relative references deliberately.
- [ ] Code/Preview and new-tab controls discoverable; loading/errors visible with retry; code/download still accessible.
- [ ] HTML cannot access Neo3 auth origin; no generic auth tokens exposed; access/traversal/symlink/secrets/expiry rejection covered by behavior tests.
- [ ] Targeted tests, typecheck, lint and isolated build pass; reproduce before implementing. No production restart/build/output.

## Ограничения
You are not alone in codebase; do not revert others. Do not commit, parent will commit exact files. Existing dirty files outside zone untouched. server/index.js minimal route mount only. If API lives elsewhere request zone extension. No dependency installation. Browser QA unavailable: approved Edge ENOENT, do not launch another browser. Native HTTP integration required.
