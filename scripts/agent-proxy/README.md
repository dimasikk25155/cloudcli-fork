# One exit IP for coding agents

The owner-selected default is **Netherlands 45.86.61.144**. On 2026-11-04 the
owner replaced the first standby with **Finland 185.166.154.209** and required a
single local control panel, independent of Happ and AI access. There is no
automatic country change and no direct-provider fallback.

## User control

Open `~/Applications/Резервный мост ИИ.app` (Desktop shortcut).

- **Нидерланды · основной** selects 45.86.61.144 on Mac and VPS.
- **Финляндия · резерв** selects 185.166.154.209 on both.
- **Проверить статус** measures actual exit IPs, shows failures and checks that
  the active Mac network service sends browser HTTP/HTTPS through the same bridge.

The app also checks status when opened. Finish current AI responses before a
country change, which resets tunnel connections. No Happ action, copied key,
terminal command or AI request is needed. The chosen profile survives restart.
A working Internet connection and Tailscale access to the VPS are required for
coordinated switching; an unreachable VPS is reported rather than falsely
claiming that both machines switched.

## Transport

- **Mac:** loopback HTTP proxy `127.0.0.1:12809`. Existing LaunchAgent
  `com.dimasik.neo3-agent-hysteria` runs `transport.py`, which supervises a
  standalone sing-box Hysteria2 client. It binds its outbound socket to the
  physical Ethernet/Wi-Fi interface (`bind_interface`), never an `utun` VPN.
  Changes of physical interface/address restart only this client. There is one
  encrypted outbound and no direct fallback. Internet loss is retried without
  changing the selected country.
- **Mac browser:** the physical network service's HTTP and HTTPS proxies point
  to `127.0.0.1:12809`. This applies to browsers and other applications respecting
  macOS web proxy settings, not only AI domains. The setup is repeated on bridge
  startup, physical-network changes and country selection. No PAC/direct fallback
  is configured. Prior Wi-Fi settings are recorded locally in
  `browser-proxy-previous.json` (both proxies were disabled, old port 12334).
- **VPS:** existing `/usr/local/bin/hysteria` v2.12.3 and
  `neo3-agent-hysteria.service`, loopback HTTP `12809`, DynamicUser/LoadCredential.
  The Finland client connects to the server's existing Hysteria service; its
  ordinary public egress must still be verified, not assumed from the host IP.
- Primary endpoint: `45.86.61.144:443`, TLS SNI `mya1a.neo3.ru`.
- Standby endpoint: `185.166.154.209:8443`, TLS SNI `fi.neo3.ru`. Uses the existing
  private profile; no new VPN server, ports, users or websites were installed.
- Both profiles verify TLS normally. No `insecure:true` or custom CA is required.
- The shared Mac WhatsApp Xray on `11809` is unchanged.
- Neo3 `dist`/`dist-server` and its runtime were not rebuilt or restarted.

The Mac standalone binary was copied from the already installed Happ bundle,
version **sing-box 1.12.12**, revision `54ed58499d7063136ed52dabf87d179d252425d0`.
It now lives at `~/.local/share/neo3-agent-proxy/sing-box`: Happ is not launched,
queried or used by the bridge. The old official Hysteria binary remains for
explicit rollback. Do not use that old launcher when claiming VPN independence.

Configuration and support files:

- Mac support: `~/.local/share/neo3-agent-proxy/`.
- Mac active secret: `~/Antigravity Project/.secrets.d/neo3-agent-hysteria.json`.
- Mac private profiles: `.secrets.d/neo3-agent-profiles/{primary,reserve}.json`.
- VPS support: `/usr/local/lib/neo3-agent-proxy/`.
- VPS active secret: `/etc/neo3-agent-proxy/hysteria.json`.
- VPS private profiles: `/etc/neo3-agent-proxy/profiles/{primary,reserve}.json`.
- Private directories 0700, credential files 0600. Never commit profile values.
- Logs: Mac support directory `hysteria.log`; VPS journal for its client service.

The first standby `45.86.63.89` was removed from the switcher's choices. Its
existing NordMax VPN and independent private import files were not altered.

## Coordinated switch and interruption recovery

`switch.py` automatically sets the Mac browser proxy, probes both proposed
routes, stages persistent blocking markers, applies both serving clients,
verifies their actual IPs, then permits new standard CLI launches. SSH control
uses existing alias/key `vps-nl` through Tailscale `100.75.69.57`, with
`HostKeyAlias=185.166.154.209`. Thus control does not depend on the selected VPN
exit or the public SSH port being reachable from the local ISP.

After an interruption, `switch-recovery.json`/`switch-in-progress` keep launchers
blocked. Press the desired country again: resume the same operation or retarget
it to the other verified bridge. Never delete the markers to bypass a failure.
Recovery journals contain no credentials. The panel continues to show local
status if the remote server cannot be reached. It never labels a saved expected
IP as a successful live network check.

## Launchers and guarantee boundary

`run.sh` checks actual IP through the explicit proxy before launching Claude,
Codex, Grok, Gemini, OpenCode, Cursor/agent, Kimi and Neo3's bundled Codex. Exact
paths are recorded in `installation.json`; VPS also covers agents' local CLIs.
Unavailable/wrong IP or an unfinished switch exits 78 before agent execution.
Both probe endpoints use the same explicit proxy. Upper/lower HTTP(S)/ALL_PROXY,
`NO_PROXY` for localhost/Tailscale, and `NODE_USE_ENV_PROXY=1` are exported.

This is **not an OS firewall**. Deliberately executing `.neo3-direct`, new
unregistered binaries, programs ignoring proxy settings or stale environments
is outside this guarantee. Existing sessions are not killed by the coordinator.
Future machines must be installed and verified before account login. System web
proxies are per network service; the supervisor follows active physical services
when OS permissions allow, and the dashboard reports a failed browser setup.
A network blocking both VPN endpoints cannot be fixed by changing a local button.

## Installation and updates

Provision the two private profiles and the client binary appropriate to the host.
For Mac, install standalone sing-box in the support directory and load the
LaunchAgent template here (adjust paths for another user). For Linux, install the
existing Hysteria client and systemd template. Keep credentials outside Git.

From the repository root:

```sh
python3 scripts/agent-proxy/install.py --sdk-root "$PWD" \
  --proxy http://127.0.0.1:12809 --expected-ip 45.86.61.144
sh scripts/agent-proxy/build-switcher.sh
python3 ~/.local/share/neo3-agent-proxy/switch.py status
```

On VPS use its installed `install.py --engine-home /home/agents`. Existing
installations retain selected IP/port if flags are omitted. Mac's existing nightly
engine updater restores wrappers; no new timer was installed. Reinstall wrappers
after manual CLI/package updates elsewhere. Preserve `.neo3-direct` siblings,
which are current native binaries/symlinks, not disposable backups.

## Verification

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/agent-proxy/test_switch.py
PYTHONDONTWRITEBYTECODE=1 python3 scripts/agent-proxy/test_proxy.py
python3 ~/.local/share/neo3-agent-proxy/switch.py probe reserve
python3 ~/.local/share/neo3-agent-proxy/switch.py status
```

The test suite covers fail-closed launches, unavailable/wrong IP, wrapper repairs,
interrupted switch/resume/return, physical interface binding instead of VPN,
browser service selection and live-status mismatch reporting. Real checks on
2026-11-04 confirmed both bridges from the physical Mac network, both exits on
VPS, and serving-client switches in both directions with Happ disconnected.
Safari was checked through the system web proxy, not through an environment-only
curl request. The primary is restored after verification.

Transport success is not proof of provider account standing, subscription limits
or a completed login. No purchased Claude account was logged in by this task.

References: [Hysteria client config](https://v2.hysteria.network/docs/advanced/Full-Client-Config/),
[sing-box Hysteria2](https://sing-box.sagernet.org/configuration/outbound/hysteria2/),
[physical interface binding](https://sing-box.sagernet.org/configuration/shared/dial/).
