# Dreamina engine (`scripts/jimeng.mjs`)

Wraps the official `dreamina` CLI. Auth = the existing `dreamina login` session (Douyin OAuth device flow). Binary lives at `dreamina`; the wrapper resolves it automatically.

The wrapper is generic: it submits any async generator subcommand, polls `query_result` until the task finishes, and downloads media into `--out`. All Dreamina async tasks share one contract → `submit_id` + `gen_status` (`querying` / `success` / `fail`) + `fail_reason`, so one runner covers images and videos.

## Subcommands

| Subcommand | Purpose |
|------------|---------|
| `text2image` | prompt → image |
| `image2image` | image-guided edit |
| `image_upscale` | upscale an image |
| `text2video` | prompt → video |
| `image2video` | animate one image → video |
| `frames2video` | first + last frame → video |
| `multiframe2video` | multiple images → one coherent story video |
| `multimodal2video` | flagship all-around-reference video (seedance2.0 family) |

## ⚠️ Always check per-subcommand help before a real run

Models, ratios, resolutions, and durations differ by subcommand and version. Do not hardcode from this file:

```bash
dreamina <subcommand> -h
```

### text2image (as of writing — verify with -h)

- `--model_version`: `3.0, 3.1, 4.0, 4.1, 4.5, 4.6, 4.7, 5.0` (omit → model default)
- `--ratio`: `21:9, 16:9, 3:2, 4:3, 1:1, 3:4, 2:3, 9:16`
- `--resolution_type`: `3.0/3.1` → `1k|2k`; `4.0+/5.0` → `2k|4k` (omit → model default)
- `--generate_num`: `1–10` (default 1)
- `--session`: session id (0 = the default conversation)

## Credits & speed

- Every real submit **consumes account credits**. Check first: `dreamina user_credit` (returns JSON with `total_credit`).
- While testing, keep `--generate_num=1` and small batches.
- The `seedance2.0` family (flagship video) can be **capacity-constrained**. If the user cares about speed over max quality, do **not** default to it — pick a lighter model.

## Async & result handling

- Submit returns `submit_id` + `gen_status`. Treat submit as OK only when `submit_id` is present and status is `querying`/`success`.
- The wrapper polls `query_result --submit_id=<id> --download_dir=<out>` every `--interval` sec up to `--poll` sec (default 300; use ~600 for video), then downloads on success.
- On timeout the wrapper prints the `submit_id`; resume later:
  ```bash
  dreamina query_result --submit_id=<id> --download_dir=<dir>
  dreamina list_task --gen_status=success   # review saved tasks
  ```

## Gotchas

- **`AigcComplianceConfirmationRequired`**: some models need a one-time authorization on Dreamina Web. If the CLI returns this, tell the user to complete the web-side confirmation, then retry.
- **`gen_status=fail`**: read `fail_reason` and report it concretely (the wrapper does this and exits 1).
- Session expired → re-login: `dreamina login` (Douyin scan) or `relogin`. Reuse the existing session otherwise.

## Direct CLI (no wrapper) still works

The wrapper is a convenience. For anything unusual, call `dreamina` directly — the official agent guide is at `~/.dreamina_cli/dreamina/SKILL.md`, and `dreamina -h` / `dreamina <sub> -h` are the source of truth.
