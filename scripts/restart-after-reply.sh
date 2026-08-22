#!/usr/bin/env bash
# Перезапуск Neo3 через паузу — чтобы ответ успел дойти до Димы.
#
# Агент живёт в cgroup сервиса, поэтому `systemctl restart` убивает и его:
# рестарт «прямо сейчас» обрывает ответ на полуслове. Скрипт запускается
# отсоединённо (setsid), переживает эту смерть и сам проверяет, что прод встал.
set -u

LOG=/tmp/neo3-deploy-autopilot.log
DELAY="${1:-90}"

echo "[$(date '+%F %T')] жду ${DELAY}с, потом рестарт neo3.service" > "$LOG"
sleep "$DELAY"

sudo -n systemctl restart neo3.service >> "$LOG" 2>&1
echo "[$(date '+%F %T')] рестарт отдан, жду ответа порта" >> "$LOG"

for _ in $(seq 1 60); do
  sleep 2
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:3001/ 2>/dev/null || true)
  if [ "$code" = "200" ]; then
    # Роут дашборда есть только в новой сборке: 401 на мусорном токене
    # доказывает, что поднялся именно свежий сервер, а не старый.
    probe=$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:3001/ap/nonsense/dashboard.html 2>/dev/null || true)
    echo "[$(date '+%F %T')] ГОТОВО: корень 200, роут дашборда ${probe} (ждали 401)" >> "$LOG"
    exit 0
  fi
done

echo "[$(date '+%F %T')] ПРОВАЛ: сервис не ответил 200 за две минуты" >> "$LOG"
exit 1
