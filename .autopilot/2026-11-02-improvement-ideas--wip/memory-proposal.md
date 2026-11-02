# Указатели для будущей работы

- Мод идей: docs/improvement-ideas.md; server/modules/improvement-ideas/ и src/components/improvement-ideas/.
- Реестр предложений: vault/wiki/ideas/neo3-<hash>.md, отдельно по владельцу/проекту; предложения не равны завершённой работе.
- Не flush delta-блоки по служебным WS-событиям. Проверять секреты полного блока до извлечения текста идеи.
- Tests service fixture должна создавать пустой DB до initializeDatabase, иначе автоматически копируется legacy database/auth.db.
- Состояние этой работы и ограничения: verification.md рядом. Production пока не применён.
