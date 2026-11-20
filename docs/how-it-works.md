# Why

[English](how-it-works.md) | [简体中文](how-it-works.zh-CN.md)

Run batch image and video generation across six engines in parallel, using the Codex, Jimeng, Grok, Gemini and Muse accounts you already have (Lovart uses its official AK/SK).

Image tools give you weekly or monthly quotas that mostly sit unused. Running one engine at a time is slow and stops at its limit. `imagegen-swarm` puts all your accounts on a single queue:

* **Parallel**: every engine runs multiple lanes at once; any free lane grabs the next compatible job.
* **Quota-aware**: if an engine reports exhausted quota, a missing login, or a missing install, it shuts down and returns its job to the queue. Plain rate limits trigger a backoff and only shut the engine down after three in a row.
* **Correct**: checks every file to confirm it is new from this run, re-runs wrong aspect ratios on another engine, and output is always real PNG.
* **Fits your machine**: lane counts scale with RAM, from 12 lanes on a 4 GB laptop to 34 on 16 GB or more. Want to keep memory free for other apps? Cap memory usage with `IMAGE_GEN_MEMORY_GB=4`, or set exact lane counts with `--lanes gemini=2,codex=2`.
* **Resumable**: rerun the same job list and already-finished images are skipped.
* **Optional paid last resort**: add a pay-per-image API line (OpenAI or Gemini API). It only takes images no subscription engine can take, so the queue keeps going when every quota runs dry at once, and it stops at the per-batch and per-month budgets you set.

The 50-image run is on the [README](../README.md#tested-results). What `keep` counts is in [Keep rate](keep-rate.md).
