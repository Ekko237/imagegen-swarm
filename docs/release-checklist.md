# Release checklist

[English](release-checklist.md) | [简体中文](release-checklist.zh-CN.md)

1. Align the versions in `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`,
   `.claude-plugin/marketplace.json` and `skills/imagegen-swarm/SKILL.md`. Add the dated
   changelog entry.
2. Run `npm test`, `node .github/check-frontmatter.mjs`, JavaScript syntax checks and
   `python3 -m py_compile skills/imagegen-swarm/scripts/*.py`.
3. On Ekko's signed-in machine, run `npm run smoke -- --require <changed-engine-list>`.
   For 1.4.2, require `muse,lovart,gemini` and add Grok once signed in. Confirm Muse's cost
   first. If coverage must wait, document it as pending. Signed-in engines should PASS or give
   a justified SKIP for billing, an unsupported account, or a disabled engine. SKIP on a
   required engine exits 1. Any FAIL blocks tagging.
4. Paste the smoke table into the release PR and check the smoke box in its template.
   Include the reason for each SKIP and keep credentials out of the PR.
5. After approval, tag and publish the release, then update the README install pins.

## Smoke options

```bash
npm run smoke -- [--engines codex,grok,gemini,jimeng,muse,lovart,api] [--require muse,lovart,gemini] [--out <dir>] [--keep] [--timeout <seconds>] [--json]
```

Installed skill: `node scripts/smoke.mjs`. Default order is Codex, Grok, Gemini, Jimeng,
Muse, Lovart and API. Smoke runs one engine at a time after its read-only readiness probe.
Each engine gets the same red-circle prompt, one square image, and no references. Each engine
has a 300-second default deadline including readiness and PNG checks. Override with
`--timeout <seconds>`. Progress is printed as each engine runs and `SMOKE_TABLE.txt` survives
timeout, SIGINT, and SIGTERM.

- PASS requires exit 0, successful JSON, a decodable PNG at least 256×256, and a pixel fingerprint
  distinct from all earlier passing outputs in this run.
- SKIP covers unavailable accounts, disabled engines and paid routes without opt-in. Codex's
  `image_gen_unavailable` and Gemini quota exhaustion are also SKIP. FAIL covers errors, timeouts and bad images after a probe passes.
- Default smoke uses subscription engines, skips Jimeng credits and the paid API, and runs Lovart
  only in unlimited mode with the default model on the whitelist. `--allow-credits` opts in to
  Lovart and Jimeng credit use. `--allow-paid` opts in to API spend under the configured budget.
  Lovart mode is never switched. Verify that Muse generation is included in your subscription
  before selecting Muse.
- Any FAIL or required SKIP exits 1. `--json` prints one result per line. A result cache at
  `~/.config/imagegen-swarm/smoke-last.json` records each engine's latest time, outcome, safe reason,
  duration and version. It contains no raw provider logs or credentials. Failure summaries stay
  in a run folder under `--out` (or the system temp folder). Images are removed unless
  `--keep` is set. Muse uses its usual side-chat cleanup and Lovart opens a fresh thread.

## Ekko's box

- Keep Lovart smoke out of 09:30–10:30 CT to avoid the daily job that starts around 09:45 CT.
- Leave files and counters under `/home/box/dripfont/` untouched.
- The box's Lovart account was reported in fast mode. Ekko decides whether to change it manually
  or explicitly accept the cost for a separate run.
