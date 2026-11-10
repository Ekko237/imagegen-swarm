# image-gen

A **Claude Code / Codex skill** that generates images, reference edits and videos through engines you already have accounts for. No image API keys; output stays on your disk.

| Engine | Can do | Runs through |
|---|---|---|
| **codex** | images, reference images | Codex CLI's built-in `image_gen` (your Codex/ChatGPT login) |
| **grok** | images, edits, reference-to-video | Grok Build CLI's Imagine tools |
| **gemini** | images, edits (up to 3 references) | Antigravity CLI's `generate_image` |
| **muse** | images, reference images | Muse (muse.ai) driven by a headless browser |
| **lovart** | images, reference images | the official Lovart CLI (your AK/SK) |

> 🔒 This repo contains no credentials. Each engine keeps its login outside the skill, so cloning or forking it never carries an account with it.

## Install

```bash
git clone https://github.com/Ekko237/image-gen.git ~/.claude/skills/image-gen   # Claude Code
git clone https://github.com/Ekko237/image-gen.git ~/.codex/skills/image-gen    # Codex
```

Set up the engines you want with [SETUP.md](SETUP.md), then check which are ready:

```bash
node scripts/check.mjs
```

## Usage

Ask your agent for an image or a video and the skill triggers. For a batch, write a job list and let every engine grab work at once:

```bash
echo '[{"id":"apple","prompt":"a red apple on a white table","aspect":"1:1"},
       {"id":"kite","prompt":"a red kite in a clear sky","aspect":"3:4"}]' > jobs.json
node scripts/batch.mjs --jobs jobs.json --out out/
```

Or call one engine directly:

```bash
node scripts/gemini-image.mjs --prompt "a red apple on a white table" --out apple.png --aspect 1:1
node scripts/codex-image.mjs  --prompt "a red apple on a white table" --out apple.png --aspect 1:1 --json
node scripts/grok-image.mjs   --prompt "the apple rolls to the right" --ref apple.png --video --out apple.mp4
python3 scripts/muse-image.py --prompt "a red apple, watercolor" --out apple.png --aspect 4:3
node scripts/lovart.mjs       --prompt "a red apple, flat illustration" --out apple.png --json
```

Every script makes one image per call, prints one JSON line, exits non-zero on failure, and verifies the image is new from this run. Engine choice, flags and caveats are in [SKILL.md](SKILL.md).

## Tests

```bash
node evals/run.mjs out/            # all fixed tasks
node evals/run.mjs out/ --only gemini-t2i,grok-t2i
```

The runner checks status, aspect ratio, prompt passthrough, Muse cleanup and a mixed batch, and writes `results.json` for a judge to score each image with the rubric in `evals/evals.json`.

## Layout

```
image-gen/
├─ SKILL.md            skill definition and engine guide
├─ SETUP.md            install and login per engine
├─ AGENTS.md           entry point for an agent handed this repo
├─ scripts/            batch.mjs (work-stealing across engines), codex-image.mjs, grok-image.mjs,
│                      gemini-image.mjs, muse-image.py, lovart.mjs, check.mjs
├─ references/         codex.md, lovart.md
└─ evals/              evals.json (tasks + rubric), run.mjs
```

## Credits

The Codex instruction template follows the `baoyu-image-gen` codex-imagegen wrapper; see [NOTICE](NOTICE) for the upstream MIT attribution.

## License

MIT, see [LICENSE](LICENSE).
