# Pinned outbound IP for coding agents

The required provider-visible IP is **45.86.61.144** (2026-11-03). This applies
to CLI login, model requests, SDK launches, and the browser used for OAuth.
Do not introduce a direct fallback or a different exit address.

## Installed routes

- **Mac CLI:** `127.0.0.1:12809` → a dedicated Hysteria2 client →
  `45.86.61.144:443`. LaunchAgent `com.dimasik.neo3-agent-hysteria`.
  Binary: `~/.local/share/neo3-agent-proxy/hysteria` (official v2.13.0,
  darwin-arm64 SHA256 `c8c3589239ce4ecf335c07a3f6ec11b3ef8fbdfe9e5a5ea0ef8ba8ce50d2bb90`).
  Private configuration: `~/Antigravity Project/.secrets.d/neo3-agent-hysteria.json`,
  mode 0600. Logs: `~/.local/share/neo3-agent-proxy/hysteria.log`.
- **VPS CLI:** `127.0.0.1:12809` → existing `/usr/local/bin/hysteria`
  (v2.12.3) → the same endpoint. Unit `neo3-agent-hysteria.service`;
  `/etc/neo3-agent-proxy/hysteria.json` is 0600 and supplied to the dynamic
  service user with systemd `LoadCredential`. No external listening port.
- TLS checks remain enabled, with SNI `mya1a.neo3.ru`.
- **Mac browser:** Happ profile `Happ Fast QUIC`, TUN enabled, same endpoint.
  Safari's actual IP was checked in its own temporary tab. The CLI tunnel
  is pinned independently; changing the Happ selection cannot intentionally
  select a different CLI exit. An underlying network block instead causes failure.
- The old Mac Xray on `11809` is shared with WhatsApp bots and was not changed.
  The old VPS proxy is retained for rollback; new agent wrappers do not use it.

Mac direct QUIC initially timed out while Happ used another profile. After
switching Happ to the supplied profile, both the browser and independent client
connected successfully. No SSH relay is part of the final route.

## Launchers and fail-closed checks

The existing `neo3-agent-proxy` launcher now covers installed Claude, Codex,
Grok, Gemini, OpenCode, Cursor (`cursor-agent` / `agent`), Kimi and Neo3's
bundled Codex binary. On VPS it covers global commands and agents' local commands.
The concrete inventory is the installed `installation.json`.

Before executing a CLI, `run.sh` fetches the external IP through the explicit
proxy. A missing proxy, failed check, or different IP exits with code 78 before
starting the agent. The second IP-check service also uses the same explicit
proxy. Upper/lowercase HTTP(S)/ALL_PROXY and `NODE_USE_ENV_PROXY=1` are exported.
Localhost and Tailscale exclusions are preserved.

This enforces the standard launcher path and checks the exit at startup. It is
**not an OS firewall**: deliberately invoking an original `.neo3-direct` binary,
unregistered executables, software that ignores proxy variables, or an existing
process with stale environment is outside this guarantee. Never describe these
wrappers as a machine-wide network kill switch. Future hosts must be installed
and verified before account login. Safari relies on the selected Happ profile;
its route must be rechecked if the VPN changes or disconnects.

## Installation, updates, and new hosts

Supply the Hysteria secret privately; never commit the URI/auth value. Configure
server `45.86.61.144:443`, TLS SNI `mya1a.neo3.ru`, `insecure:false`, and an HTTP
listener on `127.0.0.1:12809`. Install the appropriate service template here,
start it, and prove the output of:

```sh
curl --fail --proxy http://127.0.0.1:12809 --noproxy '' https://api.ipify.org
```

Then install wrappers from the repository root:

```sh
# Mac
python3 scripts/agent-proxy/install.py --sdk-root "$PWD" \
  --proxy http://127.0.0.1:12809 --expected-ip 45.86.61.144
python3 ~/.local/share/neo3-agent-proxy/doctor.py

# VPS (support files in /usr/local/lib/neo3-agent-proxy)
python3 /usr/local/lib/neo3-agent-proxy/install.py --engine-home /home/agents \
  --proxy http://127.0.0.1:12809 --expected-ip 45.86.61.144
python3 /usr/local/lib/neo3-agent-proxy/doctor.py
```

Fresh installations default to the pinned port and IP. Existing installations
retain their settings, so pass both flags for migration. Reinstall is idempotent;
the existing Mac `scripts/update-engines.sh` restores wrappers after nightly
updates. No new update schedule is installed. Run the installer after manual
CLI/package updates on other hosts. Preserve `.neo3-direct` siblings: they are
the current native executables or upstream symlinks, not disposable backups.

Existing processes must be restarted with preserved sessions. On 2026-11-03,
VPS Claude/Krabik was idle and resumed with the same session ID through the
wrapper. The idle agents' Codex daemon and its updater were restarted with the
new proxy environment. Active work must not be interrupted or its lock removed.

## Checks and verification limits

```sh
python3 scripts/agent-proxy/test_proxy.py
sh -n scripts/agent-proxy/run.sh
plutil -lint scripts/agent-proxy/com.dimasik.neo3-agent-hysteria.plist
launchctl print gui/$(id -u)/com.dimasik.neo3-agent-hysteria
ssh vps-nl 'systemctl is-active neo3-agent-hysteria'
```

Verified: Mac CLI route, Node native fetch, Safari and VPS route all returned
`45.86.61.144`; installed CLI version commands still run; Anthropic/OpenAI/xAI
HTTPS endpoints are reachable. Real negative checks with an unavailable local
port and the old, wrong-IP proxy blocked Claude before launch. Regression tests
cover updates, idempotency, relative symlinks, wrong IP, unavailable proxy and
rejection of non-loopback endpoints.

HTTP 401/403 proves transport reachability only. It does not prove successful
login, account standing or inference. The newly purchased Claude account was
not logged in by this task. Krabik's historical account error is separate from
network routing and is not fixed by a proxy migration.

Official Hysteria client configuration:
https://v2.hysteria.network/docs/advanced/Full-Client-Config/

## Recovery

Prefer repairing the pinned transport over reverting to another exit. The old
proxy is retained only as an explicit, owner-approved rollback. To disable the
new route, restore marked launchers from `.neo3-direct` and stop only the new
Hysteria service; doing so removes the protection and requires owner approval.
Never stop or alter the shared Mac WhatsApp Xray as part of this rollback.
