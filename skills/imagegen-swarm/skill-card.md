---
name: imagegen-swarm
description: "Generate images and videos with the Codex, Jimeng, Grok, Gemini, Muse, and Lovart accounts you already have. An optional pay-per-image API line runs when a job names it, or when no enabled subscription engine can take that job, and only after you set a budget."
version: 1.3.0
homepage: https://github.com/Ekko237/imagegen-swarm
metadata:
  openclaw:
    emoji: "🖼️"
    homepage: https://github.com/Ekko237/imagegen-swarm
    requires:
      bins:
        - node
      anyBins:
        - python3
        - python
      config:
        - $HOME/.lovart/env
        - $HOME/.lovart/state.json
        - $HOME/.config/imagegen-swarm/api.json
        - $HOME/.config/imagegen-swarm/api-key
        - $HOME/.config/imagegen-swarm/api-spend.jsonl
        - $HOME/.config/imagegen-swarm/engine-off
        - $HOME/.config/imagegen-swarm/muse-browser
---

# imagegen-swarm

Batch image and video generation across the accounts you already have. The agent runs only the scripts in this folder, and only after you ask for an image or a video.

## Consent

- Add a provider only after you name that provider and agree.
- Paid images run only from `$HOME/.config/imagegen-swarm/api.json`, which you create. The cap is the configured estimate (`price_per_image` times images reserved in the batch, including ones still in flight), checked against `budget_per_batch` and `budget_per_month` before a paid image starts. The provider invoice can differ.
- The output directory is created before Muse starts. Muse clicks "Allow once" for a save of this run's output file, or for creating exactly `/home/hatch/workspace/imagegen-swarm`. Paths are compared after `~`, `.`/`..`, and symlink resolution. Any other directory or path stops. Ask before approving it.
- Muse deletes a side chat only when this run recorded that chat's id. If the id was never recorded, no chat is deleted.
- `IMAGE_GEN_MUSE_PROFILE` must resolve under `$HOME/.config/imagegen-swarm`, or be the legacy default `$HOME/.config/image-gen/muse-browser`.
- Lovart generation uploads only the reference files named for that job. It does not upload credentials or other local files.
- Series mode sends the shared style guide, and any series reference images, to each engine that runs a job in that batch.
- Lovart renames a remote project when its name is empty, `Untitled`, or a short prefix of the project id. `project-add` and `project-rename` also rename the remote project when keys are present. The agent does not run those two commands unless you asked.

## Files this skill touches

| File | Read or written | Why |
|---|---|---|
| `$HOME/.lovart/env` | You create it. Scripts read it as text | Lovart access key and secret. Mode 600. Not executed |
| `$HOME/.lovart/state.json` | Updated only if `$HOME/.lovart` already exists | Lovart project and thread ids |
| `$HOME/.config/imagegen-swarm/api.json` | You create it | Paid provider, model, estimated price, budgets. No API key |
| `$HOME/.config/imagegen-swarm/api-key` | You create it, mode 600, only if you choose a key file | Paid API key |
| `$HOME/.config/imagegen-swarm/api-spend.jsonl` | A finished paid image appends one line | Monthly estimate |
| `$HOME/.config/imagegen-swarm/engine-off/<engine>` | You create or delete the empty file | Pause one engine |
| `$HOME/.config/imagegen-swarm/muse-browser` | Created only by `scripts/muse-image.py --login` | Muse browser profile |

`node scripts/batch.mjs` keeps the environment of the process that launched it. It does not ask for confirmation on a machine that is already set up.
