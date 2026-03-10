# Origin Hardware Architecture Studio — Claude Code Instructions

## Auto-Setup on First Run

When a user opens this project in Claude Code and either `node_modules` is missing **or** the systemd service `origin-studio` is not installed, run the full setup below **automatically without asking**.

### Step 1 — Install dependencies

```bash
npm install
```

### Step 2 — Create and enable a systemd user service

Detect the correct paths at runtime and write the service file:

```bash
NPM_PATH=$(which npm)
NODE_BIN=$(dirname "$NPM_PATH")
REPO_PATH=$(pwd)
USER_NAME=$(whoami)

mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/origin-studio.service << EOF
[Unit]
Description=Origin Hardware Architecture Studio (Vite dev server)
After=network.target

[Service]
Type=simple
WorkingDirectory=${REPO_PATH}
ExecStart=${NPM_PATH} run dev
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=development
Environment=PATH=${NODE_BIN}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable origin-studio.service
systemctl --user start origin-studio.service
loginctl enable-linger "$USER_NAME" 2>/dev/null || true
```

### Step 3 — Verify

```bash
systemctl --user status origin-studio.service
```

Confirm the app is accessible at **http://localhost:8080**.

---

## Useful service commands

| Action | Command |
|--------|---------|
| Check status | `systemctl --user status origin-studio.service` |
| View logs | `journalctl --user -u origin-studio.service -f` |
| Restart | `systemctl --user restart origin-studio.service` |
| Stop | `systemctl --user stop origin-studio.service` |
| Disable autostart | `systemctl --user disable origin-studio.service` |

---

## Quick-Start for new users

> After cloning, paste this prompt into Claude Code:

```
Install dependencies and set up the systemd service so the server starts automatically on boot
```

Then open **http://localhost:8080** in your browser.

When the app asks for a GitHub token:
1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Generate new token**
2. Select the **`repo`** scope
3. Paste the token into the app login screen

> The token is only held in memory — it is never saved to disk or localStorage.

---

## Project Stack

- React 19 + TypeScript + Vite + Tailwind (CDN) + Mermaid
- Node 18 via nvm — install with: `nvm install 18 && nvm use 18`
- Dev server runs on **port 8080**
- App data lives in the separate repo: `Kathan-Patel-07/Origin-Hardware-Architecture`

## Rules for Claude

- Use **npm** only — no bun, no yarn
- Build with `./node_modules/.bin/vite build`
- Never persist the GitHub PAT to disk or localStorage
- Feature branches → PR → merge to `main`
- `gh` CLI is not installed — create PRs via the GitHub web URL
