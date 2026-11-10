# imagegen-swarm setup

Put this folder, named `image-gen`, in your agent's skills directory: `~/.claude/skills/image-gen/` for Claude Code, `~/.codex/skills/image-gen/` for Codex. You need Node.js 18+ and Python 3 with Pillow (`python3 -m pip install pillow`) on macOS, Windows or Linux; on Windows the scripts call `python`, or set `PYTHON`. The Muse engine also needs Playwright. The skill contains no accounts or keys. Each engine keeps its login in its own folder, so never bundle those folders when you share the skill. Set up only the engines you want.

| Engine | Install and log in | Login lives in |
|---|---|---|
| codex | Install the Codex CLI (`npm i -g @openai/codex`) or Codex.app, then `codex login`. The script looks for `--codex` / `CODEX_BIN`, then PATH, then `/Applications/Codex.app/Contents/Resources/codex`, `~/Applications`, and on Windows `~/AppData/Local/OpenAI/Codex/bin/*/codex.exe` | `~/.codex` |
| grok | Install the Grok Build CLI and log in; `grok models` should list models | `~/.grok` |
| gemini | Install the Antigravity CLI (default `~/.local/bin/agy`, or set `AGY_BIN` / `--agy`) and log in; `agy models` should list Gemini models | `~/.gemini` |
| jimeng | `curl -fsSL https://jimeng.jianying.com/cli | bash` (Git Bash on Windows), reopen the terminal, then `dreamina login` (scan with the Douyin app); `dreamina user_credit` should show your credits. The script looks in `DREAMINA_INSTALL_DIR`, `~/bin`, `~/.local/bin`, then PATH | `~/.dreamina_cli` |
| muse | `pip install playwright && playwright install chromium`, then `python3 scripts/muse-image.py --login` and sign in to muse.ai in the window that opens; afterwards `--list-chats` should list your side chats | `~/.config/image-gen/muse-browser` |
| lovart | See below | `~/.lovart` |

## Lovart

```bash
git clone https://github.com/lovartai/lovart-skill.git ~/tools/lovart-skill
```

On lovart.ai open the avatar menu → "OpenClaw for Lovart" → Create API Key → Copy. The entry is not under account settings, and the secret key is shown only once. Store it in a credentials file, never in chat or git:

```bash
mkdir -p ~/.lovart && umask 077 && cat > ~/.lovart/env <<'EOF'
export LOVART_ACCESS_KEY="ak_your_key"
export LOVART_SECRET_KEY="sk_your_key"
EOF
chmod 600 ~/.lovart/env
```

Then create a wrapper `~/tools/lovart-skill/lv` that sources that file and execs `skills/lovart-skill/scripts/agent_skill.py`, and `chmod +x` it (or point `LOVART_LV` / `--lv` at your own wrapper). `~/tools/lovart-skill/lv query-mode` returning JSON means it works.

## Check

```bash
node scripts/check.mjs
```
