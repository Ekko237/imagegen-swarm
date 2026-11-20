# Install

[English](install.md) | [简体中文](install.zh-CN.md)

The [README](../README.md) uses one pinned install command. This page is that command, the plugin and folder installs, and what the pin means.

```bash
npx skills add Ekko237/imagegen-swarm@v1.4.1 -a claude-code -a codex
```

That installs the skill with the npx skills CLI and works across Claude Code, Codex and other agents. Prefer a plugin? Use one of the two blocks below instead.

Every install command here is pinned to release v1.4.1, so you get exactly the code in that tag, which you can review first at https://github.com/Ekko237/imagegen-swarm/tree/v1.4.1. To upgrade, read the new release's notes at https://github.com/Ekko237/imagegen-swarm/releases and replace v1.4.1 with its tag.

## Claude Code plugin

Run these inside Claude Code to install it as a plugin from this repo's marketplace:

```text
/plugin marketplace add Ekko237/imagegen-swarm#v1.4.1
/plugin install imagegen-swarm@imagegen-swarm
```

## Codex plugin

Run these in your shell to install it as a Codex plugin from the same repo:

```bash
codex plugin marketplace add Ekko237/imagegen-swarm --ref v1.4.1
codex plugin add imagegen-swarm@imagegen-swarm
```

Any of these installs the skill. You still need Node.js 18+ and Python 3 with Pillow (`python3 -m pip install pillow`) on macOS, Windows, or Linux. Log in to at least one engine before generating. Lovart requires its official AK/SK.

Verify: ask your agent to draw a lemon slice on a blue background. You should get a new PNG, and the run log will record which engine made it.

## Folder install, npx, and Windows

### Folder

Copy or symlink `skills/imagegen-swarm` into your agent skills directory. The folder must be named `imagegen-swarm`.

```bash
git clone --branch v1.4.1 --depth 1 https://github.com/Ekko237/imagegen-swarm.git
mkdir -p ~/.claude/skills ~/.codex/skills
ln -s "$PWD/imagegen-swarm/skills/imagegen-swarm" ~/.claude/skills/imagegen-swarm
ln -s "$PWD/imagegen-swarm/skills/imagegen-swarm" ~/.codex/skills/imagegen-swarm
```

To copy instead of symlink, replace `ln -s` with `cp -a`. Update a symlink install by deleting the clone and cloning a newer tag the same way, or update a copy by copying the folder again. If you have an older install named `image-gen`, rename it to `imagegen-swarm`.

### npx skills

```bash
npx skills add Ekko237/imagegen-swarm@v1.4.1 -a claude-code -a codex
```

### Windows

Copy `skills/imagegen-swarm` to `%USERPROFILE%\.claude\skills\imagegen-swarm` or `%USERPROFILE%\.codex\skills\imagegen-swarm`. On Windows, the scripts call `python` (or use the `PYTHON` env var). Install Pillow with `python -m pip install pillow`. The Jimeng binary for Windows is `dreamina.exe`; the pinned checksum is in [SETUP.md](../skills/imagegen-swarm/SETUP.md).

Check which engines are ready from the skill folder:

```bash
node scripts/check.mjs
```

From a repo clone, run `node skills/imagegen-swarm/scripts/check.mjs`.
