# codex engine (`scripts/codex-image.mjs`)

Generates images via the **Codex CLI's built-in `image_gen` tool**, using the user's Codex/ChatGPT login. No `OPENAI_API_KEY` is read or sent. Adapted from the `baoyu-image-gen` codex-imagegen wrapper's approach (spawn + a strict instruction on stdin), rewritten as a single dependency-free Node script (no bun, no `.ts`).

## How it works

1. Resolves the `codex` binary: `--codex <path>` → `codex` on PATH → newest `~/AppData/Local/OpenAI/Codex/bin/*/codex.exe` (Codex desktop app).
2. Spawns `codex exec --json --sandbox <mode> --skip-git-repo-check -C <outdir> [--image <ref>...] -` and pipes a strict instruction on stdin telling the agent to call `image_gen`, then copy the produced PNG from `$CODEX_HOME/generated_images/…` to `--out`.
3. Success = a valid PNG (checked by magic bytes `89 50 4E 47`) exists at `--out`. Retries up to `--retries` (default 2 → 3 attempts total).
4. Per-attempt logs are written to a temp dir (`$TMPDIR/codex-img-<ts>/attempt-N.log`) for triage.

## Sandbox

Default `--sandbox workspace-write` with the **output directory as the writable workspace** (`-C <outdir>`). The agent can still read its own `image_gen` output from `$CODEX_HOME` and write the final PNG there. This keeps Codex's normal isolation.

- **Auto-escalation:** when a run using the *default* mode fails, the next attempt retries with `--sandbox danger-full-access` (isolation dropped) so unattended batches don't silently return zero images. Two ways to prevent it: pass `--no-escalate`, or pass `--sandbox <mode>` explicitly — an explicitly requested mode is never widened.
- `read-only` will not work (the agent must write the PNG).
- The original wrapper this was adapted from used full-access by default; here it is only a fallback.

## Supported flags

| Flag | Behavior |
|------|----------|
| `--prompt <t>` / `--prompt-file <p>` | Prompt (mutually exclusive; one required). |
| `--out <png>` | Output path (required). Parent dirs auto-created. Rejected if it contains shell metacharacters. |
| `--aspect <r>` | `1:1` (default), `16:9`, `9:16`, `4:3`, `2.35:1`. Codex picks pixel size from the ratio; there is no `--size`/quality knob. |
| `--ref <file>` | Reference image, repeatable → `codex --image`. Style/composition guidance. |
| `--sandbox <mode>` | `workspace-write` (default), `danger-full-access`. Passing this disables auto-escalation. |
| `--no-escalate` | Keep the default sandbox for every attempt (no fallback widening). |
| `--timeout <ms>` | Per-attempt timeout (default 300000). Raise for slow networks. |
| `--retries <n>` | Retry attempts (default 2). |
| `--codex <path>` | Explicit codex binary. |
| `--json` | Single JSON result line instead of human text. |

## Failure signatures

| Symptom | Cause / fix |
|---------|-------------|
| `codex_not_installed` | `codex` not found. Ensure the Codex app is installed or `npm i -g @openai/codex`, then `codex login`. |
| `no valid PNG at <out>` | Agent didn't call `image_gen`, or the sandbox blocked the copy. Retry; if persistent, refine the prompt or escalate `--sandbox`. |
| `timeout` | Raise `--timeout`; check network. Codex is 5–10× slower than a direct API. |
| refusal | Codex agent declined (content policy). Adjust the prompt; surface the refusal to the user. |
| launch fails after Codex update | Hashed bin path changed — the resolver auto-picks the newest, but confirm `codex login` is still valid. |

## Trade-offs

- Slow, single image per call, no batch parallelism worth the name.
- Stateful: needs a live `codex login`. An expired session shows up as a launch failure or refusal.
- No video — use the jimeng engine for that.
