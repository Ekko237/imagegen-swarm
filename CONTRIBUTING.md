# Contributing

Issues and pull requests are welcome.

- Bug reports: use the [bug report form](https://github.com/Ekko237/imagegen-swarm/issues/new?template=bug_report.md) ([template source](.github/ISSUE_TEMPLATE/bug_report.md)). Include the operating system, the engine, and the JSON line the script printed.
- Leave out logins, `auth.json`, API keys, and the contents of `~/.lovart/env`. Paths under your home directory are not needed.
- Do not commit generated images or videos. `out/` and loose media files are gitignored. The stills in `docs/` stay; a session GIF belongs at `docs/demo.gif` (see [docs/README.md](docs/README.md)).
- This skill's behavior is defined in [SKILL.md](SKILL.md). A change to how images are generated should update that file. After a behavior change, run `node evals/run.mjs <outdir>`. Doc-only changes do not need a generation run.

Local checkout: Node.js 18+, `python3 -m pip install pillow`, then `node scripts/check.mjs`. Per-engine login steps are in [SETUP.md](SETUP.md).
