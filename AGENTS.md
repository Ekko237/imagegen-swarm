# image-gen — instructions for an AI agent

> If you are an AI agent (**Codex** or **Claude Code**) and you were just handed this repo, follow this file and you can install and use it directly. It is a skill that generates images and video through two engines. Human readers should start at [README.md](README.md).

## What this is

| Engine | Can produce | Auth (each user's own account) | Cost |
|--------|-------------|--------------------------------|------|
| **codex** | images | Codex/ChatGPT login (no OpenAI key) | subscription usage |
| **jimeng** (Dreamina) | images **+ video** | `dreamina login` (Douyin QR scan) | account credits |

Layout:
```
image-gen/
├─ README.md      ← project home (human entry point)
├─ AGENTS.md      ← you are here, agent entry point
├─ SKILL.md       ← skill definition (frontmatter with trigger phrases)
├─ SETUP.md       ← install steps
├─ scripts/       ← codex-image.mjs / jimeng.mjs / check.mjs (need Node)
└─ references/    ← codex.md / jimeng.md, engine details
```
🔒 No accounts or keys are included. Login state lives in the user's `~/.codex` and `~/.dreamina_cli`, not in this folder.

## Step 1 — install (put this folder in the skills directory)

Move the whole repo (folder named `image-gen`) into the skills directory of your runtime:

- **Claude Code** → `~/.claude/skills/image-gen/`
- **Codex** → `~/.codex/skills/image-gen/`
- On Windows, `~` is `C:\Users\<username>`.

Then confirm `.../image-gen/SKILL.md` exists.

## Step 2 — check prerequisites (once per user; you may check on their behalf)

- **To use jimeng (images/video):** install the dreamina CLI and log in.
  - On Windows the installer must run in **Git Bash**: `curl -fsSL https://jimeng.jianying.com/cli | bash`, then **reopen the terminal** and run `dreamina login` (Douyin QR scan).
- **To use codex for images:** `npm install -g @openai/codex` (or install the Codex desktop app) plus `codex login`.
- If **Node** is available, run the one-shot doctor: `node scripts/check.mjs` (reports each engine's binary, login state, credit balance, and which engine is ready). No Node is fine too — see "call the CLI directly" below.

## Step 3 — how to use it

Two paths, pick by environment. **With Node the scripts are easier; without Node, call the CLI directly** — same result.

### jimeng (images + video) — identical on both runtimes

- With Node:
  ```bash
  node scripts/jimeng.mjs text2image --out imgs --prompt="a red apple" --ratio=1:1 --generate_num=1
  node scripts/jimeng.mjs text2video --out vids --prompt="drone over dunes" --poll 600
  ```
  Subcommands: `text2image image2image image_upscale text2video image2video frames2video multiframe2video multimodal2video`. The script handles submit → poll → download into `--out` automatically.
- Without Node (call dreamina directly) — the async flow is three steps:
  1. `dreamina <subcommand> -h` first, to see that command's models / ratios / resolutions;
  2. Submit: `dreamina text2image --prompt="..." --ratio=1:1 --resolution_type=2k --generate_num=1` → note the `submit_id` (`gen_status` should be querying/success);
  3. Poll and download: every few seconds run `dreamina query_result --submit_id=<id> --download_dir=<output dir>` until `gen_status=success`.
- Notes: real runs spend credits (check `dreamina user_credit` first); an `AigcComplianceConfirmationRequired` response means the user must complete a one-time authorization on the Dreamina website; give video generation a generous poll budget.

### codex (images only)

- **If you are Codex yourself:** just call your built-in **`image_gen`** tool and save the result to the target path. Simplest path — no script needed.
- **If you are Claude Code (or something else):**
  - With Node: `node scripts/codex-image.mjs --out apple.png --prompt "a red apple" --aspect 1:1` (defaults to the safe `workspace-write` sandbox; add `--ref` for reference images).
  - Without Node: `codex exec --json --sandbox workspace-write --skip-git-repo-check -C <output dir> -`, piping an instruction on stdin that says "call image_gen → copy the PNG to the target path → reply with JSON" (full template in `references/codex.md`, or `buildInstruction` inside `scripts/codex-image.mjs`).
  - If the `codex` command isn't found: try PATH first; on Windows the desktop app's binary is at `~/AppData/Local/OpenAI/Codex/bin/<hash>/codex.exe` (pick the newest).

## Choosing an engine

Video → jimeng only. Images with no preference stated → default to codex (spends no credits). Want jimeng's particular look or a real batch → jimeng. Reference-image edits → codex `--ref` or jimeng `image2image`.

More detail: `SKILL.md`, `references/codex.md`, `references/jimeng.md`.
