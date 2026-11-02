# F3 — Поздний итог относится к своему запуску
**Требования:** G12
**Зависит от:** 04
**Зона:** `server/modules/providers/list/codex/codex-subagents.ts` · `server/modules/providers/tests/codex-subagents.test.ts`
**Волна:** 7
**Ревью:** да — ремонт ветки
**Модель:** сильная
## Критерии приёмки
- [ ] FIX NOW: Spec G12 · codex-subagents.ts:77–79,127–130 · запоздалый итог предыдущего цикла закрывает новый followup. Воспроизведено: spawn → structured completed → followup → первый FINAL_ANSWER старой задачи выдаёт follow_subagent_return, completed, OLD result. Старый итог должен дополнять исходную карточку; followup остаётся активным до собственного завершения. Добавить regression на эту последовательность; нынешний тест проверяет только повтор уже обработанного recordId.
## Спецификация
spec.md § Помощники Codex. No source outside zone, no deploy/deps/DB writes, no commits worker.
