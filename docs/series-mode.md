# Series mode

[English](series-mode.md) | [简体中文](series-mode.zh-CN.md)

Series mode is off by default and is never enabled automatically. It came from user feedback on X about style consistency across engines. When you mention the same character, brand, mascot, a cover set, or a series, or every task shares the same style reference image, the assistant first asks: “Should this batch share one style? If so I'll turn on series mode.” It enables the mode only after you agree, using your description for `series.style` and the shared reference image(s) for `series.ref`. Without a clear signal, such as 50 font images in different styles, there is no reminder.

The CLI prints one bilingual `series_hint` JSON event to stderr only when `--series` is absent, the jobs file has no `series` key (including a plain array), there are at least 4 jobs, and every job has an identical non-empty reference list. Paths are resolved relative to the jobs file with `path.resolve`; order and duplicate counts must match. Filesystem symlinks are not resolved, empty path strings do not qualify, and prompt similarity is not used. Any explicit `series` value, including `false` or `null`, suppresses the hint. The message suggests adding `--series` if the jobs should share one style.

When emitted, `series_hint: true` appears in the final summary and `out/batch-results.json`; otherwise the field is omitted. The hint is informational only: it never enables series mode, prompts, waits, or changes engines, provider calls or arguments, environment, or exit codes.

After agreement, in the jobs file, beside the job list:

```json
"series": {"style": "...", "ref": ["style.png"]}
```

```bash
node skills/imagegen-swarm/scripts/batch.mjs --jobs jobs.json --out out/ --series --style "..." --style-ref style.png
```

* One style guide and the style reference images go to every engine.
* Each image is scored locally against the reference images (or, without them, against the first kept image). An outlier is discarded and put back on the queue, preferring the most consistent engine so far.
* The summary counts those discards in `keep.style_redos`. `delivery_seconds` is the wall clock until the summary, including that screening and those redos.

What is checked (`series.method` or `--style-method`; scoring never uses the network):

| Method | Needs | Checks | Different subjects kept | Same subjects rejected |
| --- | --- | --- | ---: | ---: |
| `auto` (default) | — | `clip` if installed, otherwise `structure` | | |
| `structure` | Pillow | layout, linework, rendering: 0.4 × SSIM + 0.5 × gradient-orientation grid + 0.1 × palette | 31% | 26% |
| `clip` | numpy, onnxruntime, an 89 MB CLIP ViT-B/32 model (MIT) you download yourself, [SETUP.md](../skills/imagegen-swarm/SETUP.md#series-consistency-optional-clip-score) | the subject, via image embeddings; ~0.5 s and ~230 MB RAM per image | 11% | 10% |
| `palette-histogram` | Pillow | colors and brightness only (the 1.3.x score) | 6% | 76% |

Rates are at the default threshold 0.72, measured on 4,947 labeled pairs of real artwork, logos and photos ([validation](series-consistency-validation.md)). `structure` and `clip` are calibrated so 0.72 is each one's measured operating point, so existing jobs files keep working. The summary reports the method used, each kept image's `style_score`, `style_raw_score` and `style_components`.

What still can't be guaranteed: no method confirms the same face, character, or logo. `structure` cannot tell two characters drawn in the same style apart, and `clip` is still wrong about one time in ten. A keep rate was not measured on a real multi-engine series. Look at every kept image. All options are in [SKILL.md](../skills/imagegen-swarm/SKILL.md#series-mode).

What `keep` counts, including `style_redos`, is in [Keep rate](keep-rate.md).
