---
name: imagegen-swarm
description: Generate images, reference edits and videos with Codex, Grok Imagine, Gemini (Antigravity), Jimeng (Dreamina), Muse or Lovart. Use for "generate an image", "draw", "edit this image", "make a video", text to image/video, or requests naming codex, grok, gemini, nano banana, antigravity, jimeng, dreamina, muse or lovart. Not for ordinary local image processing.
---

# imagegen-swarm

The core is work-stealing: write the images you need as a job list and hand it to `batch.mjs`. All six engines start at once with a few lanes each, and whichever lane is free takes the next image it can handle, so every engine's quota is used and the batch finishes as fast as possible. A single image goes through `batch.mjs` too: the first engine in line takes it, and if that engine is out of quota the next one does.

```bash
node scripts/batch.mjs --jobs jobs.json --out out/
```

`jobs.json` is an array of `{"id": "cat", "prompt": "...", "aspect": "1:1", "ref": ["a.png"], "video": false, "engine": "gemini"}`; only `id` and `prompt` are required. `ref` paths are relative to the job file, and `engine` pins a job to one engine. Output goes to `out/<id>.png` (`.mp4` for video); existing files are skipped, so an interrupted run resumes where it stopped.

- Lanes scale with your RAM. The baseline is 8 GB (measured on an M1: 12 images at once with no slowdown and about 30% memory left): gemini and codex 6 each, jimeng and grok 4, lovart 2. Other machines scale proportionally, at least 1 and at most 1.5× per engine (4 GB → 12 lanes in total, 16 GB or more → 34); muse always gets 1. Lanes take work in that order and the first log line shows the counts. Set `IMAGE_GEN_MEMORY_GB=4` (for example) to size lanes for a smaller memory budget. `--engines` limits the engines; `--lanes gemini=3,muse=0` overrides lane counts.
- Tail stealing: once the queue is empty, an idle lane estimates from this batch's measured per-image times how long the engine still working on an image needs; if that is more than 1.2× its own time, it makes the same image too, keeps whichever finishes first and stops the other (other engines get SIGINT to their process group; Muse gets a cancel file, deletes its side chat and exits). `batch-results.json` lists every attempt with start, finish and outcome (done, cancelled, failed).
- An engine that reports exhausted quota, no login or no install is shut down, and the image it held goes back to the queue.
- If a job sets an aspect ratio, an image whose ratio is off by more than 3% is discarded and redone by another engine.
- A failed image (refusal, timeout, …) is retried on an engine that has not tried it yet, up to `--tries` engines (default 3). An image no engine can take counts as failed.
- Every start, finish, retry and shutdown prints one JSON line; the last line is the summary, and `out/batch-results.json` records which engine made each image and how long it took. Exit code is non-zero if anything failed.
- When the user names an engine, run only that one with `--engines`.
- To pause an engine, create `~/.config/imagegen-swarm/engine-off/<engine>` (or set `IMAGE_GEN_ENGINE_OFF` to another folder); batch, check and evals skip it. Delete the file to turn it back on. A switch left in `~/.config/image-gen/engine-off/` still counts.

## Engines

| Engine | Script | Can do | Aspect ratio | Time per image | Quota |
|---|---|---|---|---|---|
| codex | `codex-image.mjs` | image, reference images | `--aspect`, chosen by the model | ~30 s | Codex plan usage |
| jimeng | `jimeng-image.mjs` | image, edit (≤10 references), text-to-video, image-to-video | `--aspect`, real parameter | 30–50 s | Dreamina credits (~3 per image) |
| grok | `grok-image.mjs` | image, edit, reference-to-video | `--ratio`, real parameter | ~45 s | X / Grok plan usage |
| gemini | `gemini-image.mjs` | image, edit (≤3 references) | `--aspect`, real parameter | 20–45 s | Antigravity (Gemini) quota |
| muse | `muse-image.py` | image, reference images | `--aspect`, written into the task | 1–2 min | Muse weekly limit |
| lovart | `lovart.mjs` | image, reference images | `--aspect`, written into the prompt | ~35 s | Lovart credits |

Each engine script also works on its own (run `.mjs` with node, `.py` with python3). Shared flags: `--prompt` or `--prompt-file`, `--out <png>`, repeatable `--ref`, `--timeout`; one image per call, one JSON line, non-zero exit on failure. `batch.mjs` builds these flags from each job: an aspect ratio only goes to engines that truly support it (jimeng eight ratios, gemini and muse seven, grok five), jobs with too many references skip engines with a lower limit (jimeng 10, gemini 3, grok 1), and video only goes to jimeng and grok (only jimeng does video without a reference).

## Engine notes

- **codex**: calls Codex's built-in `image_gen`. Always uses the official OpenAI provider (`-c model_provider="openai"`; `--model` defaults to `gpt-6-luna`, `--effort` to `low`), so it still works when the local Codex config points at a custom gateway. Runs in the `workspace-write` sandbox; use `--escalate-sandbox` only with the user's consent. It snapshots `~/.codex/generated_images` first and rejects any output identical to an older file. See [references/codex.md](references/codex.md).
- **grok**: read `~/.grok/bundled/skills/imagine/SKILL.md` first. No `--ref` → text to image; `--ref` → edit (keeps the source aspect ratio); `--video --ref` → 6 s 720p video (`--out` must be .mp4, `--ratio` cannot be auto). Video needs Grok data sharing set to Opt in; on a "zero data retention" error, tell the user rather than changing the setting.
- **jimeng**: uses the official Dreamina CLI (`dreamina`). No `--ref` → text to image (2K); `--ref` → edit; `--video` → text-to-video without references, or image-to-video from the first reference (default seedance2.0fast, 720p, 5 s; change with `--model`). Submit, polling and download go through `jimeng.mjs` in the same folder, which can also run any Dreamina generator directly. If a model returns `AigcComplianceConfirmationRequired`, the user must authorize it once on the Dreamina website.
- **gemini**: uses the Antigravity CLI's (`agy`) built-in `generate_image`, called by its image-generator subagent. `--aspect` accepts 1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9. Output includes `tool_prompt` and `prompt_verbatim`; `false` means the subagent rewrote the prompt, so mention it when delivering.
- **muse**: Muse has no API, so the script drives its own headless browser (profile `~/.config/imagegen-swarm/muse-browser`, override with `IMAGE_GEN_MUSE_PROFILE`) in one pass: open a side chat, send the task, wait, download from the cloud computer's file library, delete the side chat. If Muse asks for approval, the script answers immediately: it clicks "Allow once" only when every request refers to this run's save folder `/home/hatch/workspace/imagegen-swarm`, and otherwise fails with the request text. One process at a time can use the browser. An existing profile in `~/.config/image-gen/muse-browser` is still used until you move it.
- **lovart**: opens a fresh thread every call (concurrent jobs on one thread return 409). A passing `query-mode` does not prove there are credits. Default model `generate_image_nano_banana_pro`; change it with `--model`. See [references/lovart.md](references/lovart.md).

Every engine checks that the returned image is new from this run and differs from the reference images after decoding, and converts non-PNG output to PNG.

## When every engine is out of quota

Generate in the ChatGPT, Gemini or Grok web app in a new browser tab, download and check the image, then close the tab. An engine error is different from running out of quota; if the engine the user named fails, report it instead of switching to the web.

## Checks

- `node scripts/check.mjs`: login status of all six engines (Dreamina also shows remaining credits).
- Look at every image before delivering it; sample frames from videos.
- After changing the skill, run the fixed tests: `node evals/run.mjs <outdir> [--only id,id]`. The script checks status, aspect ratio, prompt passthrough and Muse cleanup; a judge scores each image 1–5 using the rubric in `evals/evals.json`. The change is done when every check passes and every image scores at least 4.
