# imagegen-swarm setup

This file is in the skill folder. For a plain-folder install, copy or symlink this folder to `~/.claude/skills/imagegen-swarm/` for Claude Code, or `~/.codex/skills/imagegen-swarm/` for Codex. The installed folder must be named `imagegen-swarm`. An older copy installed as `image-gen` can be moved to `imagegen-swarm`. Plugin commands are in the repository README. You need Node.js 18+ and Python 3 with Pillow (`python3 -m pip install pillow`) on macOS, Windows or Linux; on Windows the scripts call `python`, or set `PYTHON`. The Muse engine also needs Playwright. The skill contains no accounts or keys. Each engine keeps its login in its own folder, so never bundle those folders when you share the skill. Set up only the engines you want.

These are prerequisites for you to run. The agent runs the scripts in this folder and does not download or execute installers. If a step below is not done, the agent should ask you to do it.

| Engine | Install and log in | Login lives in |
|---|---|---|
| codex | Install the Codex CLI (`npm i -g @openai/codex`) or Codex.app, then `codex login`. The script looks for `--codex` / `CODEX_BIN`, then PATH, then `/Applications/Codex.app/Contents/Resources/codex`, `~/Applications`, and on Windows `~/AppData/Local/OpenAI/Codex/bin/*/codex.exe` | `~/.codex` |
| grok | Install the Grok Build CLI and log in; `grok models` should list models | `~/.grok` |
| gemini | Install the Antigravity CLI (default `~/.local/bin/agy`, or set `AGY_BIN` / `--agy`) and log in; `agy models` should list Gemini models | `~/.gemini` |
| jimeng | Install the pinned Dreamina binary below, reopen the terminal, then `dreamina login` (scan with the Douyin app); `dreamina user_credit` should show your credits. The script looks in `DREAMINA_INSTALL_DIR`, `~/bin`, `~/.local/bin`, then PATH | `~/.dreamina_cli` |
| muse | `pip install playwright && playwright install chromium`, then `python3 scripts/muse-image.py --login` and sign in to muse.ai in the window that opens; afterwards `--list-chats` should list your side chats | `~/.config/imagegen-swarm/muse-browser` |
| lovart | See below | `~/.lovart` |

## Jimeng binary

The Dreamina CLI is a binary you install yourself. Publisher `version.json` reports version **1.4.22** (release date 2026-10-28). The download names are not versioned, so the sha256 is the pin. If the checksum does not match, stop and do not install the file.

| Platform | File | sha256 |
|---|---|---|
| macOS Intel | `dreamina_cli_darwin_amd64` | `df195a76cfc23263b44663186f5136240aec935e2e019da071c4e5b2e1f067ff` |
| macOS Apple silicon | `dreamina_cli_darwin_arm64` | `85ba083d85e3a37a40edaac482ec832b9e6e8372e35c9e41159ce49b57a5fcb6` |
| Linux x64 | `dreamina_cli_linux_amd64` | `d831fd5f6820ddbd8afcc39afaf0194cd63b17f780057dcc6c486bc7e152d7b6` |
| Linux arm64 | `dreamina_cli_linux_arm64` | `55d086f054464e79f4099e50ce6c51d5e920ccfb59a24a154f4cfc4f8565c378` |
| Windows x64 | `dreamina_cli_windows_amd64.exe` | `27f92ce763035af10e41b31f4c161e8349d40e5fdaa90c5fa98e7869da5d492d` |

Base URL: `https://lf3-static.bytednsdoc.com/obj/eden-cn/psj_hupthlyk/ljhwZthlaukjlkulzlp/dreamina_cli_beta/`

Download one file, then compare the checksum. On macOS or Linux, `sha256sum` (or `shasum -a 256`) must print the hash in the table. Move the file to `~/.local/bin/dreamina` and mark it executable. On Windows, move `dreamina_cli_windows_amd64.exe` to `%USERPROFILE%\bin\dreamina.exe`. Reopen the terminal, run `dreamina login`, then `dreamina user_credit`.

## Lovart

The Lovart client is already in this folder at `scripts/lovart_agent.py`. It is the readable v1.1.1 client from [lovartai/lovart-skill](https://github.com/lovartai/lovart-skill/releases/tag/v1.1.1) (zip sha256 `d96eae1b382ba81829733f2c63e8520b0b7fae9acb77f0df23ad95ca3cdac0cd`). `lovart.mjs` runs that file. You do not need another copy.

On lovart.ai open the avatar menu → "OpenClaw for Lovart" → Create API Key → Copy. The entry is not under account settings, and the secret key is shown only once. Store it in a credentials file, never in chat or git:

```bash
mkdir -p ~/.lovart && umask 077 && cat > ~/.lovart/env <<'EOF'
export LOVART_ACCESS_KEY="ak_your_key"
export LOVART_SECRET_KEY="sk_your_key"
EOF
chmod 600 ~/.lovart/env
```

`lovart.mjs` reads that file as text and checks that its mode is owner-only. It does not execute the file. A mode such as `644` is refused; `600` is accepted. If the mode cannot be read, the client still runs, so a real API error such as no credits is not replaced by a permissions failure. The optional wrapper applies the same rule with `stat -c` on Linux and `stat -f` on macOS.

An optional wrapper is `references/lovart-lv.example.sh`. It runs `scripts/lovart_agent.py`. If you copy the wrapper out of this folder, set `LOVART_AGENT_SKILL` to the copy of `scripts/lovart_agent.py` inside the skill. Check the key with the shipped client:

```bash
python3 scripts/lovart_agent.py query-mode
```

`query-mode` returning JSON means the client and the key work. It does not prove the account has credits.

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
