# Client onboarding runbook (Model B: one VPS per client)

Scope: v1 = **Claude only**. Cursor/Codex/OpenCode/Kimi are visible in the Agents settings
tab but unverified end-to-end — do not promise them to a client yet (see "Out of scope"
below). This is the same isolation model already proven for slavik/jook
(`~/.claude/.../memory/watchdog-and-multiuser.md`, `CLOUDCLI-MULTIUSER-BLUEPRINT.md` §2.5):
**one dedicated VPS per client, one shared team login, their own git repo, their own
Anthropic account.** No in-app multi-user work needed for v1 — that's a separate,
not-yet-built feature (see blueprint).

Target: go from "signed contract" to "client has a working URL" in hours, not days, with a
fixed checklist so nothing gets improvised live in front of the client.

---

## 0. One-time prerequisites (not per client)

- Pin a **golden commit** on `dima/fork-customizations` in the private backup repo
  (`github.com/dimasikk25155/cloudcli-fork`) — the same commit currently smoke-verified on
  `claude.neo3.ru`. New clients get this exact commit, never `origin/main` (upstream) and
  never an unreviewed WIP tip.
- Cloudflare access to `neo3.ru` DNS ready (for `<client>.neo3.ru` subdomains) — see
  `cloudflare-dns` skill.
- You have personally walked the "how the client pays for their own Claude" path at least
  once (see step 12) so you're not improvising it live.

## 1. Provision the VPS

- Ubuntu 22.04/24.04 LTS, 2 vCPU / 2–4GB RAM / 40GB disk is comfortably enough — the app
  itself is a light Node process, the model runs on Anthropic's side, not on this box.
- Root SSH access, add your key.

## 2. Base server setup

```bash
apt update && apt install -y build-essential python3 python3-setuptools \
  git jq ripgrep sqlite3 curl

# Node 22 (matches .nvmrc)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# dedicated non-root user to run the service
adduser --disabled-password --gecos "" cloudcli
```

## 3. Get the code

The backup repo (`github.com/dimasikk25155/cloudcli-fork`) is **private** — a plain
`git clone https://...` fails on a fresh VPS with no stored GitHub credentials
("could not read Username for 'https://github.com'"). Use a read-only deploy key,
generated fresh per VPS:

```bash
# as root, before switching to the cloudcli user:
ssh-keygen -t ed25519 -f /home/cloudcli/.ssh/cloudcli_deploy -N "" -C "cloudcli-deploy-<client>"
chown cloudcli:cloudcli /home/cloudcli/.ssh/cloudcli_deploy*
cat /home/cloudcli/.ssh/cloudcli_deploy.pub   # paste this ↓
```

Paste the printed public key into GitHub → the `cloudcli-fork` repo → **Settings → Deploy
keys → Add deploy key** (leave "Allow write access" unchecked — read-only is all this needs).
One key per client VPS, not reused across clients.

```bash
su - cloudcli
cat >> ~/.ssh/config <<'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/cloudcli_deploy
  StrictHostKeyChecking accept-new
EOF
chmod 600 ~/.ssh/config

git clone git@github.com:dimasikk25155/cloudcli-fork.git ~/cloudcli
cd ~/cloudcli
git checkout <golden-commit-sha>   # NOT main, NOT dima/fork-customizations tip blindly
```

## 4. Install + build

```bash
npm install
```

Watch for the same native-module gotcha documented in `FORK-NOTES.md` (ripgrep binary
download 403s on Dima's own network due to DNS filtering — may or may not happen on this
VPS's network, depends on its provider):

```bash
# only if the plain npm install above fails/aborts:
npm install --ignore-scripts
npm rebuild better-sqlite3
cp "$(which rg)" node_modules/@vscode/ripgrep/bin/rg
```

(`scripts/fix-node-pty.js` postinstall is macOS-only — it no-ops on Linux, nothing to redo
there.)

```bash
npm run build
```

## 5. Configure `.env`

```bash
SERVER_PORT=3001
VITE_PORT=5173
HOST=127.0.0.1          # bind localhost only — Caddy (step 8) terminates public HTTPS
WORKSPACES_ROOT=/home/cloudcli/workspace
DISABLE_TERMINAL=1      # no raw shell for a non-technical client team (safer default)
```

Do **not** set `VITE_IS_PLATFORM` — leave it unset/false. That flag collapses every request
onto "the first user" and is only relevant to the in-app multi-user work that isn't built
(see blueprint, §1 "Platform mode").

## 6. Client workspace ("мозг их бизнеса")

This is **just a folder** — there is no separate knowledge-base/document ingestion feature.
"Their business brain" = their own git repo, checked out here:

```bash
mkdir -p /home/cloudcli/workspace
cd /home/cloudcli/workspace
git clone <client-repo-url> project     # or `git init` if they don't have one yet
```

Say this plainly to the client: it's their private folder on their own server, the agent
reads/writes it like any coding project. Don't oversell it as more than that.

### Built-in project memory

`install.sh` already installed it (step 4) — nothing to do per project. Each project
gets a `memory/` folder of plain `.md` notes on first session; the agent reads the
index automatically at the start of every session and is forced to record what it
learned at the end. Details and manual install: `templates/memory/README.md`.

Worth saying to the client in one line: *"агент помнит этот проект между сессиями —
заметки лежат у вас же в папке `memory/`, обычными файлами, никакой базы данных"*.
Boxes provisioned before 2026-07-26 need one manual run (see that README).

## 7. systemd service

`/etc/systemd/system/cloudcli.service`:

```ini
[Unit]
Description=CloudCLI (client instance)
After=network.target

[Service]
Type=simple
User=cloudcli
WorkingDirectory=/home/cloudcli/cloudcli
EnvironmentFile=/home/cloudcli/cloudcli/.env
ExecStart=/usr/bin/node dist-server/server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now cloudcli
systemctl status cloudcli   # confirm it's up before moving on
```

## 8. Domain + HTTPS

Simplest path — Caddy on the VPS itself terminates HTTPS (no need to replicate Dima's own
Cloudflare-Tunnel/Tailscale mesh, that's specific to running instances across his own
multiple machines):

Caddy is **not** in Ubuntu's default apt repos — `apt install -y caddy` fails outright with
a plain "Unable to locate package" until the official Caddy repo is added first:

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install -y caddy
```

`/etc/caddy/Caddyfile`:

```
client.neo3.ru {
    reverse_proxy 127.0.0.1:3001
}
```

Add the DNS `A` record for `client.neo3.ru` → this VPS's IP (Cloudflare, via the
`cloudflare-dns` skill), then:

```bash
systemctl reload caddy
```

Caddy issues and renews the Let's Encrypt cert automatically once DNS resolves.

*(Verified 2026-07-22: `caddy validate` confirms this Caddyfile is syntactically correct
and Caddy installs cleanly with the repo steps above. The actual DNS→Let's Encrypt
handshake needs a real public IP and hasn't been run end-to-end — do that once on the
first real client VPS and drop this note.)*

## 9. First login + connect the client's own Claude account

- Visit `https://client.neo3.ru` — first visitor sets the admin password (registration
  locks after that: "single-user system" is **fine here**, the whole client team shares this
  one login for v1, same as slavik/jook today).
- Settings → **Агенты** → Claude → **"Войти снова"** → client follows the on-screen Anthropic
  login link in their own browser, using their own account/subscription.
- This stores credentials in `~/.claude` **on this VPS only** — confirms real isolation:
  nothing shared with Dima's own account or any other client's box.

## 10. Mobile + push

- Default for v1: **PWA only** ("add to home screen" from the phone browser) — push
  notifications work through this without any extra build step.
- A dedicated branded TWA Android APK (like `ClaudeCLI.apk`) needs its own package id +
  signed keystore per client — real extra work (see `twa-push-android.md`), treat as a paid
  upsell later once the process is repeatable, not a default for client #1.
- Verify: send a real task from the phone, lock the screen, confirm the push notification
  arrives when it finishes.

## 11. Smoke test before handing over (do not skip)

This mirrors the discipline in `deploy.sh` — the goal is "no bugs" in front of the client:

- [ ] Send a real task, get a real response.
- [ ] Mid-run, background the browser tab / lock the phone for 60s+, come back — chat must
      not be stuck ("Running" forever) — this is exactly the freeze class fixed 2026-07-12
      (`FORK-NOTES.md` "Freeze-proofing").
- [ ] `systemctl restart cloudcli`, confirm it comes back on its own and the client can
      resume/reload without data loss.
- [ ] Confirm `DISABLE_TERMINAL=1` actually hides the terminal tab if that's what was
      configured.

## 12. Handoff conversation with the client

- This is their own server — their code/data stays on it, not shared with any other client.
- They pay you for setup + hosting + support. They pay Anthropic directly for their own
  Claude usage — **walk them through exactly how** (direct Anthropic account needs a
  non-Russian card; OpenRouter is the more RU-payment-friendly alternative) — don't leave
  this vague, it's the one part of onboarding a non-technical client can't self-serve.
- Give them the admin password in writing.

## 13. Register the instance

Keep a simple list (domain, VPS IP/provider, SSH key, golden commit deployed, date) so that
when you fix a bug once, you can push it to every client instance instead of remembering by
hand — same idea as `fleet-status`'s `services.yaml` for your own bots.

---

## Explicitly out of scope for v1 — do not promise

- **Cursor / Codex / OpenCode / Kimi** — present in the UI, not battle-tested. Only Claude
  has been through real bug-fixing (freeze-proofing, watchdogs, TWA push). Position as
  "coming soon, free upgrade when ready," not as available today.
- **Per-employee individual logins on one instance** — needs Multiuser Blueprint Phase 1
  (`CLOUDCLI-MULTIUSER-BLUEPRINT.md`), not built. If a client insists on it, that's a scoped
  follow-up project, not part of standard onboarding.
- **Uploading business documents into a separate knowledge base** — doesn't exist. What
  exists is a private git folder the agent reads as normal project files (step 6).
