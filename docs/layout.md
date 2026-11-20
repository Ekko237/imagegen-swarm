# Layout

[English](layout.md) | [简体中文](layout.zh-CN.md)

```
imagegen-swarm/
├─ .agents/
│  └─ plugins/
│     └─ marketplace.json      Codex marketplace manifest
├─ .claude-plugin/
│  ├─ marketplace.json         Claude Code marketplace manifest
│  └─ plugin.json              Claude Code plugin manifest (skills: ./skills/imagegen-swarm)
├─ .codex-plugin/
│  └─ plugin.json              Codex plugin manifest (skills: ./skills/)
├─ .github/                    CI workflow, frontmatter check, issue and PR templates
├─ .gitignore
├─ AGENTS.md                   entry point for an agent handed this repo
├─ CHANGELOG.md                release notes
├─ CODE_OF_CONDUCT.md
├─ CONTRIBUTING.md
├─ LICENSE                     MIT
├─ NOTICE                      upstream MIT attribution
├─ README.md                   short English README
├─ README.zh-CN.md             short Chinese README
├─ docs/
│  ├─ clawhub-scan.md          how to reproduce the ClawHub scan
│  ├─ efficiency.png           the 50-image speed chart
│  ├─ faq.md                   common questions
│  ├─ faq.zh-CN.md             common questions in Chinese
│  ├─ how-it-works.md          why the queue is shared this way
│  ├─ how-it-works.zh-CN.md    the same notes in Chinese
│  ├─ install.md               plugin, folder, and Windows install
│  ├─ install.zh-CN.md         install notes in Chinese
│  ├─ keep-rate.md             what keep counts
│  ├─ keep-rate.zh-CN.md       what keep counts, in Chinese
│  ├─ layout.md                this file
│  ├─ layout.zh-CN.md          this tree in Chinese
│  ├─ series-consistency-validation.md   series-consistency validation report
│  ├─ series-mode.md           series mode
│  ├─ series-mode.zh-CN.md     series mode in Chinese
│  ├─ showcase.webp            sample images, each labeled with its engine
│  ├─ tests.md                 test commands
│  ├─ tests.zh-CN.md           test commands in Chinese
│  ├─ timeline.png             lane timeline of the 50-image batch
│  ├─ usage.md                 job fields and the batch example
│  └─ usage.zh-CN.md           usage notes in Chinese
├─ examples/                   example job files and the Lovart wrapper script
├─ skills/
│  └─ imagegen-swarm/          the skill itself
│     ├─ .clawhubignore        files ClawHub skips when publishing
│     ├─ SKILL.md              instructions the agent follows
│     ├─ SETUP.md              engine setup, logins and credential paths
│     ├─ skill-card.md         short skill card
│     ├─ references/           Codex, Lovart and Muse notes
│     └─ scripts/              engine scripts, batch runner, image tools
└─ tests/
   ├─ evals/                   eval runner, fixed tasks, series-consistency validation
   ├─ fixtures/                small licensed test images
   ├─ reliability.test.mjs
   ├─ reliability_rename_test.py
   ├─ series-consistency.test.mjs
   └─ series.test.mjs
```
