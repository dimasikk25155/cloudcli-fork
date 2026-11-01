#!/usr/bin/env python3
"""Check the configured route without credentials or model requests."""
import concurrent.futures
import json
from pathlib import Path
import subprocess
import sys
import socket
import time

root = Path(__file__).resolve().parent
state = json.loads((root / 'installation.json').read_text())
for target in state['targets']:
    path = Path(target)
    try:
        with path.open('rb') as stream:
            active = b'# neo3-agent-proxy wrapper v1' in stream.read(100)
        native = path.with_name(path.name + '.neo3-direct').exists()
    except OSError:
        active = native = False
    print('Wrapper:', target, 'OK' if active and native else 'MISSING; rerun install.py', flush=True)
    if not active or not native:
        sys.exit(1)

# systemd's active state can precede Xray binding its socket by a few milliseconds.
for attempt in range(25):
    try:
        with socket.create_connection(('127.0.0.1', 11809), timeout=0.2):
            break
    except OSError:
        if attempt == 24:
            print('FAILED: local proxy is not listening on 127.0.0.1:11809')
            sys.exit(1)
        time.sleep(0.2)

hosts = ['api.openai.com', 'chatgpt.com', 'auth.openai.com', 'cli-chat-proxy.grok.com', 'auth.x.ai', 'api.x.ai']
def check(host):
    suffix = '/v1/models' if host.startswith('api.') else '/'
    p = subprocess.run(['curl', '--silent', '--show-error', '--connect-timeout', '8', '--max-time', '20', '--noproxy', '', '--proxy', state['proxy'], '--output', '/dev/null', '--write-out', '%{http_code}', 'https://' + host + suffix], capture_output=True, text=True)
    # 401/403/404 prove HTTP reachability, not successful account inference.
    ok = p.returncode == 0 and p.stdout.strip().isdigit() and 100 <= int(p.stdout.strip()) < 500
    return host, p.stdout.strip(), ok
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    results = list(pool.map(check, hosts))
for host, code, ok in results:
    print('HTTPS:', host, code or 'no response', 'reachable' if ok else 'FAILED')
sys.exit(0 if all(row[2] for row in results) else 1)
