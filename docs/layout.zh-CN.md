# 文件

[English](layout.md) | [简体中文](layout.zh-CN.md)

```
imagegen-swarm/
├─ .agents/
│  └─ plugins/
│     └─ marketplace.json      Codex 市场清单
├─ .claude-plugin/
│  ├─ marketplace.json         Claude Code 市场清单
│  └─ plugin.json              Claude Code 插件清单（skills: ./skills/imagegen-swarm）
├─ .codex-plugin/
│  └─ plugin.json              Codex 插件清单（skills: ./skills/）
├─ .github/                    CI、frontmatter 检查、issue 和 PR 模板
├─ .gitignore
├─ AGENTS.md                   交给 agent 时的入口
├─ CHANGELOG.md                版本说明（英文）
├─ CODE_OF_CONDUCT.md
├─ CONTRIBUTING.md
├─ LICENSE                     MIT 许可
├─ NOTICE                      上游 MIT 声明
├─ README.md                   英文短说明
├─ README.zh-CN.md             中文短说明
├─ docs/
│  ├─ clawhub-scan.md          怎么复现 ClawHub 扫描（英文）
│  ├─ efficiency.png           50 张图的速度结果卡
│  ├─ faq.md                   常见问题（英文）
│  ├─ faq.zh-CN.md             常见问题
│  ├─ how-it-works.md          为什么这样做（英文）
│  ├─ how-it-works.zh-CN.md    为什么这样做
│  ├─ install.md               插件、文件夹和 Windows 安装（英文）
│  ├─ install.zh-CN.md         安装说明
│  ├─ keep-rate.md             keep 各字段在数什么（英文）
│  ├─ keep-rate.zh-CN.md       keep 各字段在数什么
│  ├─ layout.md                仓库目录（英文）
│  ├─ layout.zh-CN.md          本文件
│  ├─ series-consistency-validation.md   系列一致性验证报告（英文）
│  ├─ series-mode.md           系列图模式（英文）
│  ├─ series-mode.zh-CN.md     系列图模式
│  ├─ showcase.webp            样例图，每张标着是哪家引擎画的
│  ├─ tests.md                 测试命令（英文）
│  ├─ tests.zh-CN.md           测试命令
│  ├─ timeline.png             50 张那一批的通道时间线
│  ├─ usage.md                 任务字段和批量例子（英文）
│  └─ usage.zh-CN.md           用法
├─ examples/                   示例任务文件和 Lovart 包装脚本
├─ skills/
│  └─ imagegen-swarm/          技能本体
│     ├─ .clawhubignore        ClawHub 发布时跳过的文件
│     ├─ SKILL.md              agent 遵循的说明
│     ├─ SETUP.md              各引擎的安装、登录和凭据路径
│     ├─ skill-card.md         技能简介卡
│     ├─ references/           Codex、Lovart、Muse 的说明
│     └─ scripts/              各引擎脚本、批量调度、图片工具
└─ tests/
   ├─ evals/                   评测脚本、固定用例、系列一致性验证
   ├─ fixtures/                少量有许可的小测试图
   ├─ reliability.test.mjs
   ├─ reliability_rename_test.py
   ├─ series-consistency.test.mjs
   └─ series.test.mjs
```
