# 03 — Ссылки с пробелами открывают файл
**Требования:** G08, G11
**Зависит от:** 02
**Зона:** `src/components/chat/utils/filePathDetection.ts` · `src/components/chat/utils/filePathDetection.test.ts` · `src/components/chat/view/subcomponents/Markdown.tsx` · `src/components/chat/view/subcomponents/Markdown.test.tsx`
**Волна:** 5
**Ревью:** нет
**Модель:** сильная
## Из брифа
> «путь же битый всю дорогу ты мне показываешь, антигравити без % папка называется»
## Критерии приёмки
- [ ] Actual Markdown parse/render/click reproduces %20 before patch and dispatches real spaced path after.
- [ ] Unicode, line suffix, literal %20/%25 filename, malformed escape, raw inline code path and external URL regression cases.
- [ ] Scoped tests/typecheck/lint pass; no global server double decoding; no deployment/restart.
## Спецификация
spec.md § Кодирование ссылок; interfaces.md project constraints.
