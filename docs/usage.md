# Usage

[English](usage.md) | [简体中文](usage.zh-CN.md)

Ask your agent for images to trigger the skill automatically, or run a batch directly from the CLI. From the repository root:

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

Each job requires `id` and `prompt`; `aspect`, `ref`, `video`, and `engine` are optional. Output saves to `out/<id>.png`, progress streams as JSON lines, and `out/batch-results.json` records which engine made each image, how long that attempt took, and the `keep` counts in [Keep rate](keep-rate.md).

The ID must be a string of 1–100 characters. Start with a Unicode letter or number and use only letters, numbers, `.`, `_` and `-` after that. For example, `cover-1` and `中文图1` are valid.

You can also call a single engine directly: `node skills/imagegen-swarm/scripts/gemini-image.mjs --prompt "..." --out a.png --aspect 1:1`. Full options are in [SKILL.md](../skills/imagegen-swarm/SKILL.md). When running from the installed skill folder, drop the `skills/imagegen-swarm/` prefix.

A one-job check is on the [README](../README.md#quick-use).
