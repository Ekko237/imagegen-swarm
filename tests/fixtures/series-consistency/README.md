# Series-consistency test fixtures

Six images, downscaled to at most 256 px on the long side and re-encoded as JPEG (quality 85),
used by `tests/series-consistency.test.mjs`. They are not part of the published skill. The
modification for every file is the same: resized and re-encoded; no other change.

| File | Source (Wikimedia Commons) | Author | License |
|---|---|---|---|
| `tower-a.jpg` | [Tokyo 20100813145754 (43437616642).jpg](https://commons.wikimedia.org/wiki/File:Tokyo_20100813145754_(43437616642).jpg) | inunami | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) |
| `tower-b.jpg` | [Tokyo Tower (11697017193).jpg](https://commons.wikimedia.org/wiki/File:Tokyo_Tower_(11697017193).jpg) | Guilhem Vellut | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) |
| `pepper-a.jpg` | [David Revoy - Pepper&Carrot - October Ink Artworks 2017 (week 1) - Long.jpg](https://commons.wikimedia.org/wiki/File:David_Revoy_-_Pepper%26Carrot_-_October_Ink_Artworks_2017_(week_1)_-_Long.jpg) | David Revoy, www.peppercarrot.com | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) |
| `pepper-b.jpg` | [David Revoy - Pepper&Carrot - October Ink Artworks 2017 (week 1) - Swift.jpg](https://commons.wikimedia.org/wiki/File:David_Revoy_-_Pepper%26Carrot_-_October_Ink_Artworks_2017_(week_1)_-_Swift.jpg) | David Revoy, www.peppercarrot.com | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) |
| `tux-a.jpg` | [03-March Reading for life.svg](https://commons.wikimedia.org/wiki/File:03-March_Reading_for_life.svg) (rendered PNG thumbnail) | Moini; Tux character originally by Larry Ewing (lewing@isc.tamu.edu), created with The GIMP | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `eiffel-a.jpg` | [Detail structure Tour Eiffel.jpg](https://commons.wikimedia.org/wiki/File:Detail_structure_Tour_Eiffel.jpg) | Jebulon | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

The tests also draw their own procedural images at run time; those have no third-party content.

The full validation set (99 images, 16 groups) is not stored in this repository. It is listed in
`tests/evals/series-consistency/dataset.json` and downloaded by `fetch.py` only when someone runs
the validation. See `docs/series-consistency-validation.md`.
