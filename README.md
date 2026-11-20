# imagegen-swarm

[English](README.md) | [简体中文](README.zh-CN.md)

Got image-gen quota across several AI tools that goes unused? imagegen-swarm is a Claude Code / Codex skill that puts them all on one queue and fails over when one runs out.

<p align="center">
  <img src="docs/showcase.webp" alt="A grid of 12 images drawn by imagegen-swarm, each tile labeled with the engine that drew it: gemini, jimeng, codex, grok, lovart or muse" width="520" />
</p>

```bash
npx skills add Ekko237/imagegen-swarm@v1.4.1 -a claude-code -a codex
```

If it helps, a ★ Star helps others find it.

## What problem it solves

Image quotas are scattered across tools, and the weekly or monthly allowance mostly sits unused until it expires. A single engine is slow, and the batch stops when that engine runs out partway through. Switching by hand to the next tool and picking the unfinished jobs back up is tedious.

## Who it's for

Node.js 18+ and Python 3 with Pillow (`python3 -m pip install pillow`), on macOS, Windows, or Linux. Log in to at least one engine before generating. Lovart requires its official AK/SK. You only need one engine logged in. Every engine you add makes generation faster. Credential paths are in [SETUP.md](skills/imagegen-swarm/SETUP.md).

## Quick use

Ask your agent to draw a lemon slice on a blue background. You should get a new PNG, and the run log will record which engine made it. The same job from the repository root:

```bash
cat > jobs.json <<'EOF'
[
  {"id": "lemon", "prompt": "a lemon slice on a blue background, flat illustration", "aspect": "1:1"}
]
EOF
node skills/imagegen-swarm/scripts/batch.mjs --jobs jobs.json --out out/
```

The file is `out/lemon.png`. In the installed skill folder, drop the `skills/imagegen-swarm/` prefix. Job fields, the longer example, and calling one engine: [Usage](docs/usage.md).

## Engines

| Engine | Can do | Runs through |
| --- | --- | --- |
| **codex** | images, reference images | Codex CLI's built-in `image_gen` (your Codex / ChatGPT login) |
| **jimeng** | images, edits (up to 10 references), text- and image-to-video | the official Dreamina CLI (your Douyin login) |
| **grok** | images, edits, reference-to-video | Grok Build CLI's Imagine tools |
| **gemini** | images, edits (up to 3 references) | Antigravity CLI's `generate_image` |
| **muse** | images, reference images | Muse (muse.ai) driven by a headless browser |
| **lovart** | images, reference images | the official Lovart CLI (your AK/SK) |
| **api** (optional, paid) | images, edits | OpenAI Images API or Gemini API with your own key, pay per image |

## Tested results

50 images in 2.3 minutes, 11× faster than one engine alone (generation time only; see [Keep rate](docs/keep-rate.md)).

<p align="center">
  <img src="docs/efficiency.png" alt="50 images in 2.3 minutes of generation time only, 11 times faster than one engine alone, on an 8 GB M1 MacBook Pro" width="100%" />
</p>

<p align="center">
  <em>Generation time only, from one test run. The 2.3 minutes and the 11× line end when the files are written. Screening and style redos sit outside that clock. See <a href="docs/keep-rate.md">Keep rate</a>.</em>
</p>

Each engine opens multiple lanes. Every free lane grabs the next job in the queue. If an engine runs out of quota, the others take over. In the 50-image test run above, Gemini and Lovart hit their limits partway through, and the remaining engines still delivered all 50 images.

The 2.3 minutes on that chart is generation time only: the wall clock until the last of those 50 files was written. Screening the images, and regenerating any that miss a character or a brand, sit outside that clock. The 11× line compares that 2.3 minutes with 26.7 minutes for one engine, using Gemini, the fastest engine in that run, at its measured 32 seconds per image. Both sides are generation time only. The run's log is not in this repository, so the chart has no keep rate. [Keep rate](docs/keep-rate.md) explains how to count one.

It is one test run, so your numbers will differ: your speed will depend on your account quotas. In this run, Lovart and Muse were on free plans, and Gemini and Lovart ran out midway. With more quota, all engines stay active to the end and generation usually finishes faster.

![Timeline of the 50-image batch: each block is one image, each row is one lane, all rows running at once](docs/timeline.png)

## Community

Tried it? Open an issue and tell me what broke or what you made. For a bug, attach `out/batch-results.json` after removing keys (including AK/SK), tokens, cookies, account IDs, and personal information. Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Setup and quota questions: [Common questions](docs/faq.md).

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Ekko237/imagegen-swarm?style=flat&color=24292f" alt="MIT license" /></a>
  &nbsp;
  <a href="https://github.com/Ekko237/imagegen-swarm/releases/latest"><img src="https://img.shields.io/github/v/release/Ekko237/imagegen-swarm?style=flat&color=24292f" alt="Latest release" /></a>
  &nbsp;
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/changelog-CHANGELOG.md-24292f?style=flat" alt="Changelog" /></a>
</p>

MIT, see [LICENSE](LICENSE). The Codex instruction template follows the `baoyu-image-gen` codex-imagegen wrapper; see [NOTICE](NOTICE) for the upstream MIT attribution.

## More

- Parallel lanes, quota failover, file checks, memory, resume, and the optional paid API: [Why](docs/how-it-works.md).
- Plugin, folder, and Windows installs, and the pinned release: [Install](docs/install.md).
- Job fields, the longer batch, and calling one engine: [Usage](docs/usage.md).
- Shared style across a series, off unless you agree: [Series mode](docs/series-mode.md).
- What `keep` counts, and how to measure one yourself: [Keep rate](docs/keep-rate.md).
- Setup, logins, quotas, and API keys: [Common questions](docs/faq.md).
- Test commands: [Tests](docs/tests.md).
- Repository tree: [Layout](docs/layout.md).
