#!/usr/bin/env python3
"""Install agent-only proxy wrappers without restarting running sessions."""
import argparse
import json
import os
from pathlib import Path
import platform
import shlex
import shutil

MARKER = '# neo3-agent-proxy wrapper v1'
parser = argparse.ArgumentParser()
parser.add_argument('--prefix', type=Path)
parser.add_argument('--engine-home', type=Path)
parser.add_argument('--sdk-root', type=Path)
parser.add_argument('--proxy', default=None)
args = parser.parse_args()
mac = platform.system() == 'Darwin'
prefix = args.prefix or (Path.home() / '.local/share/neo3-agent-proxy' if mac else Path('/usr/local/lib/neo3-agent-proxy'))
prefix.mkdir(parents=True, exist_ok=True)
manifest = prefix / 'installation.json'
state = json.loads(manifest.read_text()) if manifest.exists() else {}
home = args.engine_home or Path(state.get('engine_home', str(Path.home())))
sdk_root = args.sdk_root or (Path(state['sdk_root']) if state.get('sdk_root') else None)
proxy = args.proxy or state.get('proxy', 'http://127.0.0.1:11809')
if proxy != 'http://127.0.0.1:11809':
    raise SystemExit('This installation expects the verified loopback HTTP proxy on port 11809.')
source = Path(__file__).resolve().parent
for name in ('run.sh', 'install.py', 'doctor.py'):
    destination = prefix / name
    if source / name != destination:
        shutil.copyfile(source / name, destination)
    destination.chmod(0o755)
(prefix / 'proxy.env').write_text(f'NEO3_AGENT_PROXY_URL={shlex.quote(proxy)}\n')
(prefix / 'proxy.env').chmod(0o644)

def write_wrapper(path, native):
    text = '#!/bin/sh\n' + MARKER + '\nexec ' + shlex.quote(str(prefix / 'run.sh')) + ' ' + shlex.quote(str(native)) + ' "$@"\n'
    temporary = path.with_name(path.name + '.neo3-new')
    temporary.write_text(text)
    temporary.chmod(0o755)
    os.replace(temporary, path)

def wrap(path):
    if not path.exists():
        return False
    with path.open('rb') as stream:
        current = stream.read(100)
    if MARKER.encode() in current:
        return True
    native = path.with_name(path.name + '.neo3-direct')
    # Relative installer symlinks keep their meaning in the same directory.
    os.replace(path, native)
    try:
        write_wrapper(path, native)
    except BaseException:
        os.replace(native, path)
        raise
    print('Wrapped:', path)
    return True

targets = []
global_codex = Path('/usr/local/bin/codex')
if wrap(global_codex):
    targets.append(str(global_codex))
grok = home / '.grok/bin/grok'
if wrap(grok):
    targets.append(str(grok))
    # Keep the upstream ~/.local/bin link and expose the installed Linux CLI.
    if not mac and not os.path.lexists('/usr/local/bin/grok'):
        Path('/usr/local/bin/grok').symlink_to(grok)
if sdk_root:
    native_bins = list((sdk_root / 'node_modules/@openai').glob('codex-*/vendor/*/bin/codex'))
    native_bins += list((sdk_root / 'node_modules/@openai').glob('codex-*/vendor/*/codex/codex'))
    if not native_bins:
        raise SystemExit('No bundled Codex binary found; SDK proxy setup is incomplete.')
    for path in native_bins:
        if wrap(path):
            targets.append(str(path))
state.update(engine_home=str(home), sdk_root=str(sdk_root) if sdk_root else None, proxy=proxy, targets=targets)
manifest.write_text(json.dumps(state, indent=2) + '\n')
print('Agent proxy installed:', prefix, '; wrapped targets:', len(targets))
