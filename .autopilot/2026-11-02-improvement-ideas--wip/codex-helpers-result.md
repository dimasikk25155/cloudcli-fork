# Помощники Codex: результат 2026-11-02

## Изменение
Коммиты c9dbec18 и 3b79ed00. Загрузчик принимает typed agent_message и SubAgentActivity, связывает task_name/agent_path/thread/call с карточкой, различает progress/final, сохраняет итог в подробностях и восстанавливает его после reload. Native Codex формат также сохранён. Устойчивый id уведомления допускает обогащение пустого completion итоговым текстом без второй карточки. Followup получает отдельный цикл; поздний итог предыдущего completed без summary дополняет его.

## Доказательства
Настоящий parent JSONL содержит завершения и итоги, которые раньше отбрасывались loader; исходник и БД не менялись. Независимый replay в clean clone 3b79ed00: 21 карточка, 20 completed, все20 с итогом;1 текущий действующий помощник pending. Full suite1603/1603 до repair; после repair targeted6/6. Typecheck/lint PASS; isolated Vite PASS. Независимая clean-clone приёмка до repair26/26 и typecheckPASS, после repair6/6 и real replayPASS. Review обнаружил и закрыл late-final/followup race.

## Границы
Реальный live SDK→WS→браузер не захвачен; live hooks принимают наблюдаемые envelopes, но replay не доказательство transport E2E. Browser Edge ENOENT. Отдельный FINAL_ANSWER не несёт id цикла: при отсутствии старого итогового сообщения либо необычном переупорядочивании нескольких итогов привязка повторных поручений остаётся неоднозначной. Не объявлять полной гарантией lifecycle.
Production не изменён в этой задаче; общий согласованный выпуск waiting, ждёт завершения работающих сессий. Не запускать второй рестарт. Прежние HTML preview/link fixes также ждут общего выпуска. Dirty provider audit сохранён; коммит содержит только собственные hunks.
