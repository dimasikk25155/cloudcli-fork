# Agent outbound proxy

Installed 2026-11-01 for Codex CLI, Grok Build, and the Codex binary bundled with
the Mac Neo3 SDK. Existing model, effort, login, and sandbox settings are preserved.
Running sessions are untouched; newly started engines use the wrappers immediately.

## Routes

- Mac: existing independent Xray HTTP listener `127.0.0.1:11809`, managed by
  `ru.neo3.tyres-bot-network`. This route does not depend on the Happ window.
  Its existing configuration was not changed.
- VPS NL: `neo3-agent-proxy.service` runs the existing Xray binary with a separate
  configuration, binds **only** `127.0.0.1:11809`, and exits through the VPS IP.
  This is a localhost forward proxy, not an additional VPN or a different exit IP.
  No ports were opened to the Internet. The service uses a dynamic unprivileged
  user, automatic restart, and a 128 MiB memory limit.
- Only wrapped agents and their child processes receive upper/lowercase proxy
  variables. Localhost and Tailscale addresses bypass the proxy. The launchers
  do not fall back to direct provider access when the local proxy is unavailable.
  This is process configuration, not a firewall enforcing every program's traffic.

## Installation and repair

Mac, from the repository root:

```sh
python3 scripts/agent-proxy/install.py --sdk-root "$PWD"
python3 ~/.local/share/neo3-agent-proxy/doctor.py
```

Installed Mac support files: `~/.local/share/neo3-agent-proxy/`.
Wrapped launch paths: `/usr/local/bin/codex`, `~/.grok/bin/grok`, and the Codex
native binary inside this repository's `node_modules/@openai/codex-*/vendor/`.
The `.neo3-direct` sibling is the actual upstream executable or installer symlink;
it is required by the wrapper and must remain in place.

VPS support files: `/usr/local/lib/neo3-agent-proxy/`.
Service configuration: `/etc/neo3-agent-proxy/xray.json`.
The VPS installer is run as root with `--engine-home /home/agents`; it wraps the
global Codex launcher and agents' Grok launcher without copying credentials.

```sh
ssh vps-nl 'python3 /usr/local/lib/neo3-agent-proxy/doctor.py'
ssh vps-nl 'systemctl status neo3-agent-proxy --no-pager'
ssh vps-nl 'journalctl -u neo3-agent-proxy -n 20 --no-pager'
```

`scripts/update-engines.sh` repairs an **already configured** Mac installation
after its existing nightly CLI updates. It does not enable a new scheduled job.
After manual package reinstalls or a Neo3 dependency reinstall, run the installed
`install.py` again. It preserves its installation paths and is idempotent.

## Verification boundary

Doctor checks wrappers, proxy availability, and HTTPS access to provider hosts.
HTTP 401/403/404 proves transport reachability only; it does not prove login or
successful inference. Separate model-response smoke checks are required.

Verified on Mac: Codex CLI `NEO3_CODEX_PROXY_OK`, Grok `NEO3_GROK_PROXY_OK`, and
Neo3's actual Codex SDK `NEO3_SDK_PROXY_OK`, all through the configured wrappers.
Public Neo3 health returned 200 without a restart or a dist rebuild.

On VPS, transport is verified. Codex has no login for root or agents. Grok's
existing auth file is present, but a real request as agents returns `Not signed
in`. Both engines require interactive account login before a model-response
check can pass. Mac login material was not copied.

Official Grok proxy support:
https://docs.x.ai/build/enterprise#proxy-support

## Rollback

For each `targets` path in the installed `installation.json`, first verify that
the path is still marked `# neo3-agent-proxy wrapper v1`. Restore its
`<path>.neo3-direct` sibling to `<path>` with `os.replace` (preserves relative
installer symlinks). Never replace a launcher which an upstream installer has
already changed. Remove only this task's optional `/usr/local/bin/grok` symlink
on VPS if it still points to agents' launcher. Then stop/disable only
`neo3-agent-proxy.service` on VPS. Do not stop the shared Mac Xray service.

Remove the optional proxy repair block in `scripts/update-engines.sh` if rolling
back the Mac installation; otherwise a subsequent nightly update reinstalls it.
No provider auth files, model settings, source/runtime builds, or other services
need to be restored.
