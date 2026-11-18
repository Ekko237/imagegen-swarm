# Changelog

## 1.4.1 - 2026-11-17

- ClawHub display name fix (显示名修正): the 1.4.0 ClawHub listing was published with the display name "Pub"; 1.4.1 republishes it as "imagegen-swarm". No functional change.

## 1.4.0 - 2026-11-17

- **Series mode gets a measured consistency check instead of a palette-only score.** The new default method `auto` uses `structure` (Pillow only: 0.4 × grayscale SSIM + 0.5 × a 4×4 HOG-like gradient-orientation grid + 0.1 × the old palette score), or `clip` when the user has installed the optional backend. `palette-histogram`, the 1.3.x score, stays selectable and unchanged. Choose with `series.method` or `--style-method auto|structure|clip|palette-histogram` (`palette` is an alias). The method is resolved once per batch, before any engine starts.
- **Optional CLIP backend, opt-in only.** `clip` scores the cosine similarity of CLIP ViT-B/32 image embeddings from a local int8 ONNX file (89 MB, MIT) at `$HOME/.config/imagegen-swarm/models/clip-vit-b32-vision-q8.onnx` or `IMAGE_GEN_CLIP_MODEL`, with `numpy` and `onnxruntime`. The skill never downloads it; `SETUP.md` has the manual download command, checksum, and costs (about 0.5 s and 230 MB RAM per scored image). An explicit `clip` request without the backend fails before generation; `auto` falls back to `structure`. Scoring makes no network call. OpenCV is not used.
- **Validated on real images.** 99 freely licensed Wikimedia Commons images in 16 groups (comic and film characters, mascots, logos, landmarks), 337 same-subject and 4,610 different-subject pairs, including palette-matched and same-artist negatives. AUC: palette 0.689, structure 0.790, CLIP int8 0.960. At the default threshold the old score rejected 76% of real same-subject pairs. Now `structure` keeps 31% of different subjects and rejects 26% of same subjects; `clip` keeps 11% and rejects 10%. Method, thresholds, limits and every image source are in `docs/series-consistency-validation.md`; the scripts are in `tests/evals/series-consistency/`.
- **Threshold stays 0.72.** `structure` (raw 0.42) and `clip` (raw cosine 0.65) are mapped piecewise linearly so 0.72 is each method's equal-error point, so jobs files that pin `"threshold": 0.72` keep working. Behavior change: with no `method` set, an existing series batch now uses `structure` (or `clip`) instead of the palette score; pass `--style-method palette-histogram` for the 1.3.x behavior.
- **Report fields.** Kept images record `style_raw_score` and `style_components` next to `style_score`; style redo events and failed jobs carry the components. The summary's `series` adds `method_requested`, `method_reason` (when `auto` decided) and `components` (the weights); `method` is the method actually used. `imgtool.py style` adds `--method`, `raw_score`, `components` and `anchor`; without `--method` it prints the 1.3.x palette output. `imgtool.py backends` reports which methods are available.
- Hermetic tests (`tests/series-consistency.test.mjs`, in CI) need Pillow only. They use procedural images and six small CC BY / CC0 fixtures with attribution in `tests/fixtures/series-consistency/README.md`, and cover the CLIP fallback. When numpy is installed they also check the CLIP plumbing with a stub runtime. No model or network is used. Still no guarantee of the same face, character or logo: look at every kept image.
- Muse approval and cleanup-warning docs are reworded to describe the same fail-closed behavior more precisely. No behavior change.
- The Lovart client upload method is now `upload_reference_image`, with its exact endpoint documented. The `upload` command is unchanged.
- SKILL.md and skill-card.md gain a "Network and credentials" section listing every host, credential and payload. The frontmatter now declares every env var and read path the scripts use.
- Internal cleanups (a redundant `node:process` import, a simpler `failureText`) let ClawHub's scanner inspect more of the code. Outputs are unchanged.
- New regression tests cover `failureText` and the Lovart upload request. `docs/clawhub-scan.md` explains how to reproduce the ClawHub scan and why the remaining findings stay.

## 1.3.4 - 2026-11-17

- **Muse keeps a saved image when side-chat cleanup fails.** If the PNG is already saved and deleting the side chat then fails (for example `当前行不是侧聊天 …`), `muse-image.py` now prints the usual success JSON with a `warnings` list and exits 0. Before, the result was lost and the exit code was 1. The `warnings` key appears only when non-empty, so normal output is unchanged. Generation failures still exit non-zero.
- **Behavior change: a relative Muse `--out` resolves against the current working directory.** It used to be joined to `$HOME`. The other engine scripts already resolved relative paths against the working directory. `~` still means the local home, and approval paths still resolve against the Muse cloud home.
- Docs: reworded the Muse approval-card sentence in `SETUP.md` (and the matching one in `SKILL.md`) that said a card "was not clicked, and nothing is clicked". No behavior change.
- Docs: clarified Muse approval wording. No live approval card has been captured; in a live test on 2026-11-17 three Muse generations completed with no approval card, so ordinary Muse jobs run without an approval step. If a card does appear, the script stops with an error and clicks nothing. No behavior change.
- Hermetic tests cover cleanup failure after a saved PNG (success JSON, exit 0), a clean run without `warnings`, generation failure with and without cleanup failure (exit 1), and relative `--out` resolution for Muse and `codex-image.mjs`. No real provider or browser was run.

## 1.3.3 - 2026-11-17

- **Muse approvals fail closed instead of trusting free-text keywords.** The internal policy permits only "Allow once" for one image-save operation with one path equal to this run's output after the existing normalization. Directory creation, extra operations or arguments, commands, reads, network access and mismatched paths are refused. The `approved` list records only the card actually clicked.
- No captured approval establishes a verified Muse operation/path layout. The extractor keeps the request unrecognized, so if a Muse approval card appears, the job stops with a RuntimeError and nothing is clicked. Jobs without approval cards continue as before. The evidence and requirements for a future decoder are documented in `references/muse.md`; no Muse protocol is assumed.
- Hermetic policy, DOM-double and wait-loop tests cover exact paths, normalization and symlinks, compound requests, command syntax, malformed shapes, labels and refusal without clicks. No real provider or browser was run.

## 1.3.2 - 2026-11-17

- **Paid images count toward both budgets even when discarded.** A returned paid image keeps its reservation through style redos, aspect rejection, duplicates, and lost steal races. Known uncharged failures release their reservations; unknown failures retain a slot only within the current batch. The API script records confirmed returned image bytes before local screening, deduplicated by attempt ID. The batch parent never writes unknown outcomes to the month ledger. Pre-request failures and provider HTTP error responses signal `charged: false`.
- `paid.images` and `paid.usd` include confirmed charged images. `paid.uncertain` counts unknown attempts whose reservations were retained (0 when none); `paid.discarded` counts confirmed charged attempts without a kept image. Jobs blocked from another paid attempt are reported as stopped by the paid budget in failed results and `paid.stopped_by_budget`, in both the summary and `batch-results.json`. Subscription routing remains available.
- Hermetic fake-engine, fetch, and scorer tests cover pre-request errors, unknown failures and killed requests, series discards, several batch and month caps, concurrent reservations, aspect and duplicate rejection, and confirmed ledger deduplication. The series command and paid accounting rules are documented. No real provider was called.

## 1.3.1 - 2026-11-16

- **Series-mode hints are informational only; generation behavior is unchanged.** Series mode remains off by default and is never auto-enabled. The assistant asks about a shared style only for a clear same-character, brand, mascot, cover-set or series request, or a shared style reference, and enables it only after the user agrees.
- Without `--series` or any explicit jobs-file `series` key, a batch of at least 4 jobs with identical non-empty reference lists emits one bilingual `series_hint` JSON event on stderr. Paths are resolved relative to the jobs file; list order and duplicate counts must match. Prompt similarity is not used. The summary and `out/batch-results.json` include `series_hint: true` only when emitted; otherwise it is omitted.
- Same engines, provider calls and arguments, environment inheritance, and exit codes. The CLI hint adds no prompts or waiting. Hermetic fake-engine tests cover matching and differing references, the job-count boundary, explicit series values, path normalization, and unchanged prompts and reference arguments.

## 1.3.0 - 2026-11-16

- **Series mode shares one style anchor and counts screening in delivery time.** `--series`, or `"series": true`, a `series` object, or a style string in the jobs file, appends one style guide to every prompt. Style reference images are attached where the engine has room. Otherwise the log records `style_text_only` or `style_refs_partial`. After each image, Pillow scores a 64×64 palette histogram (weight 0.8) and a 4×4 luminance grid (weight 0.2). Scores below the threshold (default 0.72) are discarded and requeued, preferring the engine with the best mean so far, up to `max_retries` (default 2). `series.engines` can limit the batch to fewer engines.
- `keep.style_redos` counts files discarded for a low style score. `generated` is `kept` + `redone` + `duplicates` + `style_redos`. `redone` is still an aspect-ratio discard. `elapsed_seconds` is still generation time only. `delivery_seconds` is the wall clock through the summary, including style screening and style redos.
- Keep counts from this run's attempts remain: `generated` (an engine returned an image file), `kept` (that file was saved), `redone` (aspect ratio off by more than 3%), `duplicates` (a tail-steal copy that was dropped), and `resumed` (the output was already on disk). Engine errors stay out of these counts.
- On solid-color fixtures, an identical image scores 1 and a complementary color scores 0.2. A multi-engine series keep rate was not measured.

## 1.2.10 - 2026-11-15

- **Reject unchanged output PNGs in codex-image (SDI-1).** The output path is snapshotted before attempts, including size, mtime and SHA-256. Byte-identical content is stale even if its mtime changes; retries and the existing JSON failure shape are preserved. Pre-existing user files are not deleted, and the generated-images stale-source check remains in place.
- `node scripts/batch.mjs` behavior is unchanged on configured machines except that a genuinely stale-file false success from codex-image now correctly fails. Provider arguments, environment inheritance, sandbox escalation, logging and success output format are unchanged.
- Hermetic fake-Codex tests cover unchanged outputs after both failed and successful execs, mtime-only changes, newly created PNGs and replacement PNGs. ClawHub bundles exclude Python bytecode caches.

## 1.2.9 - 2026-11-15

- **Readable script cleanup for the ClawHub scan. The unattended `node scripts/batch.mjs` run is unchanged.** Same provider calls and arguments, same environment inheritance, same outputs and exit codes, no new prompts or failures on an already configured machine. Routing policy is unchanged.
- Local process helpers and a Codex result variable no longer use shell-call names. The API aspect-ratio parser uses the equivalent non-global string match. Real `node:child_process` imports and `spawn` calls remain explicit; SkillSpector still flags those legitimate process calls, so this does not claim to resolve AE1.
- The two setup commands and the API credential-file check now explain that `chmod 600` limits access to the owner so other local users cannot read the API key. The commands and permission check are unchanged.

## 1.2.8 - 2026-11-15

- **Paid-line docs match the router. The unattended `node scripts/batch.mjs` run is unchanged.** Same provider calls, same environment inheritance, no new prompts, and no new failure on a machine that is already set up. No script moved.
- `SKILL.md` and `SETUP.md` state when the paid line starts: the job names `api`, or no enabled subscription engine can take that image. Quota is one reason a subscription engine cannot take it. Ratio, reference count, video, a shutdown for login or install, and an engine already tried are the others. The paid line still does not tail-steal.
- SkillSpector 2.12.0 reads `.mjs` as text. Its type map labels `.mjs` as `other` rather than `javascript`, and that label does not leave the file uninspected. The `.mjs` entry points stay where `node scripts/batch.mjs` and the docs already call them.

## 1.2.7 - 2026-11-15

- **ClawHub server scan follow-up. The unattended `node scripts/batch.mjs` run is unchanged.** Same provider calls, same environment inheritance, no new prompts, and no new failure on a machine that is already set up.
- Tests, evals, and examples moved out of the published skill folder into `tests/` and `examples/`. `.clawhubignore` keeps those kinds of files out of a ClawHub publish. Batch queue decisions live in `scripts/batch-policy.mjs`. Stdio mode names live in `scripts/stdio-modes.mjs` as plain strings.
- Lovart uploads only the reference files the user named for that call. Muse approval clicks through for a save of this run's exact output file, or for creating exactly the cloud workspace directory `/home/hatch/workspace/imagegen-swarm`. Any other directory stops. Cleanup deletes a side chat only when this run recorded its id. `IMAGE_GEN_MUSE_PROFILE` must stay under `$HOME/.config/imagegen-swarm` or be the legacy default profile.
- The paid Gemini API still allows 3 reference images for `gemini-2.5-flash-image` and 14 for later Gemini image models. The skill description now says so. Antigravity Gemini is still 3.
- Batch creates the output directory and uses its real path before an engine starts. Muse approval treats `~`, `.`/`..`, and an existing symlink as the same path. Creating any directory other than `/home/hatch/workspace/imagegen-swarm` still stops.

## 1.2.6 - 2026-11-15

- **ClawHub scan follow-up. The unattended `node scripts/batch.mjs` run is unchanged.** Same provider calls, same environment inheritance, no new prompts, and no new failure on a machine that is already set up.
- Scripts the scanner could only partly read are rewritten so a bounded parser can finish them. Template strings are ordinary concatenation. Stdio mode names and command names stay plain string literals. The Codex shell-metacharacter check is the same character class, in `scripts/shell-meta.mjs`.
- Lovart chat waits at most one hour (`MAX_CHAT_SECONDS`), above the 180s CLI default and the 300s batch default. Muse login waits at most one hour (`LOGIN_WAIT_MS`), above the 15 minute generation default. Shorter timeouts are unchanged.
- `$HOME/.lovart/env`, `$HOME/.lovart/state.json`, and each file under `$HOME/.config/imagegen-swarm/` are named with what is read or written and why. Setup commands target those files.
- The agent adds a provider only after the user names it and agrees. Paid caps are documented as the configured estimate, reserved before a call starts. Muse approval is a path filter, not a shell parser, and failure cleanup can remove a side chat created during the send window. Lovart renames a remote project only when its name is empty, `Untitled`, or a short id prefix, or when the user asked for `project-add` or `project-rename`.
- `SKILL.md` frontmatter now includes homepage, emoji, and `requires.config`, and the folder includes `skill-card.md`.

## 1.2.5 - 2026-11-15

- **ClawHub scan follow-up. Image generation behavior is unchanged.** Docs, tool scope, and safety guards only. `scripts/muse-image.py` thread matching and the `scripts/batch.mjs` provider calls behave as in 1.2.4.
- Codex generation reads only the `generated_images` subdirectory of `CODEX_HOME`, to reject a reused older file. `scripts/check.mjs` only tests whether `auth.json` exists.
- The readiness check passes probes only the named environment variables documented in SKILL.md. Lovart generation keeps the batch environment. The credentials file is not sourced; only `LOVART_ACCESS_KEY`, `LOVART_SECRET_KEY`, and `LOVART_BASE_URL` are read from it.
- `allowed-tools` declares Bash, Read, Write, WebFetch, and Env.
- Prompts and reference images are disclosed as being sent to the provider that runs the job. The agent must not send sensitive content without consent.
- Config directories (Muse profile, Lovart state, pay-per-image ledger directory) are created only during explicit setup. SKILL.md lists what is stored, where, and why.
- `scripts/jimeng.mjs` accepts only Dreamina image and video generation commands, and rejects other commands and flags.
- Paid API spend, price, and budgets are documented. The agent must ask before paid work the user did not request.
- A Codex retry does not leave `workspace-write` unless the user sets `IMAGE_GEN_SANDBOX_ESCALATE=yes`.
- Batch cleanup deletes only this run's temporary files and work directories that carry this run's marker.
- The Lovart client is split into `scripts/lovart_client.py`, `scripts/lovart_state.py`, and the `scripts/lovart_agent.py` entry so each file can be reviewed on its own. The command line is the same.

## 1.2.4 - 2026-11-15

- **Muse still generates when the side-chat row cannot be renamed.** After opening `/thread/<id>`, the sidebar no longer marks the open chat as `[data-testid=hatch-thread-row][aria-current=page]`, so the row lookup raised `当前行不是侧聊天` and the run stopped. That same lookup also runs when the side chat is deleted, so an image that had already been saved was still reported as a failure. The row is now matched by its thread id (link or data attribute), with the older current-row marker as a fallback, after a short wait for the sidebar. If the row still cannot be proven, rename logs one warning and generation continues. A chat that is not this thread, including Main chat, is still never renamed or deleted.

## 1.2.3 - 2026-11-15

- **Security hardening for ClawHub scan.** Dreamina install steps are pinned checksums the user runs, instead of an unpinned pipe-to-shell installer. The Lovart client v1.1.1 is shipped as readable `scripts/lovart_agent.py`, so the agent does not clone or run a remote script. Grok is limited to the one imagine tool a job needs, plus writing inside the workspace sandbox. Muse clicks "Allow once" only for a write of that run's exact output file. Codex leaves `workspace-write` only when the user asked and the log shows the sandbox blocked the write. Required binaries and optional environment variables are declared in `metadata.openclaw`.

## 1.2.2 - 2026-11-14

- **Images blocked when the paid line shuts down for budget now report the budget reason.** The failure names the per-batch or per-month limit instead of the generic no-engine message.

## 1.2.1 - 2026-11-14

- **The OpenAI api line now defaults to quality medium.** `gpt-image-2` at `low` showed visible block artifacts in a real test via an OpenAI-compatible gateway. The SETUP.md example uses `medium` at an estimated 0.05 USD per image.

## 1.2.0 - 2026-11-13

- **Optional pay-per-image API line as the last resort.** Configure `~/.config/imagegen-swarm/api.json` with an OpenAI (`/v1/images`, or any OpenAI-compatible gateway) or Gemini API key and the queue keeps going when every subscription is out at once. The paid line takes an image only when no subscription engine can, never tail-steals, and stops before passing your per-batch or per-month budget. Every paid image is logged to `api-spend.jsonl`, and the batch summary shows images, cost and the month total. `check.mjs` verifies the key with a free model-list call. Without the config nothing changes.

## 1.1.2 - 2026-11-11

- **A failed image is no longer dropped when the machine is busy.** An attempt now counts as running until its cleanup is finished (measuring the aspect ratio, removing the temp file, putting the image back in the queue). Before, the count dropped as soon as the engine exited, so idle lanes could see an empty queue with nothing running and quit, and the image that came back a moment later had no lane left to take it.

## 1.1.1 - 2026-11-11

- **Symlinked installs run again.** `batch.mjs` and `gemini-image.mjs` decide they are the entrypoint by comparing real paths, so a launch through a symlinked script or a symlinked skill folder (the usual `~/.claude/skills/imagegen-swarm` install) still runs. Importing either file from a test does not start a run.

## 1.1.0 - 2026-11-11

Reliability fixes for long batches. Existing job files, flags, and output paths behave as before.

- **Gemini keeps an image when the session log clips a long prompt.** Parsing a truncated transcript or `agy` result no longer throws away a file that was generated. The full log (`transcript_full.jsonl`) is used when Antigravity wrote one.
- **Muse rename cannot block generation.** If the side-chat rename dialog fails or times out, the script closes it and continues. The image is still downloaded and the side chat is still deleted.
- **Lovart wrapper example works on Linux and macOS.** [skills/imagegen-swarm/references/lovart-lv.example.sh](skills/imagegen-swarm/references/lovart-lv.example.sh) checks credential permissions with `stat -c` or `stat -f`. If the mode cannot be read, the CLI still runs, so a real no-credits error is not replaced by a permissions failure.
- **Tail stealing waits until the holder is actually late.** A second copy starts only after the engine already working has run longer than 1.5× its own median for this batch. At most one duplicate runs. The first image to finish is kept, and the other is cancelled or ignored.
- **One rate limit no longer disables an engine.** Exhausted quota, auth failure, and not-installed still shut an engine down immediately. A plain 429 or rate limit backs off and shuts the engine down only after three consecutive rate-limit failures. A generic "not found" or a missing file (`ENOENT` from opening a path) stays a per-image error.

## 1.0.0 - 2026-11-10

First public release. Tag `v1.0.0`.

- **50 images in 2.3 minutes on an 8 GB M1 MacBook Pro, 11 times faster than one engine alone.** One test run. Gemini and Lovart ran out partway through, and all 50 images were still delivered. Lovart and Muse were on free plans. Speed depends on how much quota you have with each engine.
- **Six engines share one queue.** Codex, Jimeng, Grok, Gemini, Muse, and Lovart. A free lane takes the next image. An engine that reports exhausted quota, no login, or no install is shut down, and its job goes back to the queue.
- **No image API key for most engines.** You generate with the Codex and Jimeng accounts you already have. Grok, Gemini and Muse use their own account logins. Lovart uses its official AK/SK, stored on your machine. Jimeng also generates videos.
- **Lane counts follow RAM.** 12 lanes on a 4 GB laptop, 34 on 16 GB or more. Rerun the same job list and finished images are skipped.
