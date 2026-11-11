# Changelog

## 1.0.0 - 2026-11-10

First public release. Tag `v1.0.0`.

- **50 images in 2.3 minutes on an 8 GB M1 MacBook Pro, 11 times faster than one engine alone.** One test run. Gemini and Lovart ran out partway through, and all 50 images were still delivered. Lovart and Muse were on free plans. Speed depends on how much quota you have with each engine.
- **Six engines share one queue.** Codex, Jimeng, Grok, Gemini, Muse, and Lovart. A free lane takes the next image. An engine that reports exhausted quota, no login, or no install is shut down, and its job goes back to the queue.
- **No image API key for most engines.** You generate with the Codex and Jimeng accounts you already have. Grok, Gemini and Muse use their own account logins. Lovart uses its official AK/SK, stored on your machine. Jimeng also generates videos.
- **Lane counts follow RAM.** 12 lanes on a 4 GB laptop, 34 on 16 GB or more. Rerun the same job list and finished images are skipped.
