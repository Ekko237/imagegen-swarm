# imagegen-swarm setup

This file is in the skill folder. For a plain-folder install, copy or symlink this folder to `~/.claude/skills/imagegen-swarm/` for Claude Code, or `~/.codex/skills/imagegen-swarm/` for Codex. The installed folder must be named `imagegen-swarm`. An older copy installed as `image-gen` can be moved to `imagegen-swarm`. Plugin commands are in the repository README. You need Node.js 18+ and Python 3 with Pillow (`python3 -m pip install pillow`) on macOS, Windows or Linux; on Windows the scripts call `python`, or set `PYTHON`. The Muse engine also needs Playwright. The skill contains no accounts or keys. Each engine keeps its login in its own folder, so never bundle those folders when you share the skill. Set up only the engines you want. Run the commands below from this folder.

| Engine | Install and log in | Login lives in |
|---|---|---|
| codex | Install the Codex CLI (`npm i -g @openai/codex`) or Codex.app, then `codex login`. The script looks for `--codex` / `CODEX_BIN`, then PATH, then `/Applications/Codex.app/Contents/Resources/codex`, `~/Applications`, and on Windows `~/AppData/Local/OpenAI/Codex/bin/*/codex.exe` | `~/.codex` |
| grok | Install the Grok Build CLI and log in; `grok models` should list models | `~/.grok` |
| gemini | Install the Antigravity CLI (default `~/.local/bin/agy`, or set `AGY_BIN` / `--agy`) and log in; `agy models` should list Gemini models | `~/.gemini` |
| jimeng | `curl -fsSL https://jimeng.jianying.com/cli | bash` (Git Bash on Windows), reopen the terminal, then `dreamina login` (scan with the Douyin app); `dreamina user_credit` should show your credits. The script looks in `DREAMINA_INSTALL_DIR`, `~/bin`, `~/.local/bin`, then PATH | `~/.dreamina_cli` |
| muse | `pip install playwright && playwright install chromium`, then `python3 scripts/muse-image.py --login` and sign in to muse.ai in the window that opens; afterwards `--list-chats` should list your side chats | `~/.config/imagegen-swarm/muse-browser` |
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

Then install the example wrapper (or point `LOVART_LV` / `--lv` at your own). It sources `~/.lovart/env` and execs `skills/lovart-skill/scripts/agent_skill.py`. The permission check uses `stat -c` on Linux and `stat -f` on macOS. If the mode cannot be read, the wrapper still runs the CLI, so a real API error such as no credits is not replaced by a permissions failure. A mode such as `644` is refused; `600` is accepted.

```bash
cp references/lovart-lv.example.sh ~/tools/lovart-skill/lv
chmod +x ~/tools/lovart-skill/lv
~/tools/lovart-skill/lv query-mode
```

`query-mode` returning JSON means the wrapper and the key work. It does not prove the account has credits.

## Pay-per-image API line (optional)

Keeps generating when every subscription runs out at once; you pay only for what you use. Off unless configured. Create a pay-as-you-go API key with your provider (OpenAI Platform or Google AI Studio), then write the config:

```bash
mkdir -p ~/.config/imagegen-swarm && cat > ~/.config/imagegen-swarm/api.json <<'EOF'
{
  "provider": "openai",
  "model": "gpt-image-2",
  "quality": "medium",
  "price_per_image": 0.05,
  "budget_per_batch": 1,
  "budget_per_month": 10,
  "lanes": 4
}
EOF
```

| Field | Meaning |
|---|---|
| `provider` | `openai` or `gemini` |
| `model` | openai e.g. `gpt-image-2`, `gpt-image-1.5`; gemini e.g. `gemini-nano-banana-2.1`, `gemini-3-pro-image` |
| `price_per_image` | estimated USD per image from your provider's price list for your quality and size; used for budgets and the ledger |
| `budget_per_batch` / `budget_per_month` | most USD one batch or one calendar month may spend; the line stops before going over |
| `quality` | openai only, default `medium` (`low` is cheaper, but gpt-image-2 at low shows blocky artifacts) |
| `image_size` | gemini only: `1K` (default), `2K`, `4K` |
| `base_url` | optional, an OpenAI-compatible gateway |
| `key_env` / `key_file` | which environment variable holds the key (default `OPENAI_API_KEY` / `GEMINI_API_KEY`), or a file with mode 600 |
| `lanes` | lane count, default 4 |
| `ratios` / `max_refs` | optional overrides when your model supports different ratios or reference counts than the built-in table |

To keep the key in a file:

```bash
umask 077 && printf '%s' 'your-key' > ~/.config/imagegen-swarm/api-key && chmod 600 ~/.config/imagegen-swarm/api-key
```

Then add `"key_file": "~/.config/imagegen-swarm/api-key"` to `api.json`. The spend ledger is `~/.config/imagegen-swarm/api-spend.jsonl`, one line per image.

## Check

```bash
node scripts/check.mjs
```
