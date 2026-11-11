# imagegen-swarm

**用现有的 Codex 和即梦账号，就能在 Claude Code 里出图，这两家无需 API 密钥。即梦也支持生成视频；Grok、Gemini、Muse 使用各自的账号登录，Lovart 使用官方 AK/SK，凭据保存在本机。** 这是一个 Claude Code / Codex 技能：一批图同时交给这六家，哪家空着就接下一张，一批图几分钟出完；某家额度用完，它的活自动转给别家。

[English](README.md)

![50 张图 2.3 分钟出完，比单个引擎快 11 倍，8GB 内存的 M1 MacBook Pro 上实测](docs/efficiency.png)

## 活是怎么分的

每家引擎同时开几条通道，每条通道做完一张就接队列里的下一张；某家额度用完，别家接着做。下图就是上面那张结果卡对应的那一批 50 张的真实记录：中途 Gemini、Lovart 额度用完，50 张照样全部交付。

这只是我们的一次测试，你跑出来的数字会不一样：速度取决于你在各家有多少额度。这次 Lovart、Muse 用的是免费额度，Gemini 和 Lovart 还中途用完了；额度更多的话，每家都能一直干到最后，一批图通常会比这次更快。

![50 张那一批的时间线：每个格子是一张图，每一行是一条同时在干活的通道](docs/timeline.png)

## 为什么做这个

每家出图工具都有自己按周、按月刷新的额度，大多用不完就作废了。只用一家又慢，额度一到就停。imagegen-swarm 把它们放进同一个队列：

- **并行**：每家同时开几条通道，空出来的通道马上接下一张它做得了的图。
- **看额度**：某家报额度用完或没登录，就关掉它，手上的图退回队列给别家。
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

生成前至少登录一个引擎；Lovart 需要官方 AK/SK。安装文件夹命名为 `imagegen-swarm`，与 `SKILL.md` 中的技能名一致。Windows 安装和引擎登录步骤见 [SETUP.md](SETUP.md)。

```bash
git clone https://github.com/Ekko237/imagegen-swarm.git ~/.claude/skills/imagegen-swarm   # Claude Code
git clone https://github.com/Ekko237/imagegen-swarm.git ~/.codex/skills/imagegen-swarm    # Codex
python3 -m pip install pillow
node ~/.claude/skills/imagegen-swarm/scripts/check.mjs                                    # 看哪几家已经能用
```

需要 Node.js 18+ 和装了 Pillow 的 Python 3，macOS、Windows、Linux 都能用。各家怎么登录见 [SETUP.md](SETUP.md)（英文）。

以前装在 `image-gen` 下的，把 `~/.claude/skills/image-gen` 或 `~/.codex/skills/image-gen` 改名为 `imagegen-swarm` 即可。旧文件夹名会和其他技能撞名。

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
node scripts/batch.mjs --jobs jobs.json --out out/
```

每项必填 `id` 和 `prompt`，`aspect`、`ref`、`video`、`engine` 可选。图存在 `out/<id>.png`，进度按行输出 JSON，`out/batch-results.json` 记着每张是哪家出的。单个引擎的脚本也能单独用，比如 `node scripts/gemini-image.mjs --prompt "..." --out a.png --aspect 1:1`。全部参数见 [SKILL.md](SKILL.md)。

## 测试

```bash
node evals/run.mjs out/                         # 全部固定测试，含一批混合抢活
node evals/run.mjs out/ --only gemini-t2i,batch-mixed
```

## 出图示例

![imagegen-swarm 画的图，每张标着是哪家引擎画的](docs/showcase.webp)

## 许可

MIT，见 [LICENSE](LICENSE)。Codex 的指令模板参考了 `baoyu-image-gen`，上游的 MIT 声明见 [NOTICE](NOTICE)。

