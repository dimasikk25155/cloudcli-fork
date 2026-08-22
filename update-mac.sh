#!/usr/bin/env bash
# Обновляет второй агент на маке (claude2.neo3.ru) кодом с этого VPS.
#
# Зачем скрипт: мак и VPS — две независимые копии форка, и до 20.08.2026 мак
# молча отставал на полторы недели (старый бандл, нет панели сервера и
# автопилота). Гит тут не помощник: часть работы живёт некоммиченной на диске,
# поэтому код едет rsync'ом, а не через pull.
#
# Что НЕ едет: .env, node_modules, dist, база ~/.cloudcli — у мака свои
# (порт 3005, локальные модели Ollama, свои проекты).
set -euo pipefail

MAC_HOST="${MAC_HOST:-mac}"
MAC_DIR="/Users/dimasik/Antigravity Project/claude agent/cloudcli-fork"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.dimasik.neo3-local"

echo "==> Гейт: типы и тесты на этой машине"
cd "$SRC_DIR"
npm run typecheck >/dev/null
npm test >/dev/null 2>&1 || { echo "ТЕСТЫ КРАСНЫЕ — мак не трогаю"; exit 1; }

echo "==> Копирую исходники на мак"
rsync -rlptD \
  src server shared public plugins templates scripts database \
  index.html package.json package-lock.json vite.config.js tsconfig.json \
  tailwind.config.js postcss.config.js eslint.config.js \
  "$MAC_HOST:$MAC_DIR/"

echo "==> Сборка на маке"
# NODE_ENV=development обязателен: под production npm выкидывает dev-зависимости
# (включая vite), и сборка падает на ровном месте.
ssh "$MAC_HOST" "export PATH=/usr/local/bin:/opt/homebrew/bin:\$PATH; cd '$MAC_DIR' && \
  NODE_ENV=development npm install --include=dev --no-audit --no-fund >/dev/null && \
  npm run build >/dev/null"

echo "==> Перезапуск агента"
ssh "$MAC_HOST" "launchctl kickstart -k gui/\$(id -u)/$LABEL"
sleep 6

echo "==> Проверка: бандл на маке и на claude2.neo3.ru должны совпасть"
LOCAL_BUNDLE=$(ssh "$MAC_HOST" "grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' '$MAC_DIR/dist/index.html' | head -1")
LIVE_BUNDLE=$(curl -s -m 20 https://claude2.neo3.ru/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)
echo "    на диске: $LOCAL_BUNDLE"
echo "    в проде:  $LIVE_BUNDLE"
[ -n "$LIVE_BUNDLE" ] && [ "$LOCAL_BUNDLE" = "$LIVE_BUNDLE" ] || {
  echo "РАСХОЖДЕНИЕ: claude2 отдаёт не тот бандл, что собран. Проверь launchctl list | grep neo3"
  exit 1
}
echo "✅ Мак обновлён: https://claude2.neo3.ru/"
