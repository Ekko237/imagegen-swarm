# imagegen-swarm for AI agents

If you are an AI agent (Codex or Claude Code) handed this repo:

1. Install: copy or symlink `skills/imagegen-swarm` to `~/.claude/skills/imagegen-swarm/` (Claude Code) or `~/.codex/skills/imagegen-swarm/` (Codex), and confirm `SKILL.md` is there. An older copy under `image-gen` can be moved to `imagegen-swarm`. Plugin install commands are in [README.md](README.md).
2. Check: install Pillow (`python3 -m pip install pillow`), then from the skill folder run `node scripts/check.mjs` to see which engines are logged in. Set up missing ones with [skills/imagegen-swarm/SETUP.md](skills/imagegen-swarm/SETUP.md). Logins belong to the user: let them sign in themselves, and never copy their keys into this folder.
3. Use: follow [skills/imagegen-swarm/SKILL.md](skills/imagegen-swarm/SKILL.md) to pick an engine and call its script. Look at every image before you deliver it.

If you are Codex yourself, you can also call your own built-in `image_gen` tool directly and save the result to the target path.
