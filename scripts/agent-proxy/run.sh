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
# A wrong or unavailable exit must stop the agent before it contacts a provider.
# Probe through the explicit proxy; never retry using the system/default route.
if [ -n "${NEO3_AGENT_EXPECTED_IP:-}" ]; then
    actual_ip=''
    for endpoint in https://api.ipify.org https://checkip.amazonaws.com; do
        if actual_ip=$(curl --fail --silent --connect-timeout 5 --max-time 10 \
            --noproxy '' --proxy "$NEO3_AGENT_PROXY_URL" "$endpoint"); then
            break
        fi
    done
    if [ "$actual_ip" != "$NEO3_AGENT_EXPECTED_IP" ]; then
        echo 'Agent blocked: proxy unavailable or exit IP does not match the pinned address.' >&2
        exit 78
    fi
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
