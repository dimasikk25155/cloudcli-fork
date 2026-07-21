# Очередь на деплой (staged, НЕ выкачено)

Здесь копятся изменения, готовые к проду, но специально ещё **не задеплоенные**
(деплой = `launchctl kickstart` сервиса `com.dimasik.cloudcli`, а он рвёт живую
сессию — и веб, и телефон). Выкатываем в безопасный момент одной командой.

## Как выкатить (одной командой, из безопасного окна)

```bash
cd "/Users/dimasik/Antigravity Project/claude agent/cloudcli-fork" && ./deploy.sh
```

`deploy.sh` сам: прогонит гейт (typecheck + тесты) → соберёт → перезапустит сервис
→ смоук-проверит, что прод реально отдаёт свежий бандл. Красный смоук = деплой НЕ
случился.

⚠️ Запускать НЕ из той сессии, что крутится через `claude.neo3.ru` (сама себя
уронит на рестарте). Лучше из отдельного терминала на Маке.

---

## В очереди

### 2026-07-21 — фикс наезда текста на чип «Enter» в брифе (AskUserQuestion)
- **Что:** в поле «Other…» длинный текст залезал под подсказку `Enter` справа.
  Дал полю правый отступ (`pl-3 pr-14`) + `pointer-events-none` на чип.
- **Файл:** `src/components/chat/tools/components/InteractiveRenderers/AskUserQuestionPanel.tsx`
- **Заодно (иначе гейт красный):** добавлен `@types/jsonwebtoken` в devDependencies —
  без него `deploy.sh` падал на typecheck ещё до правки (`auth.test.ts` не находил типы).
  Файлы: `package.json`, `package-lock.json`.

### 2026-07-21 (вечер) — фикс гонки авто-обновления CLI ("exists but failed to launch")
- **Что:** Claude Code CLI сам себя обновляет (подменяет файл + symlink `~/.local/bin/claude`);
  если CloudCLI спавнит процесс в этот момент — `existsSync()` проходит, но запуск падает,
  SDK кидает "Claude Code native binary at <path> exists but failed to launch".
  `autoUpdates:false` не спасает (есть `autoUpdatesProtectedForNative:true`).
- **Фикс:** retry на один повтор (800мс задержка) именно на этой ошибке, и только пока
  в стрим ещё ничего не пришло (безопасно повторить без дублей).
- **Файл:** `server/claude-sdk.js`
- **Проверено:** typecheck чисто, 165/165 тестов зелёных. Подробности — вольт Dimasik,
  заметка `wiki/entities/agents-web-ui.md`.
