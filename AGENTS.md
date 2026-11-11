# imagegen-swarm for AI agents

If you are an AI agent (Codex or Claude Code) handed this repo:

1. Install: put this folder, named `imagegen-swarm`, at `~/.claude/skills/imagegen-swarm/` (Claude Code) or `~/.codex/skills/imagegen-swarm/` (Codex), and confirm `SKILL.md` is there. An older copy under `image-gen` can be moved to `imagegen-swarm`.
2. Check: install Pillow (`python3 -m pip install pillow`), then run `node scripts/check.mjs` to see which engines are logged in. Set up missing ones with [SETUP.md](SETUP.md). Logins belong to the user: let them sign in themselves, and never copy their keys into this folder.
3. Use: follow [SKILL.md](SKILL.md) to pick an engine and call its script. Look at every image before you deliver it.

If you are Codex yourself, you can also call your own built-in `image_gen` tool directly and save the result to the target path.
