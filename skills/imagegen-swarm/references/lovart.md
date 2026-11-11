# lovart engine details

Lovart is a design agent that plans, picks models and calls tools by itself. The programmatic entry is the Python CLI in the official MIT repo [lovartai/lovart-skill](https://github.com/lovartai/lovart-skill) (standard library only), talking to `lgw.lovart.ai` with AK/SK signatures. Trust only that repo and `www.lovart.ai/docs`; the "API docs" on `lovart.pro` and `lovart.info` are AI-generated imitations.

## Usage

```bash
node scripts/lovart.mjs --out cat.png --prompt "a cyberpunk cat in neon city" --json
node scripts/lovart.mjs --out shot.png --aspect 2:3 --ref product.jpg --prompt "Re-photograph this exact build on linen, macro, warm light" --json
```

`--ref` uploads to the Lovart CDN and attaches the URL; `--mode thinking` uses the deeper mode; `--lv` points at the wrapper. Failure `error_kind` values: `invalid_args`, `not_configured` (no lv wrapper or credentials), `timeout`, `no_image` (text reply only), `error`.

## Wrapper

`lovart.mjs` does not ship the `lv` binary. Copy [lovart-lv.example.sh](lovart-lv.example.sh) to `~/tools/lovart-skill/lv` after cloning the official repo, or set `LOVART_LV`. The example loads `~/.lovart/env` (or `LOVART_ENV`) and checks that the file is owner-only. That check is `stat -c %a` when GNU stat is available, and `stat -f %Lp` otherwise, so Linux and macOS both work. When the mode cannot be read, the wrapper still execs the CLI and passes its stdout, stderr, and exit code through. A real "no credits" response is not hidden behind a failed permission check. See [SETUP.md](../SETUP.md).

Underlying CLI: `lv query-mode` (check the key and billing mode), `lv upload --file x.jpg`, `lv chat --prompt ... --attachments <URL> --json --download --output-dir out/`, `lv set-mode --fast|--unlimited`.

## Credits

`fast` mode spends credits and never queues. `unlimited` mode is free only for whitelisted models and queues; some whitelist entries expire within a day, so do not plan around them. Nano Banana Pro costs about 14 credits per image.

## Models

Default `generate_image_nano_banana_pro` (2K). Others: `generate_image_nano_banana_2`, `generate_image_seedream_v4_5`, `generate_image_gpt_image_2`, `generate_image_midjourney`, `generate_image_flux_2_max`, `generate_image_ideogram_v4`, `generate_image_qwen_image3_pro`. The full list is in the repo README or `alias_list` from `lv query-mode`.

## Tested pitfalls

- There is no aspect-ratio parameter; `--aspect` only goes into the prompt, so check the size afterwards when it matters.
- One thread runs one job at a time and a second submit returns 409; the script opens a new thread every call, so calls can run in parallel.
- `status: done` can come back without an image (moderation, timeout, no tool call); trust `generation_succeeded`.
- Rate limits: chat/send 60 per minute and 600 per hour; queries 300 per minute.
- Image-to-image replaces third-party brand cards and watermarks in the reference, which helps product reshoots.
