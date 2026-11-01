#!/bin/sh
# Only agent processes and their children inherit these settings.
set -eu
proxy_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$proxy_dir/proxy.env"
: "${NEO3_AGENT_PROXY_URL:?Missing agent proxy URL}"
export HTTP_PROXY="$NEO3_AGENT_PROXY_URL" HTTPS_PROXY="$NEO3_AGENT_PROXY_URL" ALL_PROXY="$NEO3_AGENT_PROXY_URL"
export http_proxy="$HTTP_PROXY" https_proxy="$HTTPS_PROXY" all_proxy="$ALL_PROXY"
export NO_PROXY='localhost,127.0.0.1,::1,100.64.0.0/10,*.ts.net,.ts.net'
export no_proxy="$NO_PROXY"
exec "$@"
