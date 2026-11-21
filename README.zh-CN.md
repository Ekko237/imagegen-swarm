# imagegen-swarm

[English](README.md) | [简体中文](README.zh-CN.md)

手上有好几家 AI 出图工具，额度每月用不完就作废？imagegen-swarm 是一个 Claude Code / Codex 技能，把它们排进同一个队列，一次批量出图，哪家额度用完就换下一家。

## 适合谁

已经付了好几家 AI 出图订阅、又要批量出图的独立开发者、内容创作者和电商卖家。手里常见的是 Codex、Gemini、Grok、Muse、Lovart、即梦（Jimeng / Dreamina）这类额度。封面、文章配图、商品图，或一次出一组变体，都可以丢进同一个队列。先登录一家就能用，接上的越多，这一批结束得越快。

## 为什么现在就该试

出图额度散在好几家工具里，按周或按月刷新，大多放着不用，到期就作废。只用一家又慢，做到一半额度用完，这批就停。

一次实测里，在 8GB 内存的 M1 MacBook Pro 上，同一队列用 2.3 分钟的生成时间出完 50 张图，比这次跑得最快的那家单独干要快 11 倍。做到一半，Gemini 和 Lovart 额度用完，其余引擎仍把 50 张全部交了。图和注意事项见[实测结果](#实测结果)。

另有一份生产记录，覆盖 2026-09-20 至 2026-11-21 之间有出图的 30 天，本技能的引擎（codex、jimeng、lovart、gemini、muse 和 grok）一共交付了 1,265 张图。这 30 天里有 20 天同时用到了两家或更多引擎。这份记录里没有每张图的耗时。

```bash
npx skills add Ekko237/imagegen-swarm@v1.4.2 -a claude-code -a codex
```

[用法](docs/usage.zh-CN.md) · [反馈 / 提 issue](https://github.com/Ekko237/imagegen-swarm/issues) · [贡献指南](CONTRIBUTING.md) · [ClawHub](https://clawhub.ai/ekko237/skills/imagegen-swarm) · [skills.sh](https://skills.sh/ekko237/imagegen-swarm)

觉得有用请点右上角 ★ Star，能让更多人搜到。

## 运行要求

需要 Node.js 18+，以及装了 Pillow 的 Python 3（`python3 -m pip install pillow`）。macOS、Windows、Linux 都能用。生成前至少登录一个引擎。Lovart 需要官方 AK/SK。有一家就能用，接上的越多，生成越快。各家凭据路径见 [SETUP.md](skills/imagegen-swarm/SETUP.md)。

<p align="center">
  <img src="docs/demo.gif" alt="终端演示：只用 gemini 一家引擎，开 6 条通道同时画 6 张图" width="720" />
</p>
<p align="center">
  <em>真实命令行录制：只用 gemini 一家引擎，6 个任务同时跑。多引擎录屏稍后补上。</em>
</p>

<p align="center">
  <img src="docs/showcase.webp" alt="imagegen-swarm 画的 12 张图拼成的网格，每张都标着是哪家引擎画的：gemini、jimeng（即梦）、codex、grok、lovart 或 muse" width="520" />
</p>
<p align="center">
  <em>六家引擎画出的图，每张都标着是哪家画的：gemini、jimeng（即梦）、codex、grok、lovart 或 muse。</em>
</p>

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

## 什么时候别用

- 不适合裁剪、缩放、转格式，或其它普通的本地图片处理。
- 生成前至少要登录一家引擎，或者配好可选的按张付费 API。一家都没有，队列没有引擎可跑。
- 只有即梦（Jimeng）和 Grok 能做视频。Codex、Gemini、Muse、Lovart 和可选的 API 线路只出图（以及各自支持的改图或参考图），不能做视频。

## 和其他做法比

| | 手动换工具 | 按张调用付费 API | imagegen-swarm |
| --- | --- | --- | --- |
| 怎么开始 | 自己打开各家工具，把提示词贴进去 | 准备自己的 OpenAI 或 Gemini API key，再写脚本或用各家界面 | 至少登录一家引擎。Lovart 需要官方 AK/SK |
| 费用怎么算 | 用你已经在付的订阅额度 | 按张付费 | 先用这些订阅额度。按张付费的 API 线路是本技能的可选功能：你可以把它加成最后兜底，并自己设定每批和每月的预算。只有在没有订阅引擎能接这张图时，它才会出手 |
| 额度用完时 | 你自己换到下一家，把没做完的图接上 | 请求失败，或者再去买额度 | 这家引擎停掉，把当前任务放回队列，别家接着做。如果所有订阅都用完了，并且你配了付费线路，这条线路会一直做到预算用完 |
| 能不能并行 | 取决于你怎么在各家工具里操作，通常是一家一家来 | 取决于接口本身，以及你在外面怎么写 | 每家引擎同时开几条通道，空出来的通道接下一条任务。通道数量按内存来：4GB 的电脑 12 条，16GB 及以上 34 条 |

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
