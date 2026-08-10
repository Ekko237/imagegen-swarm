# image-gen — setup & usage

A Claude Code / Codex skill that generates images and video through two engines:

- **codex** — images, using your own Codex/ChatGPT login (no OpenAI API key needed)
- **jimeng** (Dreamina) — images **and** video, using your own Dreamina login

> 🔒 **This repo contains no accounts and no keys.** Everyone logs in with their own account: codex draws on your own subscription, jimeng spends your own credits. Sharing this repo cannot leak a session — login state lives in `~/.codex` and `~/.dreamina_cli`, outside the skill folder.

---

## 1. Install the skill

Drop the whole repo (folder named `image-gen`) into your runtime's skills directory:

- **Claude Code** → `~/.claude/skills/image-gen/`
  - Windows: `C:\Users\<you>\.claude\skills\image-gen\`
  - macOS/Linux: `~/.claude/skills/image-gen/`
- **Codex** (instead of Claude Code) → `~/.codex/skills/image-gen/`

Afterwards `…/image-gen/SKILL.md` must exist.

## 2. Prerequisites (once per user)

### 2.1 Node.js (both engines)
The scripts run on Node. Check with `node --version` (v18+ recommended). If it's missing, install from nodejs.org.

### 2.2 codex engine (only if you want codex images)
Install the Codex CLI and log in with your own ChatGPT/Codex account:
```bash
npm install -g @openai/codex   # or install the Codex desktop app
codex login
```
> On Windows, if you have the Codex desktop app the script finds its binary automatically — the npm install is optional.

### 2.3 jimeng / Dreamina engine (needed for Dreamina images and for any video)
Install the official dreamina CLI and log in with your own Douyin account:
```bash
# ⚠️ On Windows this must run in Git Bash — PowerShell's curl is an alias and there is no bash
curl -fsSL https://jimeng.jianying.com/cli | bash
```
**Open a new terminal** after installing (so PATH takes effect), then log in:
```bash
dreamina login          # prints a link; scan it with the Douyin app to authorize
```
Login waits until you confirm on your phone, then reports success. Check your balance any time with `dreamina user_credit`.

## 3. Readiness check

Run this once installed — it tells you at a glance which engine is ready:
```bash
node ~/.claude/skills/image-gen/scripts/check.mjs
```
Anything marked ❌ comes with the exact fix (install or log in). You do **not** need both engines — configure only the one you'll use.

## 4. Usage

In Claude Code, just ask for an image or a video and the skill triggers. To call the scripts directly:

```bash
# codex → image
node ~/.claude/skills/image-gen/scripts/codex-image.mjs --out apple.png --prompt "a red apple on a white table" --aspect 1:1

# jimeng → image (spends credits)
node ~/.claude/skills/image-gen/scripts/jimeng.mjs text2image --out imgs --prompt="a red apple" --ratio=1:1 --generate_num=1

# jimeng → video (spends credits; give it a long poll budget)
node ~/.claude/skills/image-gen/scripts/jimeng.mjs text2video --out vids --prompt="drone shot over sand dunes" --poll 600
```

Details are in `SKILL.md` and `references/`. Supported models, ratios, and resolutions differ per jimeng subcommand — confirm with `dreamina <subcommand> -h` before a real run.

## Troubleshooting

- **`node: command not found`** → Node isn't installed or isn't on PATH. Install it and reopen the terminal.
- **codex step fails / says not logged in** → run `codex login`. If the sandbox blocked the write, the script automatically retries the next attempt with `--sandbox danger-full-access` (isolation dropped); pass `--no-escalate` if you don't want that.
- **jimeng says not logged in / `user_credit` errors** → run `dreamina login` (or `dreamina relogin` if the session expired).
- **jimeng returns `AigcComplianceConfirmationRequired`** → complete the one-time authorization on the Dreamina website, then retry.
- **`dreamina` not found on Windows** → reopen the terminal after installing; the scripts also auto-detect `~/bin/dreamina.exe`.
