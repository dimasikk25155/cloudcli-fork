# Neo3 mods wave 1 — шаг применения: хуки в `~/.claude/settings.json`

Файл вне репозитория, поэтому правится отдельным шагом, после выкатки сборки
с маркером `NEO3_SESSION=1` (таск 07). Порядок важен: сначала выкатка Neo3,
потом правка хуков. Наоборот нельзя: без маркера в окружении хуки не узнают,
что их запустил Neo3.

Что делает маркер:

- Neo3 ставит `NEO3_SESSION=1` каждому Claude CLI (`server/claude-sdk.js`,
  `mapCliOptionsToSDK`).
- Neo3 ставит его же каждому Claude-хуку, который он эмулирует для Grok
  (`server/grok-cli.js`, `runHookCommand`).
- В обычном терминале переменной нет, и хуки работают как раньше.

## 0. Бэкап

```bash
cp ~/.claude/settings.json ~/.claude/settings.json.bak-neo3-wave1-$(date +%Y%m%d-%H%M%S)
```

## 1. Stop-хук памяти: выход при маркере

Сейчас первый Stop-хук — inline-команда: флаг `/tmp/claude-mem-<sid>` +
`{"decision":"block", …obsidian-memory…}`. В начало команды добавляется ровно
один префикс, всё остальное остаётся байт в байт:

```bash
[ "$NEO3_SESSION" = "1" ] && exit 0; 
```

Значение поля `command` после правки, в JSON-виде (`"timeout": 15` не меняется):

```json
"[ \"$NEO3_SESSION\" = \"1\" ] && exit 0; sid=$(jq -r '.session_id // \"nosession\"' 2>/dev/null); f=\"/tmp/claude-mem-${sid}\"; if [ -f \"$f\" ]; then exit 0; fi; touch \"$f\"; printf '%s' '{\"decision\":\"block\",\"reason\":\"Перед завершением сессии примени навык obsidian-memory. … (текст без изменений) …\"}'"
```

В Neo3 вместо этого хука заметки предлагает модуль `memory-suggestions`. Он раз
в 10 минут проверяет затихшие сессии админа и показывает предложение в сессии и
в хабе «Ждут тебя».

Второй Stop-хук (`token-log.mjs`) не трогать.

## 2. Хук-страж секретов в UserPromptSubmit

Добавить новой группой в конец массива `hooks.UserPromptSubmit`. Группа с
`budget-hook.sh` и `now.sh` остаётся как есть:

```json
{
  "hooks": [
    {
      "type": "command",
      "command": "node \"$HOME/Antigravity Project/claude agent/cloudcli-fork/scripts/hooks/secret-guard.mjs\"",
      "timeout": 10
    }
  ]
}
```

- Скрипт читает JSON хука из stdin. Если находит секрет, отдаёт
  `{"decision":"block","reason":…}`: вид секрета без значения.
- При `NEO3_SESSION=1` скрипт молчит: в Neo3 работает страж композера.
- Нужен Node ≥ 22.6 с type stripping (на маке v24): скрипт импортирует
  `shared/secret-detect.ts` напрямую.
- Путь указывает на основное дерево форка. Скрипт должен лежать там после
  переноса ветки.

## 3. Применить одной командой (идемпотентно)

Скрипт пишет файл, только если правка реально меняет JSON. Бэкап (шаг 0)
делается только тогда же. Хук-страж добавляется, только если
`secret-guard.mjs` лежит по указанному пути. Иначе скрипт печатает
`skip guard` и страж не ставит.

```bash
python3 - <<'EOF'
import json, os, shutil, time
p = os.path.expanduser('~/.claude/settings.json')
d = json.load(open(p))
before = json.dumps(d, sort_keys=True)
hooks = d.setdefault('hooks', {})
prefix = '[ "$NEO3_SESSION" = "1" ] && exit 0; '
for group in hooks.get('Stop', []):
    for h in group.get('hooks', []):
        c = h.get('command', '')
        if 'claude-mem-' in c and 'obsidian-memory' in c and not c.startswith(prefix):
            h['command'] = prefix + c
guard_file = os.path.expanduser('~/Antigravity Project/claude agent/cloudcli-fork/scripts/hooks/secret-guard.mjs')
guard = 'node "$HOME/Antigravity Project/claude agent/cloudcli-fork/scripts/hooks/secret-guard.mjs"'
if os.path.isfile(guard_file):
    ups = hooks.get('UserPromptSubmit', [])
    if not any(guard in h.get('command', '') for g in ups for h in g.get('hooks', [])):
        hooks['UserPromptSubmit'] = ups + [{'hooks': [{'type': 'command', 'command': guard, 'timeout': 10}]}]
else:
    print('skip guard: нет файла', guard_file)
if json.dumps(d, sort_keys=True) == before:
    print('без изменений')
else:
    shutil.copy(p, p + time.strftime('.bak-neo3-wave1-%Y%m%d-%H%M%S'))
    tmp = p + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    os.replace(tmp, p)
    print('ok')
EOF
```

## 4. Что проверить после

1. JSON валиден: `python3 -m json.tool ~/.claude/settings.json >/dev/null && echo ok`.
2. Stop-хук в терминале не изменился. В пустой папке `claude -p "скажи привет"`:
   после ответа хук, как и раньше, просит obsidian-memory (один раз на сессию).
3. Stop-хук в Neo3 молчит:
   - Claude-сессия в Neo3 заканчивается без лишнего хода «примени obsidian-memory»;
   - в `/tmp` не появляется новый `claude-mem-<sid>` этой сессии.
   Та же проверка для Grok: после ответа нет автоматического follow-up.
4. Хук сам по себе, без запуска Claude:

   ```bash
   CMD=$(python3 -c "import json,os;d=json.load(open(os.path.expanduser('~/.claude/settings.json')));print(d['hooks']['Stop'][0]['hooks'][0]['command'])")
   echo '{"session_id":"apply-check"}' | NEO3_SESSION=1 bash -c "$CMD"; echo "rc=$? (пусто = ок)"
   echo '{"session_id":"apply-check"}' | env -u NEO3_SESSION bash -c "$CMD" | head -c 40; echo; rm -f /tmp/claude-mem-apply-check
   ```

5. Страж в терминале блокирует. Подставь вместо `XXXX` 36 любых букв и цифр:
   `echo '{"prompt":"ghp_XXXX"}' | node "$HOME/Antigravity Project/claude agent/cloudcli-fork/scripts/hooks/secret-guard.mjs"`.
   Ожидается `{"decision":"block",…}` без значения ключа.
   С `NEO3_SESSION=1` вывода нет.
6. Предложения заметок:
   - в логе сервера нет `[memory-suggestions] loop failed to start`;
   - через ~2 минуты после старта и далее раз в 10 минут проходит проверка;
   - выключатель: `NEO3_MEMORY_SUGGESTIONS=off`;
   - без папки вольта (`NEO3_VAULT_DIR`, по умолчанию
     `~/Antigravity Project/Dimasik-Obsidian/Dimasik`) проверка ничего не делает.
7. Модель заметок: `LOCAL_LLM_MEMORY_MODEL`, по умолчанию `qwen3.5:9b`. Она
   должна быть на Ollama по `LOCAL_LLM_BASE_URL`, по умолчанию туннель
   `127.0.0.1:11435`. Запрос идёт с `num_ctx 32768`: при первом вызове модель
   перегрузится с этим окном.

## Откат

Вернуть бэкап из шага 0:
`cp ~/.claude/settings.json.bak-neo3-wave1-<время> ~/.claude/settings.json`.
Маркер в окружении Neo3 безвреден, пока хуки его не читают.
