# Contributing

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Use [issues](https://github.com/Ekko237/imagegen-swarm/issues) for bugs and feature proposals; search existing issues first. Remove credentials, tokens, cookies, account IDs, and personal information from reports and logs.

## Set up and run

Use Node.js 18+ and Python 3; CI uses Node.js 22 on Ubuntu. There is no package manifest or install.sh. Install Pillow (README, Install; also used in CI):

```bash
python3 -m pip install pillow
```

To install the skill in your agent, the README provides:

```bash
npx skills add https://github.com/Ekko237/imagegen-swarm -a claude-code -a codex
```

For development against this checkout, copy or symlink `skills/imagegen-swarm` into your agent's skills directory as described in [README.md](README.md#install). At least one engine must be logged in for generation; follow [SETUP.md](skills/imagegen-swarm/SETUP.md). Keep logins and keys outside the repository.

From the repository root, check engine readiness (README, Install):

```bash
node skills/imagegen-swarm/scripts/check.mjs
```

Create `jobs.json` using the [README usage example](README.md#usage), then run its batch command from the repository root:

```bash
node skills/imagegen-swarm/scripts/batch.mjs --jobs jobs.json --out out/
```

Look at every generated image before sharing it. Generation uses your engine accounts and quotas; a configured paid API line can spend its configured budget.

## Checks and tests

Run these from the repository root. They are the commands in [.github/workflows/check-skill.yml](.github/workflows/check-skill.yml), with the syntax-check step copied verbatim. Install Pillow above first. The reliability and series tests use fixtures rather than live providers.

```bash
node .github/check-frontmatter.mjs
```

```bash
set -euo pipefail
for f in skills/imagegen-swarm/scripts/*.mjs; do
  node --check "$f"
done
python3 -m py_compile skills/imagegen-swarm/scripts/*.py
```

```bash
node tests/reliability.test.mjs
node tests/series.test.mjs
python3 tests/reliability_rename_test.py
```

Optional live evals from the README's Tests section (not CI; require configured engines and may consume credits or paid API budget):

```bash
node tests/evals/run.mjs out/
node tests/evals/run.mjs out/ --only gemini-t2i,batch-mixed
```

The second command selects a subset instead of running all tasks. Inspect the outputs against the eval rubric. Remove generated Python bytecode caches before submitting; keep generated media and local credentials out of PRs.

## Branches and pull requests

- Work on a descriptively named branch and open a focused PR against `main`.
- Explain the problem and resulting behavior, link a related issue when available, and report the checks you ran. Include reproduction steps for fixes and tests for changed behavior.
- Update the relevant English and Chinese docs when behavior or setup changes. Preserve the skill folder name and plugin paths checked by CI; keep repository tests and examples outside the published skill folder.
- If you change folder structure, update the README tree in the same PR.
- For release changes, follow [CHANGELOG.md](CHANGELOG.md)'s `version - YYYY-MM-DD` headings and keep version fields in `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, and `.claude-plugin/marketplace.json` aligned. Ordinary contributions need no speculative version bump.
