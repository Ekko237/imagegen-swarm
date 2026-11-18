# Series-consistency validation (v1.4.0)

This page records how the series-mode consistency score was chosen. It was measured on
2026-11-17 on real, freely licensed images, not on solid colors. Everything here can be re-run:

```bash
python3 -m pip install pillow                       # required
python3 tests/evals/series-consistency/fetch.py /tmp/sc-cache      # network: 99 Commons thumbnails, about 22 MB
python3 tests/evals/series-consistency/evaluate.py /tmp/sc-cache \
  [--clip-model clip-vit-b32-vision-q8.onnx] [--clip-model clip-vit-b32-vision-fp32.onnx] \
  [--dino-model dinov2-small-q8.onnx] [--json results.json]
```

`evaluate.py` imports the shipped `skills/imagegen-swarm/scripts/imgtool.py`, so the
`palette-histogram`, `structure` and `clip` rows describe exactly the code `batch.mjs` runs.
The other rows (pHash, dHash, LBP, hue-saturation histogram, ORB, DINOv2) are comparison
candidates that live only in the evaluation script. numpy, onnxruntime and opencv are optional
there; a missing one skips its rows. The images themselves are not committed.

## Data

16 identity groups, 99 images (`tests/evals/series-consistency/dataset.json`), downloaded as
512 px Wikimedia Commons thumbnails:

| kind | groups |
|---|---|
| comic characters (David Revoy, Pepper&Carrot, CC BY 4.0) | Pepper, Carrot, Saffron, Coriander, Shichimi |
| film characters (Blender open movies) | Sintel, Emo and Proog (Elephants Dream) |
| mascots | Tux, Wilber (GIMP) |
| logos and variants | Firefox, Wikipedia globe |
| landmark photos | Eiffel Tower, Golden Gate Bridge, Tokyo Tower, Tower Bridge |

Each group shows one subject in different frames, poses, crops, media (ink, paint, 3D, photo,
latte art, graffiti) and recolors. Images were picked by eye; two Pepper images in which Carrot is
as prominent as Pepper were dropped as ambiguous.

Pairs (4,947 in total):

| subset | label | pairs | what it is |
|---|---|---:|---|
| same-real | same | 289 | two images of one group |
| same-augment | same | 48 | an image and a crop (75–90%) + optional mirror + hue shift (±12/256) + brightness (×0.85–1.15) of it |
| diff-real | different | 4,381 | two groups from different artists/films/sources |
| diff-same-family | different | 181 | two different characters by the same artist or from the same film (for example Pepper vs. Saffron, Emo vs. Proog) |
| diff-palette-matched | different | 48 | image A and an image of another group recolored to A's palette by per-channel histogram matching. This is the case the 1.3.x score cannot see |

"same" in total: 337 pairs; "different" in total: 4,610 pairs.

## Results

AUC is the probability that a random "same" pair scores above a random "different" pair (0.5 is
chance). Columns: `all` = every pair; `real` = same-real vs diff-real; `same-family` = same-real vs
diff-same-family; `palette-matched` = same-real vs diff-palette-matched; `augment` = same-augment
vs diff-real. Scores in the tables are raw (before the 0.72 calibration described below).

| method | all | real | same-family | palette-matched | augment |
|---|---:|---:|---:|---:|---:|
| palette-histogram (1.3.x) | 0.689 | 0.663 | 0.517 | 0.291 | 0.915 |
| structure (new) | 0.790 | 0.771 | 0.536 | 0.576 | 0.977 |
| ssim | 0.667 | 0.642 | 0.682 | 0.580 | 0.813 |
| hog | 0.739 | 0.718 | 0.428 | 0.682 | 0.938 |
| luminance grid | 0.616 | 0.596 | 0.352 | 0.492 | 0.807 |
| phash | 0.623 | 0.605 | 0.623 | 0.648 | 0.723 |
| dhash | 0.599 | 0.566 | 0.546 | 0.563 | 0.804 |
| lbp | 0.688 | 0.650 | 0.368 | 0.552 | 0.989 |
| hue-sat hist | 0.710 | 0.677 | 0.546 | 0.204 | 0.970 |
| orb inliers | 0.664 | 0.624 | 0.644 | 0.617 | 0.905 |
| clip:clip-b32-vision-q8.onnx | 0.960 | 0.958 | 0.853 | 0.932 | 0.999 |
| clip:clip-b32-vision-fp32.onnx | 0.961 | 0.959 | 0.863 | 0.950 | 0.999 |
| dinov2:dinov2-small-q8.onnx | 0.945 | 0.947 | 0.646 | 0.941 | 1.000 |

| method | raw threshold | FPR | FNR | palette-matched accepted | same-family accepted |
|---|---:|---:|---:|---:|---:|
| palette-histogram (1.3.x) | 0.72 | 0.061 | 0.760 | 0.562 | 0.171 |
| structure (new) | 0.42 | 0.307 | 0.264 | 0.562 | 0.674 |
| clip:clip-b32-vision-q8.onnx | 0.65 | 0.106 | 0.098 | 0.146 | 0.453 |
| clip:clip-b32-vision-fp32.onnx | 0.65 | 0.103 | 0.119 | 0.083 | 0.420 |

| method | Youden threshold | FPR | FNR | same p10/p25/p50/p75/p90 | different p10/p25/p50/p75/p90 |
|---|---:|---:|---:|---|---|
| palette-histogram (1.3.x) | 0.295 | 0.426 | 0.273 | 0.207 / 0.283 / 0.407 / 0.713 / 0.885 | 0.185 / 0.206 / 0.27 / 0.416 / 0.625 |
| structure (new) | 0.425 | 0.271 | 0.288 | 0.373 / 0.416 / 0.458 / 0.534 / 0.616 | 0.318 / 0.351 / 0.392 / 0.429 / 0.462 |
| ssim | 0.087 | 0.370 | 0.368 | 0.025 / 0.056 / 0.111 / 0.188 / 0.322 | 0.013 / 0.034 / 0.067 / 0.113 / 0.166 |
| hog | 0.755 | 0.158 | 0.493 | 0.615 / 0.673 / 0.756 / 0.803 / 0.89 | 0.511 / 0.581 / 0.659 / 0.726 / 0.776 |
| luminance grid | 0.942 | 0.313 | 0.493 | 0.797 / 0.887 / 0.943 / 0.971 / 0.988 | 0.77 / 0.847 / 0.911 / 0.951 / 0.974 |
| phash | 0.524 | 0.294 | 0.507 | 0.429 / 0.492 / 0.524 / 0.587 / 0.651 | 0.429 / 0.46 / 0.492 / 0.556 / 0.587 |
| dhash | 0.641 | 0.052 | 0.801 | 0.406 / 0.469 / 0.531 / 0.609 / 0.734 | 0.391 / 0.438 / 0.5 / 0.562 / 0.625 |
| lbp | 0.644 | 0.370 | 0.374 | 0.522 / 0.598 / 0.684 / 0.781 / 0.848 | 0.412 / 0.514 / 0.604 / 0.687 / 0.75 |
| hue-sat hist | 0.311 | 0.338 | 0.356 | 0.154 / 0.251 / 0.382 / 0.62 / 0.803 | 0.055 / 0.128 / 0.236 / 0.362 / 0.508 |
| orb inliers | 5 | 0.228 | 0.507 | 0 / 0 / 4 / 8 / 102 | 0 / 0 / 0 / 4 / 6 |
| clip:clip-b32-vision-q8.onnx | 0.668 | 0.077 | 0.107 | 0.658 / 0.735 / 0.805 / 0.882 / 0.933 | 0.416 / 0.47 / 0.53 / 0.59 / 0.653 |
| clip:clip-b32-vision-fp32.onnx | 0.626 | 0.137 | 0.074 | 0.637 / 0.735 / 0.827 / 0.901 / 0.95 | 0.391 / 0.447 / 0.509 / 0.572 / 0.653 |
| dinov2:dinov2-small-q8.onnx | 0.261 | 0.151 | 0.110 | 0.249 / 0.366 / 0.632 / 0.819 / 0.908 | -0.04 / -0.007 / 0.053 / 0.183 / 0.329 |

subset counts: {"same-real": 289, "diff-same-family": 181, "diff-real": 4381, "same-augment": 48, "diff-palette-matched": 48}
timings: {"structure features per image (s)": 0.014, "clip:clip-b32-vision-q8.onnx per image (s)": 0.0403, "clip:clip-b32-vision-fp32.onnx per image (s)": 0.0698}

FPR = share of "different" pairs that would be kept; FNR = share of "same" pairs that would be
rejected (and regenerated). "palette-matched accepted" / "same-family accepted" are the FPR inside
those two subsets.

Pure-Pillow combinations were searched with class-balanced logistic regression under 4-fold
group-held-out cross-validation (all 1–4 component subsets of SSIM, HOG, global orientation
histogram, edge density, LBP, hue-saturation histogram, palette, luminance grid, pHash, dHash).
The best subsets reached a cross-validated AUC of about 0.78 and all contained SSIM + HOG (+ a
color term). The shipped weights (0.4 SSIM, 0.5 HOG, 0.1 palette) came from a 0.1-step grid over
non-negative weights, so the score stays between 0 and 1; they reach 0.790 overall and keep the
palette-matched AUC at 0.576 (adding more color raised the overall AUC to 0.799 but dropped the
palette-matched AUC below 0.5). Also tried and not shipped: finer and block-normalized HOG,
gradient-magnitude SSIM, an 8×8 Lab color layout, and HOG centered on a mean vector from 210
unused images (composite 0.794, not worth a stored prior). Adding ORB to the Pillow features
moved the cross-validated AUC from 0.784 to 0.785, so OpenCV is not used. CLIP + HOG or
CLIP + ORB gained at most 0.003 over CLIP alone (0.956 / 0.954 vs 0.953 cross-validated), so CLIP
is used alone.

## Decision

* **Default without optional packages: `structure` = 0.4 × SSIM + 0.5 × HOG + 0.1 × palette-histogram**,
  Pillow only (no numpy). AUC 0.790 vs 0.689 for the 1.3.x palette score; 0.576 vs 0.291 on
  palette-matched different subjects (the old score ranks those above real same-subject pairs).
  About 14 ms per image, 27 MB RSS per call.
* **Optional `clip`: CLIP ViT-B/32 image encoder, int8 ONNX** (`vision_model_quantized.onnx` from
  `Xenova/clip-vit-base-patch32`, 89 MB, MIT license, sha256
  `583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299`). Whole image padded to a
  white 224×224 square (padding scored 0.960 vs 0.958 for the usual center crop, and better on
  same-family pairs, 0.853 vs 0.821). AUC 0.960; fp32 (352 MB) is 0.961, so the 4× smaller file
  is the recommended one. About 0.45–0.6 s and 230 MB RSS per scoring call on this 8-core CPU
  (process start + model load + one embedding per image; ~35–40 ms per embedding). fp32: 1.2 s,
  640 MB.
* DINOv2-small (24 MB int8, Apache-2.0) scored 0.945 overall but 0.646 on same-family pairs: it
  matches drawing style more than character identity, so it is not offered.
* `auto` (the new default) uses `clip` when numpy, onnxruntime and the model file are present, and
  `structure` otherwise. It is resolved once per batch.
* `palette-histogram` stays selectable (`--style-method palette-histogram`, or
  `series.method: "palette"`), with the same score as 1.3.x.

### Thresholds

The operating point of each method is its equal-error-rate point on this data (FPR ≈ FNR), rounded
to 0.01: raw 0.42 for `structure`, raw 0.65 (cosine) for `clip`. To keep existing jobs files that
pin `"threshold": 0.72` meaningful, both scores are mapped piecewise linearly so that raw 0 → 0,
raw operating point → **0.72**, raw 1 → 1. The default threshold therefore stays 0.72 for every
method; `raw_score` and the components are reported unmapped. `palette-histogram` is not remapped.

| method at threshold 0.72 | false keeps (FPR) | false rejects (FNR) | palette-matched kept | same-artist different character kept |
|---|---:|---:|---:|---:|
| palette-histogram (1.3.x default) | 6.1% | **76.0%** | 56.2% | 17.1% |
| structure (default without CLIP) | 30.7% | 26.4% | 56.2% | 67.4% |
| clip, int8 model | 10.6% | 9.8% | 14.6% | 45.3% |
| clip, fp32 model | 10.3% | 11.9% | 8.3% | 42.0% |

Reading the table:

* The 1.3.x default threshold rejected 76% of real same-subject pairs. With the default 2 retries
  and independent attempts, roughly 0.76³ ≈ 44% of such jobs would end as failed. It kept few
  different subjects only because it rejected almost everything that was not color-identical.
  At its own equal-error point (raw 0.295) it would keep 42.6% of different pairs and 87.5% of
  palette-matched ones.
* `structure` trades many fewer false rejects for more false keeps. It is a coarse screen for
  layout, linework and rendering, not an identity check: on same-artist different characters it
  is at chance (AUC 0.536).
* `clip` is the only tested local method that separates subjects reliably, and it is still wrong
  about 1 time in 10, and keeps 45% of different characters drawn by the same artist.

## Limits

* No method here guarantees that a face, character or logo is the same. A human still has to look
  at every kept image.
* The pairs are real artwork and photos, not outputs of the engines this skill drives. A series
  generated from one style guide and the same reference images is likely more uniform than these
  groups, so real false-reject rates are probably lower; drift between engines can be subtler than
  these "different" pairs. A keep rate on a real multi-engine series was not measured.
* 16 groups is a small sample, and the thresholds were chosen on the same data that is reported
  (only the Pillow weights were checked with group-held-out cross-validation). Expect a few points
  of optimism.
* CLIP has blind spots: in the hermetic test fixtures it scores a brightness-sorted gradient of the
  anchor's pixels 0.66 (raw) against a flat cartoon character, just above its operating point.
* A paid vision model (one of the user's image engines, or a multimodal API) used as a judge would
  likely beat all of these on identity, but every score would cost a request (and often money),
  add tens of seconds, and send each image to a provider. It is not implemented; the user can
  still review outputs with any assistant.

## Image sources and licenses

All 99 validation images are from Wikimedia Commons and were used only for measurement (512 px
thumbnails, not redistributed). License and author as reported by the Commons API at download
time; the file page is authoritative. Licenses in the set: CC BY-SA 4.0 (23), CC BY 4.0 (20),
CC BY-SA 3.0 (18), CC BY 2.5 (11), CC BY 2.0 (7), CC BY 3.0 (4), CC0 (4), GPL (4), LGPL (3),
MPL 2.0 (3), CC BY-SA 2.0 (1), public domain (1). Six of them, downscaled, are committed as test
fixtures; see `tests/fixtures/series-consistency/README.md`.

Models used during validation (not committed, not shipped): `Xenova/clip-vit-base-patch32`
`onnx/vision_model_quantized.onnx` and `onnx/vision_model.onnx` (MIT, from OpenAI CLIP), and
`Xenova/dinov2-small` `onnx/model_quantized.onnx` (Apache-2.0, from Meta DINOv2), from Hugging Face.

| group | file | author | license |
|---|---|---|---|
| pepper | [2014-10-31 pepper-more-anime net.jpg](https://commons.wikimedia.org/wiki/File:2014-10-31_pepper-more-anime_net.jpg) | David Revoy | CC BY 4.0 |
| pepper | [2017-03-05 pepper-s-model-sheet by-David-Revoy.jpg](https://commons.wikimedia.org/wiki/File:2017-03-05_pepper-s-model-sheet_by-David-Revoy.jpg) | David Revoy | CC BY 4.0 |
| pepper | [2018-11-22 vertical-cover-book-three by-David-Revoy.jpg](https://commons.wikimedia.org/wiki/File:2018-11-22_vertical-cover-book-three_by-David-Revoy.jpg) | David Revoy | CC BY 4.0 |
| pepper | [David Revoy - Pepper&Carrot - October Ink Artworks 2017 (week 1) - Long.jpg](https://commons.wikimedia.org/wiki/File:David_Revoy_-_Pepper%26Carrot_-_October_Ink_Artworks_2017_(week_1)_-_Long.jpg) | David Revoy | CC BY 4.0 |
| pepper | [David Revoy - Pepper&Carrot - October Ink Artworks 2017 (week 1) - Swift.jpg](https://commons.wikimedia.org/wiki/File:David_Revoy_-_Pepper%26Carrot_-_October_Ink_Artworks_2017_(week_1)_-_Swift.jpg) | David Revoy | CC BY 4.0 |
| pepper | [David Revoy - Pepper&Carrot - October Ink Artworks 2017 (week 2) - Shattered.jpg](https://commons.wikimedia.org/wiki/File:David_Revoy_-_Pepper%26Carrot_-_October_Ink_Artworks_2017_(week_2)_-_Shattered.jpg) | David Revoy | CC BY 4.0 |
| carrot | [2015-01-12 carrot-greeting-card.jpg](https://commons.wikimedia.org/wiki/File:2015-01-12_carrot-greeting-card.jpg) | David Revoy | CC BY 4.0 |
| carrot | [2018-01-01 Pepper Carrot Happy-New-Year by-David-Revoy.jpg](https://commons.wikimedia.org/wiki/File:2018-01-01_Pepper_Carrot_Happy-New-Year_by-David-Revoy.jpg) | David Revoy | CC BY 4.0 |
| carrot | [2023-08-26 Carrot latte art by Reissue Cafe in Tokyo.jpg](https://commons.wikimedia.org/wiki/File:2023-08-26_Carrot_latte_art_by_Reissue_Cafe_in_Tokyo.jpg) | David Revoy | CC BY-SA 4.0 |
| carrot | [Carrot from Pepper&Carrot.jpg](https://commons.wikimedia.org/wiki/File:Carrot_from_Pepper%26Carrot.jpg) | David Revoy | CC BY 4.0 |
| saffron | [Crooked Colors.jpg](https://commons.wikimedia.org/wiki/File:Crooked_Colors.jpg) | David Revoy derivative work: Bhoren | CC BY 4.0 |
| saffron | [Pepper&Carrot Saffron.jpg](https://commons.wikimedia.org/wiki/File:Pepper%26Carrot_Saffron.jpg) | David Revoy | CC BY 4.0 |
| saffron | [Saffron from Pepper&Carrot.jpg](https://commons.wikimedia.org/wiki/File:Saffron_from_Pepper%26Carrot.jpg) | David Revoy | CC BY 4.0 |
| coriander | [Bhoren colourisation of David Revoy - Pepper&Carrot - October Ink Artworks 2017 (week 2) - Gigantic.jpg](https://commons.wikimedia.org/wiki/File:Bhoren_colourisation_of_David_Revoy_-_Pepper%26Carrot_-_October_Ink_Artworks_2017_(week_2)_-_Gigantic.jpg) | File:David Revoy - Pepper&amp;Carrot - October Ink Artworks 2017 (week | CC BY 4.0 |
| coriander | [Coriander RPG costume.webp](https://commons.wikimedia.org/wiki/File:Coriander_RPG_costume.webp) | Morevna Project | CC BY 4.0 |
| coriander | [Pepper&Carrot Coriander.jpg](https://commons.wikimedia.org/wiki/File:Pepper%26Carrot_Coriander.jpg) | David Revoy | CC BY 4.0 |
| shichimi | [2015-02-17 shichimi-concept-art by-David-Revoy.jpg](https://commons.wikimedia.org/wiki/File:2015-02-17_shichimi-concept-art_by-David-Revoy.jpg) | David Revoy | CC BY 4.0 |
| shichimi | [David Revoy - Pepper&Carrot - October Ink Artworks 2017 (week 1) - Shy.jpg](https://commons.wikimedia.org/wiki/File:David_Revoy_-_Pepper%26Carrot_-_October_Ink_Artworks_2017_(week_1)_-_Shy.jpg) | David Revoy | CC BY 4.0 |
| shichimi | [Pepper&Carrot Shichimi.jpg](https://commons.wikimedia.org/wiki/File:Pepper%26Carrot_Shichimi.jpg) | David Revoy | CC BY 4.0 |
| shichimi | [Shichimi RPG costume.webp](https://commons.wikimedia.org/wiki/File:Shichimi_RPG_costume.webp) | Morevna Project | CC BY 4.0 |
| sintel | [Blender 2.5 alpha 0-splash.jpg](https://commons.wikimedia.org/wiki/File:Blender_2.5_alpha_0-splash.jpg) | Blender Foundation | GPL |
| sintel | [Blender 2.54 beta-splash.jpg](https://commons.wikimedia.org/wiki/File:Blender_2.54_beta-splash.jpg) | see file page | GPL |
| sintel | [Character Sintel-portrait-old.png](https://commons.wikimedia.org/wiki/File:Character_Sintel-portrait-old.png) | David Revoy / Blender Foundation | CC BY 3.0 |
| sintel | [Durian - Sintel-wallpaper-sintel.jpg](https://commons.wikimedia.org/wiki/File:Durian_-_Sintel-wallpaper-sintel.jpg) | David REVOY | CC BY 3.0 |
| sintel | [Showing me what I've become.png](https://commons.wikimedia.org/wiki/File:Showing_me_what_I%27ve_become.png) | see credits for the film: wikisource:en:Sintel#I_Move_On | CC BY 3.0 |
| sintel | [Sintel Cover Durian Project.jpg](https://commons.wikimedia.org/wiki/File:Sintel_Cover_Durian_Project.jpg) | Lee Salvemini, Pablo Vazquez, David Revoy, Durian Team, Blender Founda | CC BY 3.0 |
| sintel | [Sintel and Scales 2010 Christmas card by David Revoy.jpg](https://commons.wikimedia.org/wiki/File:Sintel_and_Scales_2010_Christmas_card_by_David_Revoy.jpg) | David Revoy | CC BY 4.0 |
| sintel | [Sintel screenshot.png](https://commons.wikimedia.org/wiki/File:Sintel_screenshot.png) | © copyright Blender Foundation www.sintel.org | CC BY-SA 3.0 |
| emo | [Elephants Dream f11621.png](https://commons.wikimedia.org/wiki/File:Elephants_Dream_f11621.png) | Ton Roosendaal et al. | CC BY 2.5 |
| emo | [Elephants Dream s2 emo.jpg](https://commons.wikimedia.org/wiki/File:Elephants_Dream_s2_emo.jpg) | Ton Roosendaal et al. | CC BY 2.5 |
| emo | [Elephants Dream s8 emo.jpg](https://commons.wikimedia.org/wiki/File:Elephants_Dream_s8_emo.jpg) | Ton Roosendaal et al. | CC BY 2.5 |
| emo | [Elephants Dream s8 emocu.jpg](https://commons.wikimedia.org/wiki/File:Elephants_Dream_s8_emocu.jpg) | Ton Roosendaal et al. | CC BY 2.5 |
| proog | [Elephants Dream - Emo and Proog.png](https://commons.wikimedia.org/wiki/File:Elephants_Dream_-_Emo_and_Proog.png) | Ton Roosendaal et al. | CC BY 2.5 |
| proog | [Elephants Dream s1 proog.jpg](https://commons.wikimedia.org/wiki/File:Elephants_Dream_s1_proog.jpg) | Ton Roosendaal et al. | CC BY 2.5 |
| proog | [Elephants Dream s5 both cropped.jpg](https://commons.wikimedia.org/wiki/File:Elephants_Dream_s5_both_cropped.jpg) | Original authors: Ton Roosendaal et al. | CC BY 2.5 |
| proog | [Elephants Dream s5 proog.jpg](https://commons.wikimedia.org/wiki/File:Elephants_Dream_s5_proog.jpg) | Ton Roosendaal et al. | CC BY 2.5 |
| proog | [Elephants Dream s8 emotease.jpg](https://commons.wikimedia.org/wiki/File:Elephants_Dream_s8_emotease.jpg) | Ton Roosendaal et al. | CC BY 2.5 |
| proog | [Elephants Dream s8 proog.jpg](https://commons.wikimedia.org/wiki/File:Elephants_Dream_s8_proog.jpg) | Ton Roosendaal et al. | CC BY 2.5 |
| tux | [03-March Reading for life.svg](https://commons.wikimedia.org/wiki/File:03-March_Reading_for_life.svg) | Moini | CC0 |
| tux | [Card back 12.svg](https://commons.wikimedia.org/wiki/File:Card_back_12.svg) | David Bellot - Berkeley, CA, USA 08/12/2005 - David's web | LGPL |
| tux | [Cirpack LINUX tux 2.png](https://commons.wikimedia.org/wiki/File:Cirpack_LINUX_tux_2.png) | nlebihan | Public domain |
| tux | [Crystal Project Linuxconf.png](https://commons.wikimedia.org/wiki/File:Crystal_Project_Linuxconf.png) | Everaldo Coelho (YellowIcon); | LGPL |
| tux | [Debiantux08.png](https://commons.wikimedia.org/wiki/File:Debiantux08.png) | Luisfelix17 | CC BY-SA 3.0 |
| tux | [Debiantux09.re.png](https://commons.wikimedia.org/wiki/File:Debiantux09.re.png) | Luisfelix17 | CC BY-SA 3.0 |
| tux | [FlisoltuxDF.png](https://commons.wikimedia.org/wiki/File:FlisoltuxDF.png) | Ezequiel netri | CC BY-SA 3.0 |
| tux | [Frt.jpg](https://commons.wikimedia.org/wiki/File:Frt.jpg) | IDALICIA | CC BY-SA 4.0 |
| wilber | [Gimp logo.jpg](https://commons.wikimedia.org/wiki/File:Gimp_logo.jpg) | User:Commons_sibi | CC BY-SA 3.0 |
| wilber | [The GIMP icon - gnome.svg](https://commons.wikimedia.org/wiki/File:The_GIMP_icon_-_gnome.svg) | Tuomas Kuosmanen | GPL |
| wilber | [The GIMP icon - v3.0 (macOS).svg](https://commons.wikimedia.org/wiki/File:The_GIMP_icon_-_v3.0_(macOS).svg) | Aryeom Han | CC BY-SA 4.0 |
| wilber | [The GIMP icon - v3.0 (with shadow).svg](https://commons.wikimedia.org/wiki/File:The_GIMP_icon_-_v3.0_(with_shadow).svg) | Aryeom Han | CC BY-SA 4.0 |
| wilber | [Wilber (gimp).jpg](https://commons.wikimedia.org/wiki/File:Wilber_(gimp).jpg) | Tuomas Kuosmanen | CC0 |
| firefox | [Antu firefox-developer-edition.svg](https://commons.wikimedia.org/wiki/File:Antu_firefox-developer-edition.svg) | Fabián Alexis | CC BY-SA 3.0 |
| firefox | [Antu firefox.svg](https://commons.wikimedia.org/wiki/File:Antu_firefox.svg) | Fabián Alexis | CC BY-SA 3.0 |
| firefox | [CristalFireFox4 - cropped.jpg](https://commons.wikimedia.org/wiki/File:CristalFireFox4_-_cropped.jpg) | Original uploader is urioste, from Gnome project | GPL |
| firefox | [Crystal Project Firefox alt.png](https://commons.wikimedia.org/wiki/File:Crystal_Project_Firefox_alt.png) | Everaldo Coelho (YellowIcon); | LGPL |
| firefox | [Firefox Reality Logo.png](https://commons.wikimedia.org/wiki/File:Firefox_Reality_Logo.png) | Mozilla | CC BY-SA 4.0 |
| firefox | [Firefox Lite logo, 2019.svg](https://commons.wikimedia.org/wiki/File:Firefox_Lite_logo,_2019.svg) | Mozilla Corporation | MPL 2 |
| firefox | [Firefox Developer Edition logo, 2019.svg](https://commons.wikimedia.org/wiki/File:Firefox_Developer_Edition_logo,_2019.svg) | ™ Mozilla Corporation | MPL 2 |
| firefox | [Firefox Nightly logo, 2019.svg](https://commons.wikimedia.org/wiki/File:Firefox_Nightly_logo,_2019.svg) | Mozilla Corporation | MPL 2 |
| wikipedia | [Belgorod Logo Wikipedia.png](https://commons.wikimedia.org/wiki/File:Belgorod_Logo_Wikipedia.png) | KittenBroEeev | CC BY-SA 4.0 |
| wikipedia | [Flyerdesign 22102022 051607.jpg](https://commons.wikimedia.org/wiki/File:Flyerdesign_22102022_051607.jpg) | Fongcwele | CC BY-SA 4.0 |
| wikipedia | [Earthathon.jpg](https://commons.wikimedia.org/wiki/File:Earthathon.jpg) | Megs | CC BY-SA 4.0 |
| wikipedia | [Bolas navideñas wikipedia.jpg](https://commons.wikimedia.org/wiki/File:Bolas_navide%C3%B1as_wikipedia.jpg) | Version 1 by Nohat (concept by Paullusmagnus); Wikimedia. , Kris de Cu | CC BY 2.0 |
| wikipedia | [Electric Wikipedia.png](https://commons.wikimedia.org/wiki/File:Electric_Wikipedia.png) | DiamondCoder | CC BY-SA 4.0 |
| wikipedia | [Wikipedia logo 3d gold.png](https://commons.wikimedia.org/wiki/File:Wikipedia_logo_3d_gold.png) | Wikipedia-logo.png: Wikipedia logo by Nohat (concept by Paullusmagnus) | CC BY-SA 3.0 |
| wikipedia | [Wikipedia red logo.png](https://commons.wikimedia.org/wiki/File:Wikipedia_red_logo.png) | Version 1 by Nohat (concept by Paullusmagnus); Wikimedia. Made red by  | CC BY-SA 3.0 |
| wikipedia | [WikiProject Autism logo, July 2014.png](https://commons.wikimedia.org/wiki/File:WikiProject_Autism_logo,_July_2014.png) | Muffinator | CC BY-SA 3.0 |
| eiffel | [1005 Eiffel tower night illumination by Pierre Bideau in Paris Photo by Giles Laurent.jpg](https://commons.wikimedia.org/wiki/File:1005_Eiffel_tower_night_illumination_by_Pierre_Bideau_in_Paris_Photo_by_Giles_Laurent.jpg) | Photo: © Giles Laurent / Illumination: © Pierre Bideau, concepteur Lum | CC BY-SA 4.0 |
| eiffel | [Detail structure Tour Eiffel.jpg](https://commons.wikimedia.org/wiki/File:Detail_structure_Tour_Eiffel.jpg) | Jebulon | CC0 |
| eiffel | [Details of Eiffel Tower structure, south pillar.jpg](https://commons.wikimedia.org/wiki/File:Details_of_Eiffel_Tower_structure,_south_pillar.jpg) | Yann Forget | CC BY-SA 4.0 |
| eiffel | [Eiffel Tower 2 - Paris.jpg](https://commons.wikimedia.org/wiki/File:Eiffel_Tower_2_-_Paris.jpg) | Commonists | CC BY-SA 4.0 |
| eiffel | [Eiffel Tower Keychain.jpg](https://commons.wikimedia.org/wiki/File:Eiffel_Tower_Keychain.jpg) | User:AndonicO | CC BY 2.5 |
| eiffel | [Eiffel Tower Paris June 2010.jpg](https://commons.wikimedia.org/wiki/File:Eiffel_Tower_Paris_June_2010.jpg) | King of Hearts | CC BY-SA 4.0 |
| eiffel | [Eiffel Tower from Champ-de-Mars, 7 August 2017.jpg](https://commons.wikimedia.org/wiki/File:Eiffel_Tower_from_Champ-de-Mars,_7_August_2017.jpg) | Gordon Gartrell | CC BY-SA 2.0 |
| eiffel | [Eiffel Tower in 2022 01.jpg](https://commons.wikimedia.org/wiki/File:Eiffel_Tower_in_2022_01.jpg) | Maksim Sokolov (maxergon.com) | CC BY-SA 4.0 |
| goldengate | [GGB Marin County line.jpg](https://commons.wikimedia.org/wiki/File:GGB_Marin_County_line.jpg) | Daniel Schwen | CC BY-SA 4.0 |
| goldengate | [Golden Gate Bridge and San Francisco at sunset.jpg](https://commons.wikimedia.org/wiki/File:Golden_Gate_Bridge_and_San_Francisco_at_sunset.jpg) | Brocken Inaglory | CC BY-SA 3.0 |
| goldengate | [Golden Gate Bridge as seen from Battery East.jpg](https://commons.wikimedia.org/wiki/File:Golden_Gate_Bridge_as_seen_from_Battery_East.jpg) | Frank Schulenburg | CC BY-SA 4.0 |
| goldengate | [Golden Gate Bridge at sunset 1.jpg](https://commons.wikimedia.org/wiki/File:Golden_Gate_Bridge_at_sunset_1.jpg) | Brocken Inaglory | CC BY-SA 3.0 |
| goldengate | [Golden Gate Bridge, North view.jpg](https://commons.wikimedia.org/wiki/File:Golden_Gate_Bridge,_North_view.jpg) | Radomianin | CC BY-SA 4.0 |
| goldengate | [Golden Gate Bridge, San Francisco 04.jpg](https://commons.wikimedia.org/wiki/File:Golden_Gate_Bridge,_San_Francisco_04.jpg) | Photograph by Mike Peel (www.mikepeel.net). | CC BY-SA 4.0 |
| goldengate | [Golden Gate Bridge, San Francisco 13.jpg](https://commons.wikimedia.org/wiki/File:Golden_Gate_Bridge,_San_Francisco_13.jpg) | Photograph by Mike Peel (www.mikepeel.net). | CC BY-SA 4.0 |
| goldengate | [Golden Gate Bridge, north tower detail.jpg](https://commons.wikimedia.org/wiki/File:Golden_Gate_Bridge,_north_tower_detail.jpg) | Radomianin | CC BY-SA 4.0 |
| goldengate | [Golden Gate bridge 3.jpg](https://commons.wikimedia.org/wiki/File:Golden_Gate_bridge_3.jpg) | Sebring12Hrs | CC BY-SA 4.0 |
| tokyotower | ["Inner Trip" @ Tokyo Tower (9157891472).jpg](https://commons.wikimedia.org/wiki/File:%22Inner_Trip%22_@_Tokyo_Tower_(9157891472).jpg) | Guilhem Vellut from Annecy, France | CC BY 2.0 |
| tokyotower | [Cherry blossoms and Tokyo tower.jpg](https://commons.wikimedia.org/wiki/File:Cherry_blossoms_and_Tokyo_tower.jpg) | Kirin7739 | CC BY-SA 4.0 |
| tokyotower | [Tokyo 20100813145754 (43437616642).jpg](https://commons.wikimedia.org/wiki/File:Tokyo_20100813145754_(43437616642).jpg) | inunami | CC BY 2.0 |
| tokyotower | [Tokyo Tower (11697017193).jpg](https://commons.wikimedia.org/wiki/File:Tokyo_Tower_(11697017193).jpg) | Guilhem Vellut from Annecy, France | CC BY 2.0 |
| tokyotower | [Tokyo Tower (11697147324).jpg](https://commons.wikimedia.org/wiki/File:Tokyo_Tower_(11697147324).jpg) | Guilhem Vellut from Annecy, France | CC BY 2.0 |
| tokyotower | [Tokyo Tower (11697149454).jpg](https://commons.wikimedia.org/wiki/File:Tokyo_Tower_(11697149454).jpg) | Guilhem Vellut from Annecy, France | CC BY 2.0 |
| tokyotower | [Tokyo Tower (53080608742).jpg](https://commons.wikimedia.org/wiki/File:Tokyo_Tower_(53080608742).jpg) | Dick Thomas Johnson from Tokyo, Japan | CC BY 2.0 |
| tokyotower | [Dramatic View of Illuminated Tokyo Tower.jpg](https://commons.wikimedia.org/wiki/File:Dramatic_View_of_Illuminated_Tokyo_Tower.jpg) | Vinaciv183 | CC0 |
| towerbridge | [London MMB J8 Tower Bridge.jpg](https://commons.wikimedia.org/wiki/File:London_MMB_J8_Tower_Bridge.jpg) | mattbuck (category) | CC BY-SA 3.0 |
| towerbridge | [London MMB K5 Tower Bridge.jpg](https://commons.wikimedia.org/wiki/File:London_MMB_K5_Tower_Bridge.jpg) | mattbuck (category) | CC BY-SA 3.0 |
| towerbridge | [London MMB Y6 Tower Bridge.jpg](https://commons.wikimedia.org/wiki/File:London_MMB_Y6_Tower_Bridge.jpg) | mattbuck (category) | CC BY-SA 3.0 |
| towerbridge | [London MMB »2J1 Tower Bridge.jpg](https://commons.wikimedia.org/wiki/File:London_MMB_%C2%BB2J1_Tower_Bridge.jpg) | mattbuck (category) | CC BY-SA 4.0 |
| towerbridge | [London November 2013-13a.jpg](https://commons.wikimedia.org/wiki/File:London_November_2013-13a.jpg) | Alvesgaspar | CC BY-SA 3.0 |
| towerbridge | [London November 2013-14.jpg](https://commons.wikimedia.org/wiki/File:London_November_2013-14.jpg) | Alvesgaspar | CC BY-SA 3.0 |
| towerbridge | [London November 2013-27b.jpg](https://commons.wikimedia.org/wiki/File:London_November_2013-27b.jpg) | Alvesgaspar | CC BY-SA 3.0 |
