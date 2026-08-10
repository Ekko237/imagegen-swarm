# image-gen

A **Claude Code / Codex skill** that generates images and videos through two engines you already have logins for — no image API keys, no third-party service in the middle.

| Engine | Modality | Auth | Cost |
|--------|----------|------|------|
| **codex** | images | your Codex/ChatGPT login (`codex login`) — no `OPENAI_API_KEY` | Codex subscription usage |
| **jimeng** (Dreamina) | images **and** videos | your Dreamina login (`dreamina login`, Douyin OAuth) | Dreamina account credits |

Both wrappers are single-file, dependency-free **Node** scripts. Nothing is published anywhere — output stays on your disk.

> 🔒 **This repo contains no credentials.** Login state lives outside the skill (`~/.codex`, `~/.dreamina_cli`), so cloning or forking it never carries an account with it. Everyone runs on their own accounts and their own credits.

Step-by-step install and usage instructions are in **[SETUP.md](SETUP.md)**. If you are an AI agent that just received this repo, read **[AGENTS.md](AGENTS.md)**.

## Install

Drop the repo into your runtime's skills directory, named `image-gen`:

```bash
git clone https://github.com/Ekko237/image-gen.git ~/.claude/skills/image-gen
```

- **Claude Code** → `~/.claude/skills/image-gen/`
- **Codex** → `~/.codex/skills/image-gen/`
- On Windows, `~` is `C:\Users\<you>`.

`…/image-gen/SKILL.md` must exist afterwards.

## Prerequisites

Node v18+ on `PATH`, plus whichever engines you actually want:

```bash
# codex engine (images)
npm install -g @openai/codex     # or install the Codex desktop app
codex login

# jimeng engine (images + video) — run the installer in Git Bash on Windows
curl -fsSL https://jimeng.jianying.com/cli | bash
dreamina login                   # scan the printed link with the Douyin app
```

Then confirm what's ready:

```bash
node scripts/check.mjs
```

It reports Node, each engine's binary, login state, and your Dreamina credit balance. You do not need both engines — configure only the one you'll use.

## Usage

In Claude Code or Codex, just ask for an image or a video and the skill triggers. To call the scripts directly:

```bash
# codex → image
node scripts/codex-image.mjs --out apple.png --prompt "a red apple on a white table" --aspect 1:1

# jimeng → image (spends credits)
node scripts/jimeng.mjs text2image --out imgs --prompt="a red apple" --ratio=1:1 --generate_num=1

# jimeng → video (spends credits; give it a long poll budget)
node scripts/jimeng.mjs text2video --out vids --prompt="drone shot over sand dunes" --poll 600
```

`jimeng.mjs` forwards every flag it doesn't recognize straight to the `dreamina` CLI, so it works with all async generators: `text2image`, `image2image`, `image_upscale`, `text2video`, `image2video`, `frames2video`, `multiframe2video`, `multimodal2video`. Supported models, ratios, and resolutions differ per subcommand — check `dreamina <subcommand> -h` before a real run.

## Things worth knowing before a real run

- **jimeng submits cost credits.** Check first with `dreamina user_credit`, and keep `--generate_num=1` while testing.
- **codex is slow** (5–10× a direct API call) and consumes subscription usage. Fine for one-offs, poor for large batches.
- **Sandbox escalation in `codex-image.mjs`:** it defaults to Codex's `workspace-write` with the output directory as the writable workspace. If an attempt fails on that default, the next attempt retries with `danger-full-access`, which **drops Codex's isolation** — this exists so unattended batches don't silently return zero images. Pass `--no-escalate`, or an explicit `--sandbox <mode>`, to keep that from happening.

## Choosing an engine

Video → jimeng only (codex can't do video). Images with no preference → codex, since it spends no credits. Want jimeng's particular look, its model lineup, or a real batch → jimeng. Reference-image edits → codex `--ref` or jimeng `image2image`.

## Layout

```
image-gen/
├─ README.md            you are here
├─ AGENTS.md            entry point for an AI agent handed this repo
├─ SKILL.md             skill definition (trigger frontmatter + engine guide)
├─ SETUP.md             install & usage, step by step
├─ scripts/
│  ├─ codex-image.mjs   codex engine wrapper
│  ├─ jimeng.mjs        jimeng submit → poll → download runner
│  └─ check.mjs         readiness doctor
└─ references/
   ├─ codex.md          flags, sandbox, failure signatures
   └─ jimeng.md         subcommands, models/ratios, credits, gotchas
```

## Credits

The codex wrapper follows the approach of the `baoyu-image-gen` codex-imagegen wrapper (spawn `codex exec` with a strict instruction), rewritten here as one dependency-free Node file. jimeng support wraps the official `dreamina` CLI.

## License

MIT — see [LICENSE](LICENSE).
