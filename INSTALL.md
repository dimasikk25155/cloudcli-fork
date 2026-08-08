# Neo3 Agent System — установка и обновление

Отдай этот файл своему Claude Code (или любому ИИ-агенту с доступом к серверу) и скажи: «сделай по инструкции». Ничего больше не нужно — ни паролей, ни ключей, ни ожидания, пока кто-то тебе что-то пришлёт.

**Что это.** Веб-оболочка для Claude Code: чат в браузере и на телефоне, проекты, файлы, git, режимы работы, счётчик расхода лимитов. Под капотом — твой собственный Claude Code на твоей подписке. Форк открытого проекта [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui), лицензия AGPL-3.0.

**Код:** https://github.com/dimasikk25155/cloudcli-fork , ветка `dima/fork-customizations`.

---

## Что нужно

- VPS с **Ubuntu 22.04 или 24.04**, минимум 2 ГБ RAM (лучше 4), root-доступ по SSH.
- **Домен или поддомен**, который ты можешь направить на IP этого VPS (A-запись).
- Аккаунт Anthropic с подпиской Claude (Pro/Max). Логинишься уже внутри, после установки.

⚠️ Anthropic не обслуживает часть стран. Если твой VPS в такой стране — Claude на нём не залогинится. Бери VPS там, где сервис доступен (Нидерланды, Германия, Казахстан, Армения), либо см. «Gateway-режим» ниже.

---

## Шаг 0. Разведка — что уже стоит на этой машине

**Никогда не устанавливай поверх вслепую.** Сначала выполни это на сервере и посмотри вывод:

```bash
# Что за инстанс тут живёт (если живёт)
systemctl status cloudcli --no-pager 2>/dev/null | head -5
systemctl show cloudcli -p ExecStart -p User -p WorkingDirectory --no-pager 2>/dev/null
ls -d /home/*/cloudcli 2>/dev/null
readlink -f /usr/bin/cloudcli 2>/dev/null
curl -s http://127.0.0.1:3001/health; echo
```

Как прочитать результат:

| Что видишь | Что это значит | Куда дальше |
|---|---|---|
| Пусто / сервиса нет | Чистая машина | **Шаг 1** — установка с нуля |
| `ExecStart=/usr/bin/cloudcli`, путь ведёт в `node_modules/@cloudcli-ai/cloudcli` | Стоит **апстрим** из npm, не эта сборка | **Шаг 2** — миграция |
| `WorkingDirectory=/home/cloudcli/cloudcli` + там есть `.git` | Уже эта сборка, поставленная клоном | **Шаг 3** — обновление |
| `/home/cloudcli/cloudcli` есть, а `.git` нет | Эта сборка из архива | **Шаг 3**, вариант Б |

**Как отличить эту сборку от апстрима наверняка** (версия в `/health` не поможет — номера совпадают). Скачай фронтовый бандл и грепни маркеры:

```bash
B=$(curl -s https://ТВОЙ-ДОМЕН/ | grep -oE '/assets/index-[A-Za-z0-9._-]+\.js' | head -1)
curl -s "https://ТВОЙ-ДОМЕН$B" -o /tmp/b.js
for s in Neo3 Kimi Сценарии Дотошный; do printf "%-12s %s\n" "$s" "$(grep -c "$s" /tmp/b.js)"; done
```

Все нули → это апстрим CloudCLI. Ненулевые → сборка Neo3.

---

## Шаг 1. Установка с нуля

```bash
# на сервере, под root
curl -fsSL https://raw.githubusercontent.com/dimasikk25155/cloudcli-fork/dima/fork-customizations/install.sh -o /root/install.sh
bash /root/install.sh ТВОЙ-ДОМЕН --clone
```

Скрипт сам поставит Node 22, Claude Code CLI, Caddy (HTTPS-сертификат Let's Encrypt), создаст юзера `cloudcli`, соберёт приложение и заведёт systemd-сервис. Занимает 5–15 минут, в основном сборка.

Хочешь оставить вкладку с обычным терминалом внутри UI — добавь `--enable-terminal` в конец. По умолчанию она выключена, так безопаснее.

**После установки:**

1. Направь A-запись домена на IP сервера (`curl -s -4 ifconfig.me` покажет IP). Caddy сам подтянет сертификат, когда DNS разойдётся — просто подожди пару минут.
2. Открой `https://ТВОЙ-ДОМЕН`. **Первый вошедший задаёт пароль администратора** — не тяни, зайди сам первым.
3. Настройки → Агенты → Claude → «Войти снова» → залогинься своим аккаунтом Anthropic. Данные входа остаются на твоём сервере.

---

## Шаг 2. Миграция с апстримного CloudCLI

Если Шаг 0 показал npm-пакет `@cloudcli-ai/cloudcli` — это **другой продукт**, обновлениями он в эту сборку не превратится никогда. Нужно поставить эту сборку рядом и перенести данные.

```bash
# 1. Куда апстрим складывал данные (база, логины, история чатов)
systemctl show cloudcli -p User --no-pager        # обычно cloudcli или agents
OLD_USER=<юзер из вывода выше>
ls -la /home/$OLD_USER/.cloudcli /home/$OLD_USER/.claude 2>/dev/null

# 2. Бэкап ДО всего остального
tar czf /root/cloudcli-backup-$(date +%F).tar.gz \
  /home/$OLD_USER/.cloudcli /home/$OLD_USER/.claude 2>/dev/null
ls -lh /root/cloudcli-backup-*.tar.gz

# 3. Гасим старый сервис (не удаляем — пусть будет откат)
systemctl stop cloudcli && systemctl disable cloudcli

# 4. Ставим эту сборку (перезапишет unit-файл cloudcli — это ожидаемо)
curl -fsSL https://raw.githubusercontent.com/dimasikk25155/cloudcli-fork/dima/fork-customizations/install.sh -o /root/install.sh
bash /root/install.sh ТВОЙ-ДОМЕН --clone
```

**Перенос старых чатов и логина** (необязательно — можно начать с чистого листа). Если старый юзер НЕ `cloudcli`:

```bash
systemctl stop cloudcli
cp -a /home/$OLD_USER/.claude/.  /home/cloudcli/.claude/       # логин Anthropic + история сессий
cp -a /home/$OLD_USER/.cloudcli/. /home/cloudcli/.cloudcli/    # база: проекты, имена сессий, пароль UI
cp -a /home/$OLD_USER/projects/.  /home/cloudcli/workspace/ 2>/dev/null   # рабочие папки
chown -R cloudcli:cloudcli /home/cloudcli
systemctl start cloudcli && sleep 3 && systemctl is-active cloudcli
```

База апстрима может не сойтись со схемой этой сборки. Если после переноса сервис не поднялся — смотри `journalctl -u cloudcli -n 50`, и при ошибках миграции просто убери базу (`mv /home/cloudcli/.cloudcli/auth.db{,.broken}`) и начни с чистой: проекты и логин задашь заново, бэкап у тебя есть.

Если старый апстрим стоял глобально из npm — после успешного переезда удали, чтобы не путаться: `npm rm -g @cloudcli-ai/cloudcli`.

---

## Шаг 3. Обновление

**Вариант А — установка клоном (в `/home/cloudcli/cloudcli` есть `.git`).** Одна команда:

```bash
sudo bash /home/cloudcli/cloudcli/self-update.sh
```

Тянет свежий код, пересобирает, перезапускает сервис и проверяет, что инстанс реально поднялся на новой версии. Данные (`~/.cloudcli`, `~/.claude`, `~/workspace`, `.env`) не трогает.

**Вариант Б — установка из архива (`.git` нет).** Переведи коробку на клон один раз, дальше работает вариант А:

```bash
systemctl stop cloudcli
mv /home/cloudcli/cloudcli /home/cloudcli/cloudcli-old
su - cloudcli -c "git clone --branch dima/fork-customizations https://github.com/dimasikk25155/cloudcli-fork.git ~/cloudcli"
cp /home/cloudcli/cloudcli-old/.env /home/cloudcli/cloudcli/.env
su - cloudcli -c "cd ~/cloudcli && npm install && npm run build"
systemctl start cloudcli && sleep 3 && systemctl is-active cloudcli
# убедился, что всё работает — удали /home/cloudcli/cloudcli-old
```

**После любого обновления обнови страницу в браузере жёстко** (Safari — ⌥⌘R, Chrome — Ctrl+Shift+R). Иначе увидишь старый интерфейс из кеша и решишь, что ничего не изменилось.

---

## Проверка, что всё получилось

```bash
systemctl is-active cloudcli                      # active
curl -s http://127.0.0.1:3001/health; echo        # {"status":"ok",...}
curl -s -o /dev/null -w "%{http_code}\n" https://ТВОЙ-ДОМЕН/   # 200
```

В самом интерфейсе (после жёсткой перезагрузки страницы) должно быть:
- в выборе модели — **Opus 5 / Sonnet 5 / Fable 5**, а не «Opus 4.8»;
- рядом с полем ввода — переключатель **режимов работы** (Дефолтный / Брифы / Дотошный);
- **счётчик расхода** лимитов подписки.

Чего-то из этого нет — значит браузер отдал старый кеш либо обновление не доехало. Проверь `journalctl -u cloudcli -n 50`.

---

## Если что-то пошло не так

| Симптом | Причина и лечение |
|---|---|
| `npm install` падает на ripgrep (403) | Скачивание бинаря блокируется. `npm install --ignore-scripts && npm rebuild better-sqlite3`, затем `cp "$(which rg)" ~/cloudcli/node_modules/@vscode/ripgrep/bin/rg` |
| Сервис активен, но задачи падают «claude not found» | systemd даёт урезанный PATH. В unit-файле должна быть строка `Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`, затем `systemctl daemon-reload && systemctl restart cloudcli` |
| «Binary failed to launch» | Текст ошибки врёт про несовместимость. Чаще всего проект указывает на несуществующую папку — открой другой проект или создай папку заново |
| Сайт не открывается, сертификата нет | DNS ещё не разошёлся. `dig +short ТВОЙ-ДОМЕН` должен вернуть IP сервера; Caddy повторит запрос сам, `journalctl -u caddy -n 30` |
| Claude не логинится, ошибка 403 | VPS в стране, которую Anthropic не обслуживает. Смени регион либо см. Gateway-режим |
| Сборка убивает сервер (OOM) | Меньше 2 ГБ RAM. Добавь своп: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile` |

**Gateway-режим** (VPS в «неправильной» стране, но есть свой прокси): установи переменную перед запуском — тогда наружу через прокси пойдёт только трафик агента, а apt/git останутся на локальной сети.

```bash
GATEWAY_PROXY=socks5h://127.0.0.1:10808 bash /root/install.sh ТВОЙ-ДОМЕН --clone
```

---

## Что где лежит

| Что | Путь |
|---|---|
| Код приложения | `/home/cloudcli/cloudcli` |
| Настройки инстанса | `/home/cloudcli/cloudcli/.env` (порт, домен, прокси) |
| База: проекты, сессии, пароль UI | `/home/cloudcli/.cloudcli/auth.db` |
| Логин Anthropic + история чатов | `/home/cloudcli/.claude/` |
| Твои рабочие проекты | `/home/cloudcli/workspace/` |
| Логи | `journalctl -u cloudcli -f` |
| Reverse proxy / HTTPS | `/etc/caddy/Caddyfile` |

Обновление кода не трогает ничего из строк 3–5 — они живут вне папки установки специально.
