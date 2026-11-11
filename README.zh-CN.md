# imagegen-swarm

[![MIT license](https://img.shields.io/github/license/Ekko237/imagegen-swarm)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/Ekko237/imagegen-swarm)](https://github.com/Ekko237/imagegen-swarm/releases/latest)
[![Changelog](https://img.shields.io/badge/changelog-CHANGELOG.md-blue)](CHANGELOG.md)

[English](README.md)

**大多数引擎不需要图片 API 密钥。**

用你现有的 Codex 和即梦账号，就能在 Claude Code 里出图。

即梦也能生成视频。
Grok、Gemini、Muse 用各自的账号登录。
Lovart 用官方 AK/SK，凭据保存在本机。

这是一个 Claude Code 和 Codex 技能。
它把一批图同时交给这六家。
哪家空着，就接下一张。
一批图几分钟出完。
某家额度用完，别家接过它的活。

![50 张图 2.3 分钟出完，比单个引擎快 11 倍，8GB 内存的 M1 MacBook Pro 上实测](docs/efficiency.png)

## 活是怎么分的

每家引擎同时开几条通道，每条通道做完一张就接队列里的下一张；某家额度用完，别家接着做。下图就是上面那张结果卡对应的那一批 50 张的真实记录：中途 Gemini、Lovart 额度用完，50 张照样全部交付。

这只是我们的一次测试，你跑出来的数字会不一样：速度取决于你在各家有多少额度。这次 Lovart、Muse 用的是免费额度，Gemini 和 Lovart 还中途用完了；额度更多的话，每家都能一直干到最后，一批图通常会比这次更快。

![50 张那一批的时间线：每个格子是一张图，每一行是一条同时在干活的通道](docs/timeline.png)

## 为什么做这个

每家出图工具都有自己按周、按月刷新的额度，大多用不完就作废了。只用一家又慢，额度一到就停。imagegen-swarm 把它们放进同一个队列：

- **并行**：每家同时开几条通道，空出来的通道马上接下一张它做得了的图。
- **看额度**：某家报额度用完、没登录或没安装，就关掉它，手上的图退回队列给别家。普通的限流会先退避，连续三次才关掉。
- **保证对**：每张图都核对是这一次新生成的；比例不对的换别家重做；输出一律是真正的 PNG。
- **看电脑配置**：通道数按内存自动定，4GB 的笔记本开 12 条，16GB 以上开 34 条，不会把电脑卡死。想给别的程序留内存，就加 `IMAGE_GEN_MEMORY_GB=4`，或者用 `--lanes gemini=2,codex=2` 直接指定每家几条。
- **能续跑**：同一份清单再跑一次，已经出好的图会跳过。

## 引擎

| 引擎 | 能做什么 | 通过什么出图 |
|---|---|---|
| **codex** | 出图、参考图 | Codex 命令行内置的 `image_gen`（用你的 Codex / ChatGPT 登录） |
| **jimeng（即梦）** | 出图、改图（最多 10 张参考图）、文生视频、图生视频 | 即梦官方命令行（用你的抖音登录） |
| **grok** | 出图、改图、参考图生成视频 | Grok Build 命令行的 Imagine 工具 |
| **gemini** | 出图、改图（最多 3 张参考图） | Antigravity 命令行的 `generate_image` |
| **muse** | 出图、参考图 | 用无头浏览器操作 Muse（muse.ai） |
| **lovart** | 出图、参考图 | Lovart 官方命令行（你自己的 AK/SK） |

有一家就能用，接上的越多，一批图出得越快。

## 安装

Claude Code：

```bash
claude plugin install imagegen-swarm --marketplace Ekko237/imagegen-swarm
```

Codex：

```bash
codex plugin marketplace add Ekko237/imagegen-swarm
codex plugin add imagegen-swarm@imagegen-swarm
```

这两段命令安装的是技能本身。你仍需要 Node.js 18+，以及装了 Pillow 的 Python 3（`python3 -m pip install pillow`）。macOS、Windows、Linux 都能用。生成前至少登录一个引擎。Lovart 需要官方 AK/SK。

验证：让你的 agent 画一片蓝底上的柠檬切片。你应该得到一张新的 PNG，这次运行会记下是哪家出的。

<details>
<summary>文件夹安装、npx 和 Windows</summary>

### 文件夹

把 `skills/imagegen-swarm` 复制或软链接到 agent 的技能目录。文件夹必须命名为 `imagegen-swarm`。

```bash
git clone https://github.com/Ekko237/imagegen-swarm.git
mkdir -p ~/.claude/skills ~/.codex/skills
ln -s "$PWD/imagegen-swarm/skills/imagegen-swarm" ~/.claude/skills/imagegen-swarm
ln -s "$PWD/imagegen-swarm/skills/imagegen-swarm" ~/.codex/skills/imagegen-swarm
```

不想用软链接，就把 `ln -s` 换成 `cp -a`。软链接安装后，在克隆出来的仓库里 `git pull` 即更新。复制安装要再复制一次。以前装在 `image-gen` 下的，改名为 `imagegen-swarm`。

### npx skills

```bash
npx skills add https://github.com/Ekko237/imagegen-swarm -a claude-code -a codex
```

### Windows

把 `skills/imagegen-swarm` 复制到 `%USERPROFILE%\.claude\skills\imagegen-swarm` 或 `%USERPROFILE%\.codex\skills\imagegen-swarm`。Windows 上脚本调用 `python`，也可以设置 `PYTHON`。Pillow 用 `python -m pip install pillow` 安装。即梦的安装需要 Git Bash。各家登录见 [SETUP.md](skills/imagegen-swarm/SETUP.md)（英文）。

在技能文件夹里查看哪几家已经能用：

```bash
node scripts/check.mjs
```

如果是本仓库的克隆，同一条检查是 `node skills/imagegen-swarm/scripts/check.mjs`。

</details>

## 用法

直接跟你的 agent 说要什么图，技能会自动启用。也可以自己跑一批：

```bash
cat > jobs.json <<'EOF'
[
  {"id": "lemon",  "prompt": "a lemon slice on a blue background, flat illustration", "aspect": "1:1"},
  {"id": "kite",   "prompt": "a red kite in a clear sky, minimal",                    "aspect": "3:4"},
  {"id": "whale",  "prompt": "a blue whale in the deep ocean, low poly",              "aspect": "16:9"},
  {"id": "night",  "prompt": "the same lemon slice, but at night", "ref": ["out/lemon.png"]}
]
EOF
node skills/imagegen-swarm/scripts/batch.mjs --jobs jobs.json --out out/
```

每项必填 `id` 和 `prompt`，`aspect`、`ref`、`video`、`engine` 可选。图存在 `out/<id>.png`，进度按行输出 JSON，`out/batch-results.json` 记着每张是哪家出的。单个引擎的脚本也能单独用，比如 `node skills/imagegen-swarm/scripts/gemini-image.mjs --prompt "..." --out a.png --aspect 1:1`。全部参数见 [SKILL.md](skills/imagegen-swarm/SKILL.md)。在已安装的技能文件夹里，去掉前面的 `skills/imagegen-swarm/`。

## 测试

```bash
node skills/imagegen-swarm/evals/run.mjs out/                         # 全部固定测试，含一批混合抢活
node skills/imagegen-swarm/evals/run.mjs out/ --only gemini-t2i,batch-mixed
```

## 文件

```
├─ skills/imagegen-swarm/   技能本体：SKILL.md、SETUP.md、scripts、references、evals
├─ docs/                    README 配图
├─ AGENTS.md                交给 agent 时的入口
├─ CHANGELOG.md             版本说明
├─ .claude-plugin/          Claude Code 插件清单（skills: ./skills/imagegen-swarm）
├─ .codex-plugin/           Codex 插件清单（skills: ./skills/）
├─ .agents/                 Codex 市场清单
└─ .github/                 CI 和 bug 报告模板
```

## 出图示例

![imagegen-swarm 画的图，每张标着是哪家引擎画的](docs/showcase.webp)

## 常见问题

**要六家都登录吗？**

不用。有一家就能用。接上的越多，一批图出得越快。只装你要用的。`node skills/imagegen-swarm/scripts/check.mjs` 会列出哪几家已经能用。没登录的会被关掉，手上的图退回队列。

**登录安全吗？**

技能本身不含账号和密钥。每家的登录留在它自己的目录里。分享这个技能时，不要把那些目录一起打包。Lovart 的 AK/SK 写在 `~/.lovart/env`，权限是 `600`，不要写进对话，也不要写进 git。各家目录见 [SETUP.md](skills/imagegen-swarm/SETUP.md)。

**额度用完会怎样？**

某家报额度用完、没登录或没安装，技能会关掉它，把它手上的图退回队列。普通的 429 限流会先退避，连续三次才关掉这家。失败的图会换一家还没试过的引擎重做，最多 `--tries` 家（默认 3）。六家都没有额度时，改在 ChatGPT、Gemini 或 Grok 的网页里新开一个标签生成，下载核对后再关掉标签。引擎报错和额度用完不是一回事。你点名的那家失败时，技能会报告这个错误。

**需要 API 密钥吗？**

大多数引擎不需要。Codex 和即梦用你已有的账号。Grok、Gemini、Muse 用各自的账号登录。Lovart 需要官方 AK/SK，存在本机。

**在哪些 agent 里能用？**

Claude Code 和 Codex。

## 许可

MIT，见 [LICENSE](LICENSE)。Codex 的指令模板参考了 `baoyu-image-gen`，上游的 MIT 声明见 [NOTICE](NOTICE)。

用过了？开一个 issue，告诉我哪里坏了，或者你做出了什么。
