# Neo3 mods wave 2 — шаги применения

## Треды (таск 05): регистрация MCP `neo3-threads`

Треды — инструменты `spawn_thread`, `thread_status`, `message_thread`,
`stop_thread` у агентов Claude, Codex и Grok. Их отдаёт stdio MCP-сервер
`server/threads-mcp.ts`; в сборке это `dist-server/server/threads-mcp.js`.

Регистрация в боевых конфигах — шаг выкатки. До выкатки конфиги на маке не
трогаются: ни тесты, ни смоук в них не пишут, смоук работал во временном HOME.

### Включение: только боевой экземпляр

Регистрацию делает только сервер, у которого в окружении есть `NEO3_THREADS_MCP=on`.
Флаг задаётся только боевому LaunchAgent. Dev- и тест-серверы (в том числе из
`.worktrees`) без флага ничего в конфиги не пишут.

1. Выкатка сборки: `npm run build` в `cloudcli-fork/`.
2. В `/Users/dimasik/Library/LaunchAgents/com.dimasik.neo3-local.plist`, в
   `EnvironmentVariables`, добавить ключ `NEO3_THREADS_MCP` со строкой `on`
   (если словаря нет, создать). Проверка: `plutil -lint` по этому файлу.
3. Перезапуск сервиса (`launchctl bootout` + `bootstrap` для
   `gui/$(id -u)/com.dimasik.neo3-local`, как при обычной выкатке).

На старте сервер (`registerThreadsMcp` в `server/index.js`) пишет запись
`neo3-threads` в два файла. Перед первой правкой каждого файла он сохраняет копию
`<файл>.bak-neo3-threads` — один раз, при следующих правках копия не трогается.

- `~/.claude.json`, `mcpServers` (scope user). Из этого же файла запись читает Grok:
  `{"type":"stdio","command":"<node>","args":["<…>/dist-server/server/threads-mcp.js"],"env":{}}`.
- `~/.codex/config.toml`, раздел `[mcp_servers.neo3-threads]`: тот же `command`/`args`,
  `env_vars = ["NEO3_THREADS_TOKEN", "NEO3_THREADS_API_URL"]`, `tool_timeout_sec = 660`.
  Codex передаёт MCP-серверу только переменные из списка. Таймаут нужен, потому что
  `thread_status` ждёт до 600 с, а у Codex по умолчанию 60 с.

Секретов в записи нет. Токен и адрес Neo3 кладутся в окружение движка на каждый
прогон. Запись идемпотентна: совпадающая не перезаписывается, при смене пути сборки
обновляется. В логе сервера появятся строки
`[threads] neo3-threads MCP registered for claude|codex`.

### Проверка после рестарта (только чтение)

```bash
jq '.mcpServers["neo3-threads"]' ~/.claude.json
grep -A6 'mcp_servers.neo3-threads' ~/.codex/config.toml
grok inspect | grep -A2 'MCP Servers'     # neo3-threads (stdio) ~/.claude.json [claude]
```

Живая проверка — в Neo3 попросить агента Claude: «открой тред на grok с задачей
"ответь словом ПОНГ" и дождись ответа через thread_status». В боковом меню
появится чат «↳ тред от: …», в чате-родителе — плашка «Треды: 1».

### Откат

Убрать `NEO3_THREADS_MCP` из plist и перезапустить сервис. Потом вернуть файлы
из копий `~/.claude.json.bak-neo3-threads` и `~/.codex/config.toml.bak-neo3-threads`
или удалить запись `neo3-threads` руками. Таблицы `thread_tokens` и
`session_threads` в `auth.db` можно не трогать: без MCP они не используются.

### Что важно знать

- Новый движок подхватит MCP только в новом прогоне. Уже идущие прогоны треды
  не увидят.
- `/api/threads/*` живёт на том же адресе, что Neo3 (`HOST`, `SERVER_PORT`).
  Адрес движок получает в `NEO3_THREADS_API_URL`. Если `HOST` конкретный
  (на маке сейчас это Tailscale-IP), берётся он, а для `0.0.0.0` и loopback —
  `127.0.0.1`. Правило — `threadsApiUrl` в `server/shared/threads-env.ts`.
- `/api/threads/*` принимает только локальные соединения: loopback или адрес
  самого сервера, без `X-Forwarded-For`/`Forwarded`/`X-Real-IP`. Через
  Cloudflare/nginx снаружи он недоступен (403 `NOT_LOCAL`).
- Прогон без пользователя (например, системный) токена не получает: инструменты
  тогда честно отвечают «тред недоступен в этом движке».
