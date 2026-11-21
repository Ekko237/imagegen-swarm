## Change

Describe the problem, resulting behavior, and related issue (if any).

## Checklist

- [ ] This PR is focused and targets `main`.
- [ ] Relevant docs and tests are updated; release metadata is aligned if applicable.
- [ ] No credentials, personal information, generated media, or Python bytecode caches are included.
- [ ] I followed [CONTRIBUTING.md](../CONTRIBUTING.md) and the [Code of Conduct](../CODE_OF_CONDUCT.md).
- [ ] With Pillow installed (`python3 -m pip install pillow`), I ran the CI checks below and reported any failures.
- [ ] For release changes, I ran `npm run smoke` and pasted the results with any SKIP reasons.

```bash
node .github/check-frontmatter.mjs
```

```bash
set -euo pipefail
for f in skills/imagegen-swarm/scripts/*.mjs; do
  node --check "$f"
done
python3 -m py_compile skills/imagegen-swarm/scripts/*.py
```

```bash
npm test
```

Results (and any relevant manual or live eval results):
