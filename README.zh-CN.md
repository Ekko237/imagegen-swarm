# imagegen-swarm

[English](README.md) · **简体中文**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-skill-D97757)](SKILL.md)
[![Codex](https://img.shields.io/badge/Codex-skill-111111)](SKILL.md)

**在 Claude Code / Codex 里出图、出视频，用你已经登录过的账号——不用另备 API 密钥。**

这是一个名叫 `image-gen` 的技能。你已经登录的引擎——Codex、Grok、Gemini、Muse、Lovart——共用一份任务清单，哪条通道空着就接下一张它做得了的图。视频只有 Grok 能做，而且必须带参考图。Codex、Grok、Gemini、Muse 用的是你机器上现成的产品登录。Lovart 如果启用，读的是放在本仓库之外的访问密钥。

<!--
演示：录一段真实的 Claude Code 或 Codex 会话，存成 docs/demo.gif，
再取消下一行的注释。不要放生成出来的占位图。
说明见 docs/README.md。
![在 Claude Code 或 Codex 里出图的演示](docs/demo.gif)
-->

仓库里还没有会话 GIF（[怎样补上](docs/README.md)）。下面两张是 `docs/` 里已经有的静帧。

![一批十张图，每张标着是哪家引擎出的](docs/showcase.jpg)

![同一批的时间线：Codex、Grok、Muse 的通道](docs/timeline.png)

## 为什么做这个

你已经在用的每家出图产品，额度各自计算，一家用完就停。imagegen-swarm 把你登录好的引擎放进同一个队列：

- **并行。** Gemini、Codex、Grok、Lovart 各开 2 条通道。Muse 只有一份浏览器配置，所以只开 1 条。
- **看额度。** 某家报额度用完、没登录或没安装，就关掉它，手上的活退回队列。
- **有核对。** 每张图都要是这一次新生成的。你指定了比例、结果偏差超过 3%，这张作废，换一家重做。图片存成真正的 PNG，视频存成 MP4。
- **能续跑。** 同一份清单再跑一次，已经生成的文件会跳过。

有一家就能用。多登录一家，就能接走别家做不了的活。

## 快速开始

需要 Node.js 18 或更新版本，以及 Python 3。目录名必须是 `image-gen`。Windows 请在 Git Bash 里执行，或者克隆到 `%USERPROFILE%\.claude\skills\image-gen`（Codex 则是 `%USERPROFILE%\.codex\skills\image-gen`）。

### 1. 克隆到技能目录

Claude Code：

```bash
mkdir -p ~/.claude/skills
git clone https://github.com/Ekko237/imagegen-swarm.git ~/.claude/skills/image-gen
```

Codex：

```bash
mkdir -p ~/.codex/skills
git clone https://github.com/Ekko237/imagegen-swarm.git ~/.codex/skills/image-gen
```

两个都用，就两段都执行。

### 2. 安装 Pillow

每家引擎都用它来转换和核对图片。

```bash
python3 -m pip install pillow
```

Windows 上这些脚本默认调用 `python`，除非你设置了 `PYTHON`。那边请用 `python -m pip install pillow`。

### 3. 看哪几家已经能用

装在 Claude Code 时：

```bash
node ~/.claude/skills/image-gen/scripts/check.mjs
```

装在 Codex 时：

```bash
node ~/.codex/skills/image-gen/scripts/check.mjs
```

有一家显示 `READY` 就可以开始。这个检查看的是登录状态，不看剩余额度。还没就绪的，按 [SETUP.md](SETUP.md) 登录。Muse 另外需要 Playwright（`pip install playwright && playwright install chromium`）。

## 用法

在 Claude Code 或 Codex 里直接说就行。这类说法会触发技能：「generate an image」「draw」「edit this image」「make a video」，以及你点名某家引擎（`codex`、`grok`、`gemini`、`muse`、`lovart`）：

> Generate an image of a lemon slice on a blue background, flat illustration, square.

> Edit that image: the same lemon slice, but at night.

> Make a 16:9 video from this kite image.

点了名就只跑那一家。交回来的是 PNG 图片，或者 MP4 视频。技能让 agent 把这一批写到 `out/`：

| 结果 | 路径 |
|---|---|
| 图片 | `out/<id>.png` |
| 视频 | `out/<id>.mp4` |
| 每张是哪家出的、花了多少秒 | `out/batch-results.json` |

进度一行一个 JSON。视频只走 Grok，要有一张参考图，时长 6 秒、720p。

同一批也可以自己在技能目录里跑：

```bash
cd ~/.claude/skills/image-gen   # 或 ~/.codex/skills/image-gen
cat > jobs.json <<'EOF'
[
  {"id": "lemon", "prompt": "a lemon slice on a blue background, flat illustration", "aspect": "1:1"},
  {"id": "kite",  "prompt": "a red kite in a clear sky, minimal", "aspect": "3:4"},
  {"id": "whale", "prompt": "a blue whale in the deep ocean, low poly", "aspect": "16:9"},
  {"id": "night", "prompt": "the same lemon slice, but at night", "ref": ["out/lemon.png"]}
]
EOF
node scripts/batch.mjs --jobs jobs.json --out out/
```

每项必填 `id` 和 `prompt`。`aspect`、`ref`、`video`、`engine` 可选。`ref` 相对任务文件所在目录。单个引擎的脚本也能单独跑，例如 `node scripts/gemini-image.mjs --prompt "..." --out a.png --aspect 1:1`。通道数、重试和全部参数见 [SKILL.md](SKILL.md)。

## 引擎

| 引擎 | 能做什么 | 怎么登录 | 比例 | 大概耗时 |
|---|---|---|---|---|
| **codex** | 出图、参考图 | Codex 命令行（`codex login`）。不读 `OPENAI_API_KEY` | `--aspect`，像素尺寸由模型决定 | 约 30 秒 |
| **grok** | 出图、改图（1 张参考图）、参考图生成视频 | Grok Build 命令行（`grok models` 能列出模型） | 真正的 `--ratio`：1:1、16:9、9:16、3:2、2:3 | 约 45 秒 |
| **gemini** | 出图、改图（最多 3 张参考图） | Antigravity 命令行（`agy`） | 真正的 `--aspect`：1:1、2:3、3:2、3:4、4:3、9:16、16:9 | 20–45 秒 |
| **muse** | 出图、参考图 | 浏览器登录 muse.ai（`python3 scripts/muse-image.py --login`） | 写进任务说明；七种比例与 Gemini 相同 | 1–2 分钟 |
| **lovart** | 出图、参考图 | 访问密钥放在 `~/.lovart/env` | 只写进提示词 | 约 35 秒 |

「大概耗时」是 [SKILL.md](SKILL.md) 里已有的预期，不是本页测出来的成绩。各家细节见 [references/codex.md](references/codex.md)、[references/lovart.md](references/lovart.md)。

## 常见问题

### 要钱吗？

仓库是 MIT，本身不向你收费。生成花的是你登录的那家产品的额度：Codex 套餐用量、X / Grok 套餐、Antigravity（Gemini）额度、Muse 的每周限额，或 Lovart 积分。Lovart 的 `fast` 会扣积分。`unlimited` 只覆盖部分模型，还可能排队，不能当成稳定的免费档。详见 [references/lovart.md](references/lovart.md)。

### 登录和提示词去哪了？

登录留在各家自己的目录：`~/.codex`、`~/.grok`、`~/.gemini`、`~/.config/image-gen/muse-browser`、`~/.lovart`。这个仓库里没有账号。提示词会发给接这张图的那家引擎。Muse 用无头浏览器操作 muse.ai。Grok 出视频需要你在 Grok 里把数据共享设为 Opt in。遇到零数据保留的报错，脚本只告诉你，不会擅自改这项设置。

### 文件存在哪？

目录由 `--out` 指定。一批任务会写出 `<out>/<id>.png`；任务里 `"video": true` 时是 `<out>/<id>.mp4`。旁边还有 `<out>/batch-results.json`。目标路径上已有非空文件就保持原样，所以重跑是接着做。Codex 会把新图从 `$CODEX_HOME/generated_images`（默认 `~/.codex/generated_images`）复制出来，并拒绝和旧文件相同的结果。

### 哪些系统能用？

macOS、Windows、Linux 可以跑 Node 引擎（Codex、Grok、Gemini、Lovart）和 `batch.mjs`。需要 Node.js 18+，以及装了 Pillow 的 Python 3。Windows 上这些脚本调用 `python`，除非设置了 `PYTHON`。Muse 用 `fcntl` 锁浏览器配置，就绪检查也是用 `python3` 启动它，所以 Muse 请在 macOS 或 Linux 上用，并装好 Playwright 和 Chromium。

## 参与

欢迎提 [Issue](https://github.com/Ekko237/imagegen-swarm/issues/new?template=bug_report.md) 和 Pull Request，安装问题和引擎故障都可以。请用[缺陷报告模板](.github/ISSUE_TEMPLATE/bug_report.md)，不要贴密钥、`auth.json`，也不要贴家目录下的路径。见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可

MIT © 2026 Ekko237，见 [LICENSE](LICENSE)。Codex 的指令模板参考了 `baoyu-image-gen`，上游的 MIT 声明见 [NOTICE](NOTICE)。
