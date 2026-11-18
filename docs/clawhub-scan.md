# ClawHub security scan: how to reproduce and what is left

ClawHub runs SkillSpector (commit `95a52d8`) with ClawScan's `skillspector-responses.patch`
on the published bundle: the `skills/imagegen-swarm/` folder minus `.clawhubignore`. The
static stage is deterministic and can be run locally:

```bash
# bundle = skill folder minus evals/, *.test.mjs, *_test.py, *.example.sh, jobs.example.json, __pycache__/
skillspector scan <bundle-dir> --no-llm --format json -o scan.json
```

`analysis_completeness` in the JSON gives coverage and the partial files; `issues` lists findings.

## Results

| | v1.3.4 (main) | this branch |
|---|---|---|
| Score | 92 CRITICAL | 52 HIGH |
| Coverage | 60.0% (18/30), 12 partial | 63.3% (19/30), 11 partial |
| AR2 anti-refusal | 1 | 0 |
| EA2 autonomous decision | 5 | 0 |
| E5 cloud storage upload | 1 | 0 |
| TT2 tainted flow | 1 | 1 (see below) |
| AE1 partial referenced artifact | 20 | 30 (more lines name scripts; score impact is capped at 3 per rule) |

## Why JavaScript files stay "partial"

`static_patterns_tool_misuse` marks a `.mjs` file `opaque_content` when
`JavaScriptSourceOwnership(...).unsupported_values()` is non-empty
(`src/skillspector/javascript_source.py`, `javascript_values.py`). Every *constructed*
string (template literal, `+` with a string, `path.join(...)` with literal parts, or a call
that returns one) must be proved to reach only these sinks:

- `node:fs` / `node:fs/promises` path arguments of `readFile`, `readFileSync`, `stat`,
  `statSync`, `open`, `rename`, `rm`, `mkdir`, `createWriteStream` (not `existsSync`,
  `writeFile`, `appendFile`, `mkdtemp`, `readdir`, `copyFile`);
- `path.join` / `resolve` / `dirname` / `basename` (whose result is traced again);
- `fetch`, `new URL`, `process.stdout.write`, `process.stderr.write`, `JSON.stringify`;
- `throw new Error(...)`, but only in a module with no `export`, no class, and no
  `.on` / `.then` / `.once` member anywhere;
- a single-template `console.log` / `console.error` in a module that imports only
  `node:path`, `node:fs`, `node:child_process`.

Any other consumer (a `spawn` argv array, an imported helper, a property write, an object
returned to a caller) leaves the value unsupported. The module docstring states the
intent: "Unresolved constructed values retain incomplete coverage." The engine wrappers
build argv for user-installed CLIs (`--ratio=<r>`, `--submit_id=<id>`, the prompt sent to
`grok -p`, temp paths), throw `Error`s from exported functions, and use `child.on(...)`.
Proving those would take either a scanner change or code written to avoid the proof
(hiding construction behind rest-parameter joins, arrow-return blind spots, `path.resolve`
instead of `path.join`). This branch does neither.

Two analyzer details made things worse than they had to be, and both are fixed here:

- `import process from "node:process"` shadows the global, so `process.stdout.write`
  stopped counting as a known sink in `check.mjs`, `codex-image.mjs`, `jimeng.mjs` and
  `lovart.mjs`. The import was redundant and is removed.
- `failureText` in `batch-policy.mjs` called `.includes` on a `String(...)` built from a
  literal fallback. It now converts once and compares; outputs are identical, and the file
  is now fully inspected.

`safety.mjs` (marker contents passed to `writeFile`) and `series-policy.mjs` (an `Error`
thrown from an exported helper) stay partial for the same reasons.

## TT2 (Muse profile lock file)

`behavioral_taint_tracking.py` is a pure data-flow tracker with no sanitizer model.
`IMAGE_GEN_MUSE_PROFILE` is validated by `allowed_profile()` in `scripts/muse-image.py`
(must resolve under `$HOME/.config/imagegen-swarm`, or be the legacy default) and that is
covered by `tests/reliability_rename_test.py::test_profile_stays_on_the_documented_default`.
The lock path is still derived from the validated value, so the flow is reported. Clearing
it would need a write API the tracker does not list (`os.open`, `Path.touch`), which would
only hide the same write, so it is left as is.

## reference_missing

These ledger entries are non-fatal and not findings. Most come from `$HOME/...` paths
(the tracker reads `HOME/...` after `$`), dotted field names such as `series.style`, and
repository-only paths under `tests/`. The example job files are now linked by URL.
