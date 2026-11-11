#!/bin/sh
# Only agent processes and their children inherit these settings.
set -eu
proxy_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -e "$proxy_dir/switch-in-progress" ] || [ -e "$proxy_dir/switch-recovery.json" ]; then
    echo 'Agent blocked: complete the pending proxy switch in the offline switcher.' >&2
    exit 78
fi
. "$proxy_dir/proxy.env"
: "${NEO3_AGENT_PROXY_URL:?Missing agent proxy URL}"

# Exit IP checked through the explicit proxy only; never via the system/default route.
probe_exit() {
    for endpoint in https://api.ipify.org https://checkip.amazonaws.com; do
        ip=$(curl --fail --silent --connect-timeout 4 --max-time 6 \
            --noproxy '' --proxy "$NEO3_AGENT_PROXY_URL" "$endpoint" 2>/dev/null | tr -d '[:space:]') || ip=''
        [ "$ip" = "$NEO3_AGENT_EXPECTED_IP" ] && return 0
    done
    return 1
}

# tunnel.sh writes the time of its last successful exit check into `health`.
# A fresh mark (<= 60 s) means the pinned exit was just verified: start at once.
health_fresh() {
    [ -f "$proxy_dir/health" ] || return 1
    last=$(cat "$proxy_dir/health" 2>/dev/null) || return 1
    case "$last" in ''|*[!0-9]*) return 1 ;; esac
    [ $(( $(date +%s) - last )) -le 60 ]
}

if [ -n "${NEO3_AGENT_EXPECTED_IP:-}" ] && ! health_fresh; then
    # A short stall must not kill the agent: tunnel.sh reconnects by itself,
    # so wait for it (default 45 s) instead of failing on the first try.
    wait_sec="${NEO3_AGENT_PROXY_WAIT_SEC:-45}"
    started=$(date +%s)
    warned=0
    until probe_exit; do
        if [ $(( $(date +%s) - started )) -ge "$wait_sec" ]; then
            echo "$(date '+%F %T') blocked pid=$$ ${1:-}" >> "$proxy_dir/blocked.log" 2>/dev/null || true
            echo 'Agent blocked: proxy unavailable or exit IP does not match the pinned address.' >&2
            exit 78
        fi
        if [ "$warned" = 0 ]; then
            echo 'Мост ИИ: канал до VPS не ответил, жду переподключения…' >&2
            warned=1
        fi
        sleep 3
    done
fi
if [ -e "$proxy_dir/switch-in-progress" ] || [ -e "$proxy_dir/switch-recovery.json" ]; then
    echo 'Agent blocked: proxy switch began during the connection check.' >&2
    exit 78
fi
export HTTP_PROXY="$NEO3_AGENT_PROXY_URL" HTTPS_PROXY="$NEO3_AGENT_PROXY_URL" ALL_PROXY="$NEO3_AGENT_PROXY_URL"
export http_proxy="$HTTP_PROXY" https_proxy="$HTTPS_PROXY" all_proxy="$ALL_PROXY"
export NO_PROXY='localhost,127.0.0.1,::1,100.64.0.0/10,*.ts.net,.ts.net'
export no_proxy="$NO_PROXY"
# Node 24+ native fetch/http clients must use the same environment proxy.
export NODE_USE_ENV_PROXY=1
exec "$@"
