# Tests

[English](tests.md) | [简体中文](tests.zh-CN.md)

From the repository root:

```bash
node tests/evals/run.mjs out/                         # every fixed task, including a mixed batch
node tests/evals/run.mjs out/ --only gemini-t2i,batch-mixed
node tests/reliability.test.mjs               # log parsing, rate limits, steal threshold, Lovart wrapper
node tests/series.test.mjs                    # series anchor, mock engines, palette score
node tests/series-consistency.test.mjs        # structure / clip-fallback scores, real and procedural fixtures
python3 tests/reliability_rename_test.py      # Muse rename and fail-closed approval checks
python3 tests/clip_hash_test.py
node tests/smoke-logic.test.mjs
```

`npm test` runs the offline CI suite. The smoke logic tests run fake engines and test image
validation, skip reasons, billing gates, cleanup, and required-engine exit status. They never
contact provider accounts. To run real engine smoke, follow the [release checklist](release-checklist.md).


The `tests/evals/run.mjs` lines are live evals: they need configured engines and can spend quota or a paid API budget. They are not CI. The reliability and series tests use fixtures rather than live providers. The check list is in [CONTRIBUTING.md](../CONTRIBUTING.md).
