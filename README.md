# imagegen-swarm

**English** · [简体中文](README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-skill-D97757)](SKILL.md)
[![Codex](https://img.shields.io/badge/Codex-skill-111111)](SKILL.md)

**Generate images and videos inside Claude Code / Codex using logins you already have — no API keys.**

This is a skill named `image-gen`. It puts one job list in front of every engine you are already logged into — Codex, Grok, Gemini, Muse, and Lovart — and a free lane takes the next image it can handle. Video is reference-to-video on Grok. Codex, Grok, Gemini, and Muse use the product login already on your machine. Lovart, if you enable it, reads an access key stored outside this repo.

<!--
DEMO: record a real Claude Code or Codex session, save it as docs/demo.gif,
then uncomment the next line. Do not commit a generated stand-in.
See docs/README.md.
![Demo of generating an image in Claude Code or Codex](docs/demo.gif)
-->

A session GIF is not in the repo yet ([how to add one](docs/README.md)). The stills below already live in `docs/`.

![Ten images from one batch, each labeled with the engine that made it](docs/showcase.jpg)

![Timeline of that batch across Codex, Grok, and Muse lanes](docs/timeline.png)

## Why

Each image product you already use has its own quota, and a single engine stops when that quota runs out. imagegen-swarm puts the engines you have logged in on one queue:

- **Parallel.** Gemini, Codex, Grok, and Lovart run 2 lanes each. Muse runs 1, because it has a single browser profile.
- **Quota-aware.** An engine that reports exhausted quota, a missing login, or a missing install is shut down, and its job goes back on the queue.
- **Checked.** Each image has to be new for this run. If a requested aspect ratio is off by more than 3%, the file is discarded and another engine tries it. Images are saved as real PNG files. Video is MP4.
- **Resumable.** Run the same job list again and finished files are skipped.

You only need one engine. Each extra logged-in engine can take work the others cannot.

## Quick start

You need Node.js 18 or newer and Python 3. The folder must be named `image-gen`. On Windows, run the shell commands in Git Bash, or clone into `%USERPROFILE%\.claude\skills\image-gen` (Codex: `%USERPROFILE%\.codex\skills\image-gen`).

### 1. Clone it into the skills folder

Claude Code:

```bash
mkdir -p ~/.claude/skills
git clone https://github.com/Ekko237/imagegen-swarm.git ~/.claude/skills/image-gen
```

Codex:

```bash
mkdir -p ~/.codex/skills
git clone https://github.com/Ekko237/imagegen-swarm.git ~/.codex/skills/image-gen
```

Run both blocks if you use both agents.

### 2. Install Pillow

Every engine uses it to convert and check images.

```bash
python3 -m pip install pillow
```

On Windows the scripts call `python` unless you set `PYTHON`, so install with `python -m pip install pillow` there.

### 3. See which engines are ready

Claude Code install:

```bash
node ~/.claude/skills/image-gen/scripts/check.mjs
```

Codex install:

```bash
node ~/.codex/skills/image-gen/scripts/check.mjs
```

One `READY` engine is enough. The check reports login state, not remaining quota. Sign in to anything marked not ready with [SETUP.md](SETUP.md). Muse also needs Playwright (`pip install playwright && playwright install chromium`).

## Usage

In Claude Code or Codex, ask in plain language. The skill is meant to trigger on requests like "generate an image", "draw", "edit this image", and "make a video", and when you name an engine (`codex`, `grok`, `gemini`, `muse`, `lovart`):

> Generate an image of a lemon slice on a blue background, flat illustration, square.

> Edit that image: the same lemon slice, but at night.

> Make a 16:9 video from this kite image.

Naming an engine runs only that engine. What you get back is a PNG for an image, or an MP4 for video. The skill tells the agent to write the batch under `out/`:

| Result | Path |
|---|---|
| Image | `out/<id>.png` |
| Video | `out/<id>.mp4` |
| Which engine made each file, and how many seconds it took | `out/batch-results.json` |

Progress is one JSON object per line. Video runs on Grok only, needs one reference image, and is 6 seconds at 720p.

The same batch, run yourself from the skill directory:

```bash
cd ~/.claude/skills/image-gen   # or ~/.codex/skills/image-gen
cat > jobs.json <<'EOF'
[
  {"id": "lemon", "prompt": "a lemon slice on a blue background, flat illustration", "aspect": "1:1"},
  {"id": "kite",  "prompt": "a red kite in a clear sky, minimal", "aspect": "3:4"},
  {"id": "whale", "prompt": "a blue whale in the deep ocean, low poly", "aspect": "16:9"},
  {"id": "night", "prompt": "the same lemon slice, but at night", "ref": ["out/lemon.png"]}
]
EOF
node scripts/batch.mjs --jobs jobs.json --out out/
```

Each job needs `id` and `prompt`. `aspect`, `ref`, `video`, and `engine` are optional. `ref` paths are relative to the job file. A single engine script also runs on its own, for example `node scripts/gemini-image.mjs --prompt "..." --out a.png --aspect 1:1`. Flags, lane counts, and retries are in [SKILL.md](SKILL.md).

## Engines

| Engine | Can do | Login | Aspect ratio | Rough time |
|---|---|---|---|---|
| **codex** | images, reference images | Codex CLI (`codex login`). Does not read `OPENAI_API_KEY` | `--aspect`, size chosen by the model | ~30 s |
| **grok** | images, edits (1 reference), reference-to-video | Grok Build CLI (`grok models` lists models) | real `--ratio`: 1:1, 16:9, 9:16, 3:2, 2:3 | ~45 s |
| **gemini** | images, edits (up to 3 references) | Antigravity CLI (`agy`) | real `--aspect`: 1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9 | 20–45 s |
| **muse** | images, reference images | Browser login to muse.ai (`python3 scripts/muse-image.py --login`) | written into the task; same seven ratios as Gemini | 1–2 min |
| **lovart** | images, reference images | Access key and secret in `~/.lovart/env` | written into the prompt only | ~35 s |

Rough times are the expectations already written in [SKILL.md](SKILL.md), not a benchmark from this README. Per-engine notes: [references/codex.md](references/codex.md), [references/lovart.md](references/lovart.md).

## FAQ

### What does it cost?

The repo is MIT and does not bill you. Generation uses the quota of the product you log into: Codex plan usage, an X / Grok plan, Antigravity (Gemini) quota, Muse's weekly limit, or Lovart credits. Lovart's `fast` mode spends credits. Its `unlimited` mode applies only to some models and can queue, so it is not a plan you can count on. Details are in [references/lovart.md](references/lovart.md).

### Where do logins and prompts go?

Logins stay in each product's own directory: `~/.codex`, `~/.grok`, `~/.gemini`, `~/.config/image-gen/muse-browser`, and `~/.lovart`. This repository contains no accounts. Prompts are sent to the engine that runs the job. Muse drives muse.ai in a headless browser. Grok video needs Grok data sharing set to Opt in. On a zero-data-retention error the script reports it and does not change that setting.

### Where are files saved?

You pick the directory with `--out`. A batch writes `<out>/<id>.png`, or `<out>/<id>.mp4` when the job sets `"video": true`, plus `<out>/batch-results.json`. A non-empty file already at that path is left in place, so a rerun continues. Codex copies the new image out of `$CODEX_HOME/generated_images` (default `~/.codex/generated_images`) and rejects a file that matches an older one.

### Which operating systems?

macOS, Windows, and Linux for the Node engines (Codex, Grok, Gemini, Lovart) and for `batch.mjs`. Install Node.js 18+ and Python 3 with Pillow. On Windows those scripts call `python` unless `PYTHON` is set. Muse imports `fcntl` to lock its browser profile and the readiness check launches it with `python3`, so use Muse on macOS or Linux, with Playwright and Chromium installed.

## Contributing

Issues and pull requests are welcome, including install problems and engine bugs. Please use the [bug report form](https://github.com/Ekko237/imagegen-swarm/issues/new?template=bug_report.md) and leave out keys, `auth.json`, and home-directory paths. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT © 2026 Ekko237. See [LICENSE](LICENSE). The Codex instruction template follows the `baoyu-image-gen` wrapper; upstream attribution is in [NOTICE](NOTICE).
