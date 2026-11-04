# Пакет для терминального Claude Code (T03)

Всё лежит вне форка, в домашней папке. Ничего в `~/.claude`, `~/.codex`, `~/.grok` не удалялось и не переносилось.

## Что поставлено
| Что | Где |
|---|---|
| Строка состояния (модель, контекст %, окна 5 ч и неделя) | `~/.claude/statusline/neo3-statusline.mjs`, тест `neo3-statusline.test.mjs` рядом |
| `/skill-audit` (аудит навыков: дубли, пустые описания, битые ссылки, конфликты имён; только отчёт) | `~/.claude/skills/skill-audit/` (`SKILL.md`, `audit.mjs`) |
| `/setup-doctor` (движки, MCP, neo3-threads, Ollama-туннель, диск, служба Neo3; без ключей) | `~/.claude/skills/setup-doctor/SKILL.md` |
| `/second-opinion` (советник: один разовый вызов сильной модели) | `~/.claude/skills/second-opinion/SKILL.md` |
| `/jev` (проверка картинок, по умолчанию dry-run) | `~/.claude/skills/jev/SKILL.md` |

Имена изменены против плана: в Claude Code уже есть встроенные `/skill-doctor` и `/advisor` (и `/doctor`), поэтому навыки названы `skill-audit` и `second-opinion`.

## Строка состояния
Источники лимитов по порядку: `rate_limits` из stdin (их передаёт сам Claude Code, только подписчикам, после первого ответа) -> кэш `~/.cloudcli/statusline-cache.json` (не старше 60 с) -> тот же endpoint, что у Neo3 (`server/shared/claude-usage.ts`: токен из Keychain, `api.anthropic.com/api/oauth/usage`), не чаще раза в минуту; сбой тоже кэшируется. Токен не печатается и не сохраняется. Нет данных -> `лимиты: ?`.
Проверка: `node --test ~/.claude/statusline/neo3-statusline.test.mjs`.

### Подключение (НЕ сделано: в settings.json уже есть statusLine)
Сейчас в `~/.claude/settings.json`: `"statusLine": {"type":"command","command":"npx -y ccusage statusline","padding":0}`. Я его не заменял. Чтобы переключить, по согласию Димы:
1. `cp ~/.claude/settings.json ~/.claude/settings.json.bak-20261104`
2. заменить только ключ `statusLine` на `{"type":"command","command":"node ~/.claude/statusline/neo3-statusline.mjs","padding":0}`
3. проверить: `node -e 'JSON.parse(require("fs").readFileSync(process.env.HOME+"/.claude/settings.json","utf8"))'`

Откат: вернуть копию (`cp ~/.claude/settings.json.bak-20261104 ~/.claude/settings.json`) или вернуть прежнюю команду ccusage.

## Codex
Каталог `~/.codex/skills` есть (читается сам Codex). В нём уже лежат символические ссылки на те же навыки (`jev`, `skill-audit`, `setup-doctor`, `second-opinion`), созданные синхронизацией навыков на этой машине. Для навыка аудита в Codex отдельная копия не нужна: `node ~/.codex/skills/skill-audit/audit.mjs ~/.codex/skills`.

## Grok
У Grok CLI каталог навыков есть: `~/.grok/skills/` (пока не создан) и режим совместимости `[compat.claude] skills = true` по умолчанию сканирует `~/.claude/skills/`, поэтому `jev` и остальные Grok видит без копий (по `~/.grok/docs/user-guide/05-configuration.md`; живой запуск не проверялся). Если совместимость выключена, запуск Jev вручную: `python3 '/Users/dimasik/Antigravity Project/claude agent/scripts/visual-qa/qa.py' --describe`, затем dry-run (без `--execute`). Строка в общий промпт Neo3 автоматически не добавляется.

## Jev: правила
По умолчанию dry-run/`--fixture`. Платный `--execute` только по прямой просьбе Димы с подтверждением, `screen` ещё с `--allow-sensitive-screen-upload`.
