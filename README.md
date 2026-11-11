# imagegen-swarm

[![MIT license](https://img.shields.io/github/license/Ekko237/imagegen-swarm)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/Ekko237/imagegen-swarm)](https://github.com/Ekko237/imagegen-swarm/releases/latest)
[![Changelog](https://img.shields.io/badge/changelog-CHANGELOG.md-blue)](CHANGELOG.md)

[中文说明](README.zh-CN.md)

**No image API key for most engines.**

Generate images in Claude Code with the Codex and Jimeng accounts you already have.

Jimeng also generates videos.
Grok, Gemini and Muse use their own account logins.
Lovart uses its official AK/SK, stored on your machine.

This is a Claude Code and Codex skill.
It hands a list of images to all six engines at once.
A free engine takes the next image.
A batch finishes in minutes.
When one engine runs out of quota, the others pick up its work.

![50 images in 2.3 minutes, 11 times faster than one engine alone, on an 8 GB M1 MacBook Pro](docs/efficiency.png)

## How the work is shared

Every engine opens a few lanes. Each lane takes the next image in the queue, and when one engine runs out of quota the others take over. This is the real 50-image batch from the card above: Gemini and Lovart ran out partway through, and all 50 images were still delivered.

It is one test run, so your numbers will differ: speed depends on how much quota you have with each engine. In this run Lovart and Muse were on free plans and Gemini and Lovart ran out midway. With more quota, every engine keeps working to the end and a batch usually finishes faster.

![Timeline of the 50-image batch: each block is one image, each row is one lane, all rows running at once](docs/timeline.png)

## Why

Each image tool has its own quota that resets weekly or monthly, and most of it goes unused. One engine alone is slow and stops at its limit. imagegen-swarm puts all of them on one queue:

- **Parallel**: every engine runs a few lanes at once; a free lane grabs the next job it can handle.
- **Quota-aware**: an engine that reports exhausted quota or a missing login is shut down, and its job goes back to the queue.
- **Correct**: every image is checked to be new from this run, wrong aspect ratios are redone by another engine, and output is always real PNG.
- **Fits your machine**: lane counts scale with your RAM, from 12 lanes on a 4 GB laptop to 34 on 16 GB or more. Want to keep memory free for other apps? Run with `IMAGE_GEN_MEMORY_GB=4`, or set exact counts with `--lanes gemini=2,codex=2`.
- **Resumable**: rerun the same job list and finished images are skipped.

## Engines

| Engine | Can do | Runs through |
|---|---|---|
| **codex** | images, reference images | Codex CLI's built-in `image_gen` (your Codex / ChatGPT login) |
| **jimeng** | images, edits (up to 10 references), text- and image-to-video | the official Dreamina CLI (your Douyin login) |
| **grok** | images, edits, reference-to-video | Grok Build CLI's Imagine tools |
| **gemini** | images, edits (up to 3 references) | Antigravity CLI's `generate_image` |
| **muse** | images, reference images | Muse (muse.ai) driven by a headless browser |
| **lovart** | images, reference images | the official Lovart CLI (your AK/SK) |

You only need one. Every engine you add makes batches faster.

## Install

Claude Code:

```bash
claude plugin install imagegen-swarm --marketplace Ekko237/imagegen-swarm
```

Codex:

```bash
codex plugin marketplace add Ekko237/imagegen-swarm
codex plugin add imagegen-swarm@imagegen-swarm
```

These commands install the skill. You still need Node.js 18+ and Python 3 with Pillow (`python3 -m pip install pillow`) on macOS, Windows or Linux. Log in to at least one engine before you generate. Lovart needs its official AK/SK.

Verify: ask your agent to draw a lemon slice on a blue background. You should get a new PNG, and the run records which engine made it.

<details>
<summary>Folder install, npx, and Windows</summary>

### Folder

Copy or symlink `skills/imagegen-swarm` into the agent skills directory. The folder must be named `imagegen-swarm`.

```bash
git clone https://github.com/Ekko237/imagegen-swarm.git
mkdir -p ~/.claude/skills ~/.codex/skills
ln -s "$PWD/imagegen-swarm/skills/imagegen-swarm" ~/.claude/skills/imagegen-swarm
ln -s "$PWD/imagegen-swarm/skills/imagegen-swarm" ~/.codex/skills/imagegen-swarm
```

To copy instead of symlink, use `cp -a` in place of `ln -s`. Update a symlink install with `git pull` inside the clone. Update a copy by copying the folder again. An older install named `image-gen` should be renamed to `imagegen-swarm`.

### npx skills

```bash
npx skills add https://github.com/Ekko237/imagegen-swarm -a claude-code -a codex
```

### Windows

Copy `skills/imagegen-swarm` to `%USERPROFILE%\.claude\skills\imagegen-swarm` or `%USERPROFILE%\.codex\skills\imagegen-swarm`. On Windows the scripts call `python`, or set `PYTHON`. Install Pillow with `python -m pip install pillow`. The Jimeng installer needs Git Bash. Engine login steps are in [SETUP.md](skills/imagegen-swarm/SETUP.md).

See which engines are ready, from the skill folder:

```bash
node scripts/check.mjs
```

From a clone of this repo, the same check is `node skills/imagegen-swarm/scripts/check.mjs`.

</details>

## Usage

Ask your agent for images and the skill triggers. Or run a batch yourself:

```bash
cat > jobs.json <<'EOF'
[
  {"id": "lemon",  "prompt": "a lemon slice on a blue background, flat illustration", "aspect": "1:1"},
  {"id": "kite",   "prompt": "a red kite in a clear sky, minimal",                    "aspect": "3:4"},
  {"id": "whale",  "prompt": "a blue whale in the deep ocean, low poly",              "aspect": "16:9"},
  {"id": "night",  "prompt": "the same lemon slice, but at night", "ref": ["out/lemon.png"]}
]
EOF
node skills/imagegen-swarm/scripts/batch.mjs --jobs jobs.json --out out/
```

Each job needs `id` and `prompt`; `aspect`, `ref`, `video` and `engine` are optional. Output lands in `out/<id>.png`, progress prints as JSON lines, and `out/batch-results.json` records which engine made each image. Single engines also work on their own, e.g. `node skills/imagegen-swarm/scripts/gemini-image.mjs --prompt "..." --out a.png --aspect 1:1`. Full options are in [SKILL.md](skills/imagegen-swarm/SKILL.md). From the installed skill folder, drop the `skills/imagegen-swarm/` prefix.

## Tests

```bash
node skills/imagegen-swarm/evals/run.mjs out/                         # every fixed task, including a mixed batch
node skills/imagegen-swarm/evals/run.mjs out/ --only gemini-t2i,batch-mixed
```

## Layout

```
├─ skills/imagegen-swarm/   the skill: SKILL.md, SETUP.md, scripts, references, evals
├─ docs/                    README images
├─ AGENTS.md                entry point for an agent handed this repo
├─ CHANGELOG.md             release notes
├─ .claude-plugin/          Claude Code plugin manifest (skills: ./skills/imagegen-swarm)
├─ .codex-plugin/           Codex plugin manifest (skills: ./skills/)
├─ .agents/                 Codex marketplace manifest
└─ .github/                 CI and bug report template
```

## Sample output

![Images drawn by imagegen-swarm, each labeled with the engine that made it](docs/showcase.webp)

## Common questions

**Do I need every engine logged in?**

No. One is enough. Every engine you add makes a batch faster. Set up only the ones you want. `node skills/imagegen-swarm/scripts/check.mjs` shows which ones are ready. An engine with no login is shut down, and its job goes back to the queue.

**Is my login safe?**

The skill contains no accounts or keys. Each engine keeps its login in its own folder. Do not bundle those folders when you share the skill. Lovart's AK/SK go in `~/.lovart/env` with mode `600`, not in chat and not in git. The folders are listed in [SETUP.md](skills/imagegen-swarm/SETUP.md).

**What happens when a quota runs out?**

An engine that reports exhausted quota, no login, or no install is shut down. The image it held goes back to the queue. A failed image is retried on an engine that has not tried it yet, up to `--tries` engines (default 3). When every engine is out of quota, generate in the ChatGPT, Gemini, or Grok web app in a new tab, download and check the image, then close the tab. An engine error is not an empty quota. If the engine you named fails, the skill reports that error.

**Do I need an API key?**

Most engines, no. Codex and Jimeng use the accounts you already have. Grok, Gemini and Muse use their own account logins. Lovart needs its official AK/SK, stored on your machine.

**Which agents does this run in?**

Claude Code and Codex.

## Credits

The Codex instruction template follows the `baoyu-image-gen` codex-imagegen wrapper; see [NOTICE](NOTICE) for the upstream MIT attribution.

## License

MIT, see [LICENSE](LICENSE).

Tried it? Open an issue and tell me what broke or what you made.
