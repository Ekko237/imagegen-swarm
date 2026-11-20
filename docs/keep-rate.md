# Keep rate

[English](keep-rate.md) | [简体中文](keep-rate.zh-CN.md)

Count three different things: images an engine returned, images saved as the job output, and images you still want after you look at them.

The 50-image run delivered 50 files. That is the number on the [chart](../README.md#tested-results). This repository does not include that run's `batch-results.json` or a screening log, so it has no measured keep rate for the run.

After a batch, the last JSON line and `out/batch-results.json` include `keep`, counted from the attempts in that run:

| Field | What it counts |
| --- | --- |
| `generated` | Attempts where the engine returned an image file |
| `kept` | Those files saved as `out/<id>.png` (`.mp4` for video) after the automatic checks |
| `redone` | Returned files dropped because the aspect ratio was off by more than 3%, then put back on the queue |
| `duplicates` | Extra files from a tail steal. The first copy to finish is the one in `kept`; the other is dropped |
| `style_redos` | Returned files dropped because a series-mode style score was below the threshold. This is 0 when series mode is off |
| `resumed` | Jobs skipped because the output file was already on disk. These sit outside `generated` |

`generated` adds up as `kept` + `redone` + `duplicates` + `style_redos`. An engine error, a timeout, or a quota failure returns no file, so it stays out of `keep`. The job is still retried on another engine, up to `--tries` (default 3). `done` on the same summary is saved jobs plus resumed jobs. `elapsed_seconds` is generation time only. `delivery_seconds` is the wall clock until the summary, and in series mode that includes style screening and style redos.

`keep` counts those automatic checks: the file is new from this run, it is not a copy of a reference image, the aspect ratio is within 3% when the job set one, and, in series mode, the consistency score is at least the threshold. That score does not prove character identity. The fixed tasks in `tests/evals/evals.json` use a 1–5 content rubric, and a pass is 4 or higher. A batch eval writes the same `keep` object onto its result line. The repository stores the rubric and does not store scored runs.

For a same-character, same-brand, or cover series, see [series mode](series-mode.md). Still look at every kept file.

To measure a style keep rate without series mode:

1. Run the batch.
2. Read `keep` for the automatic counts.
3. Look at every file and count how many you would ship. That count is your usable number.
4. Delete the files you reject and run the same job list again. Files still on disk are skipped. A new job for an outlier works the same way. Each replacement is a redo.
5. Add the time you spent screening and regenerating to `elapsed_seconds`. That sum is delivery time. Series mode records the same kind of total as `delivery_seconds`.

`elapsed_seconds` alone is generation time only. The 50-image [chart](../README.md#tested-results) has no measured keep rate.

Calling one engine directly is in [Usage](usage.md).
