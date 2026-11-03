# 04 — Результат помощника доходит до карточки
**Требования:** G12
**Зависит от:** —
**Зона:** `server/modules/providers/list/codex/codex-subagents.ts` · `server/modules/providers/tests/codex-subagents.test.ts` · `src/components/crabs/` · `src/components/chat/hooks/useChatMessages.ts` · `server/modules/providers/list/codex/codex-sessions.provider.ts` · `server/openai-codex.js`
**Волна:** 6
**Ревью:** нет
**Модель:** сильная
## Из брифа
> «постарайся сделать что сможешь»
> «почему у тебя так а у клоуда всегда возвращались? ничего сука не терялось!!!!!»
## Спецификация
spec.md § Помощники Codex; interfaces.md правила проекта.
## Критерии
- [ ] Реальный payload воспроизводит lost до исправления; after normalizer/history+UI result завершён с правильным текстом.
- [ ] Completion only on terminal evidence, duplicate events idempotent, unknown child cannot complete another, errors distinct, followup cycles correct.
- [ ] Reload produces same state/result as live; native Codex and Claude/Grok regressions green.
- [ ] Typecheck, scoped lint/tests, isolated build if UI changed. No production mutation/restart/deps.
## Ownership
Dirty server/openai-codex.js and codex-sessions.provider.ts belong parallel audit: minimal edits preserving everything; parent commits only own hunks or reports remaining. Prefer extending clean codex-subagents.ts and narrow necessary hooks. No reverts, no commits by worker.
