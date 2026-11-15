---
name: imagegen-swarm
description: "Generate images and videos with the Codex, Jimeng, Grok, Gemini, Muse, and Lovart accounts you already have. An optional pay-per-image API line runs only after you set a budget."
version: 1.2.6
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
- Muse clicks "Allow once" only for a save of this run's exact output file, or a create of that file's directory. Any other request stops. Ask before approving it.
- On a Muse failure before the side-chat id is known, cleanup can remove a side chat created during that send window.
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
