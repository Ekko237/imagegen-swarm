# imagegen-swarm

[English](README.md) | [简体中文](README.zh-CN.md)

手上有好几家 AI 出图工具，额度每月用不完就作废？imagegen-swarm 是一个 Claude Code / Codex 技能，把它们排进同一个队列，一次批量出图，哪家额度用完就换下一家。

<p align="center">
  <img src="docs/demo.gif" alt="终端演示：只用 gemini 一家引擎，开 6 条通道同时画 6 张图" width="720" />
</p>
<p align="center">
  <em>真实终端录制：只用 gemini，参数 <code>--lanes gemini=6</code>，6 张图同时开画并一起出齐。不是多引擎演示。</em>
</p>

<p align="center">
  <img src="docs/showcase.webp" alt="imagegen-swarm 画的 12 张图拼成的网格，每张都标着是哪家引擎画的：gemini、jimeng（即梦）、codex、grok、lovart 或 muse" width="520" />
</p>

```bash
npx skills add Ekko237/imagegen-swarm@v1.4.2 -a claude-code -a codex
```

觉得有用请点右上角 ★ Star，能让更多人搜到。

## 它解决什么问题

出图额度散在好几家工具里，按周或按月刷新，大多放着不用，到期就作废。只用一家又慢，做到一半额度用完，这批就停。再手动换到下一家，把没做完的图接上，很麻烦。

## 适合谁

需要 Node.js 18+，以及装了 Pillow 的 Python 3（`python3 -m pip install pillow`）。macOS、Windows、Linux 都能用。生成前至少登录一个引擎。Lovart 需要官方 AK/SK。有一家就能用，接上的越多，生成越快。各家凭据路径见 [SETUP.md](skills/imagegen-swarm/SETUP.md)。

## 快速使用

让你的 agent 画一片蓝底上的柠檬切片。你应该得到一张新的 PNG，这次运行会记下是哪家出的。同一项任务，在仓库根目录运行：

```bash
cat > jobs.json <<'EOF'
[
  {"id": "lemon", "prompt": "a lemon slice on a blue background, flat illustration", "aspect": "1:1"}
]
EOF
node skills/imagegen-swarm/scripts/batch.mjs --jobs jobs.json --out out/
```

文件是 `out/lemon.png`。在已安装的技能文件夹里，去掉前面的 `skills/imagegen-swarm/`。任务字段、更完整的例子、以及单独调用一个引擎：[用法](docs/usage.zh-CN.md)。

## 引擎

| 引擎 | 能做什么 | 通过什么出图 |
|---|---|---|
| **codex** | 出图、参考图 | Codex 命令行内置的 `image_gen`（用你的 Codex / ChatGPT 登录） |
| **jimeng（即梦）** | 出图、改图（最多 10 张参考图）、文生视频、图生视频 | 即梦官方命令行（用你的抖音登录） |
| **grok** | 出图、改图、参考图生成视频 | Grok Build 命令行的 Imagine 工具 |
| **gemini** | 出图、改图（最多 3 张参考图） | Antigravity 命令行的 `generate_image` |
| **muse** | 出图、参考图 | 用无头浏览器操作 Muse（muse.ai） |
| **lovart** | 出图、参考图 | Lovart 官方命令行（你自己的 AK/SK） |
| **api**（可选，付费） | 出图、改图 | 用你自己 key 的 OpenAI 出图接口或 Gemini API，按张付费 |

## 实测结果

50 张图 2.3 分钟，比单引擎快 11 倍（只算生成时间，见[保留率](docs/keep-rate.zh-CN.md)）。

<p align="center">
  <img src="docs/efficiency.png" alt="50 张图的生成时间 2.3 分钟，比单个引擎快 11 倍，8GB 内存的 M1 MacBook Pro 上实测。不含筛图和风格重做" width="100%" />
</p>

<p align="center">
  <em>这是一次实测的生成时间。2.3 分钟和 11 倍都算到文件写完为止。筛图和按风格重做不在这段时间里。见<a href="docs/keep-rate.zh-CN.md">保留率</a>。</em>
</p>

每家引擎同时开几条通道，每条通道做完一张就接队列里的下一张；某家额度用完，别家接着做。下图就是上面那张结果卡对应的那一批 50 张的真实记录：中途 Gemini、Lovart 额度用完，50 张照样全部交付。

结果卡上的 2.3 分钟只算生成时间：从开工到这 50 张文件写完。看图、以及角色或品牌对不上时的重做，都不在这 2.3 分钟里。11 倍是拿这 2.3 分钟和单引擎的 26.7 分钟比。单引擎用的是这一批里最快的 Gemini，按实测每张 32 秒。两边都只算生成时间。这次运行的日志不在仓库里，所以结果卡上没有保留率。怎么数，见[保留率](docs/keep-rate.zh-CN.md)。

这只是我们的一次测试，你跑出来的数字会不一样：速度取决于你在各家有多少额度。这次 Lovart、Muse 用的是免费额度，Gemini 和 Lovart 还中途用完了；额度更多的话，每家都能一直干到最后，生成通常会比这次更快。

![50 张那一批的时间线：每个格子是一张图，每一行是一条同时在干活的通道](docs/timeline.png)

## 社区

用过了？开一个 issue，告诉我哪里坏了，或者你做出了什么。报 bug 时附上 `out/batch-results.json`，先去掉密钥（含 AK/SK）、token、cookie、账号 ID 和个人信息。欢迎提 issue 和 PR，见 [CONTRIBUTING.md](CONTRIBUTING.md)。安装和额度的问题见[常见问题](docs/faq.zh-CN.md)。

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Ekko237/imagegen-swarm?style=flat&color=24292f" alt="MIT license" /></a>
  &nbsp;
  <a href="https://github.com/Ekko237/imagegen-swarm/releases/latest"><img src="https://img.shields.io/github/v/release/Ekko237/imagegen-swarm?style=flat&color=24292f" alt="Latest release" /></a>
  &nbsp;
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/changelog-CHANGELOG.md-24292f?style=flat" alt="Changelog" /></a>
</p>

MIT，见 [LICENSE](LICENSE)。Codex 的指令模板参考了 `baoyu-image-gen` 的 codex-imagegen 包装，上游的 MIT 声明见 [NOTICE](NOTICE)。

## 更多

- 并行、看额度、核对文件、按内存开通道、能续跑，以及可选的按次付费：[为什么做这个](docs/how-it-works.zh-CN.md)。
- 插件、文件夹和 Windows 安装，以及版本为什么钉死：[安装](docs/install.zh-CN.md)。
- 任务字段、更完整的一批，以及单独调用一个引擎：[用法](docs/usage.zh-CN.md)。
- 一套图统一风格，你同意才打开：[系列图模式](docs/series-mode.zh-CN.md)。
- `keep` 各字段在数什么，以及怎么自己量保留率：[保留率](docs/keep-rate.zh-CN.md)。
- 安装、登录、额度和 API 密钥：[常见问题](docs/faq.zh-CN.md)。
- 测试命令：[测试](docs/tests.zh-CN.md)。
- 仓库目录：[文件](docs/layout.zh-CN.md)。
