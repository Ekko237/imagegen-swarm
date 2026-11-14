# Changelog

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
