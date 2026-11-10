#!/bin/sh
# Канал агентов на маке: локальный 127.0.0.1:12809 -> мост на VPS NL (127.0.0.1:12809),
# выход которого закреплён на 45.86.61.144. Идёт по SSH (TCP): сначала через Tailscale,
# если не вышло — через публичный адрес VPS. Системный прокси мака не трогается.
# Запускается LaunchAgent com.dimasik.neo3-agent-tunnel; после выхода launchd поднимает снова.
PORT="${NEO3_AGENT_TUNNEL_PORT:-12809}"
KEY="${NEO3_AGENT_TUNNEL_KEY:-$HOME/.ssh/id_brand_vps}"
for host in 100.75.69.57 185.166.154.209; do
  echo "$(date '+%F %T') подключаюсь к VPS через $host"
  /usr/bin/ssh -N -T \
    -o BatchMode=yes -o ExitOnForwardFailure=yes \
    -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
    -o HostKeyAlias=185.166.154.209 -o StrictHostKeyChecking=yes \
    -i "$KEY" -L "127.0.0.1:$PORT:127.0.0.1:12809" "root@$host"
  echo "$(date '+%F %T') канал через $host закрылся (код $?)"
done
sleep 5
