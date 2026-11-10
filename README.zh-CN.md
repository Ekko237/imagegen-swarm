# imagegen-swarm

**把你已经付了钱的几家 AI 出图额度同时用起来。** 这是一个 Claude Code / Codex 技能：一批图同时交给 Codex、Grok、Gemini、Muse、Lovart，哪家空着就接下一张，一批图几分钟出完；某家额度用完，它的活自动转给别家。不需要任何出图 API 密钥。

[English](README.md)

![一批 10 张图，三家引擎同时出](docs/showcase.jpg)

![这一批的时间线：每家引擎的几条通道同时在干活](docs/timeline.png)

## 为什么做这个

每家出图工具都有自己按周、按月刷新的额度，大多用不完就作废了。只用一家又慢，额度一到就停。imagegen-swarm 把它们放进同一个队列：

- **并行**：每家同时开几条通道，空出来的通道马上接下一张它做得了的图。
- **看额度**：某家报额度用完或没登录，就关掉它，手上的图退回队列给别家。
- **保证对**：每张图都核对是这一次新生成的；比例不对的换别家重做；输出一律是真正的 PNG。
- **能续跑**：同一份清单再跑一次，已经出好的图会跳过。

## 引擎

| 引擎 | 能做什么 | 通过什么出图 |
|---|---|---|
| **codex** | 出图、参考图 | Codex 命令行内置的 `image_gen`（用你的 Codex / ChatGPT 登录） |
| **grok** | 出图、改图、参考图生成视频 | Grok Build 命令行的 Imagine 工具 |
| **gemini** | 出图、改图（最多 3 张参考图） | Antigravity 命令行的 `generate_image` |
| **muse** | 出图、参考图 | 用无头浏览器操作 Muse（muse.ai） |
| **lovart** | 出图、参考图 | Lovart 官方命令行（你自己的 AK/SK） |

有一家就能用，接上的越多，一批图出得越快。

## 安装

```bash
git clone https://github.com/Ekko237/imagegen-swarm.git ~/.claude/skills/image-gen   # Claude Code
git clone https://github.com/Ekko237/imagegen-swarm.git ~/.codex/skills/image-gen    # Codex
python3 -m pip install pillow
node ~/.claude/skills/image-gen/scripts/check.mjs                                    # 看哪几家已经能用
```

需要 Node.js 18+ 和装了 Pillow 的 Python 3，macOS、Windows、Linux 都能用。各家怎么登录见 [SETUP.md](SETUP.md)（英文）。

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

## 许可

MIT，见 [LICENSE](LICENSE)。Codex 的指令模板参考了 `baoyu-image-gen`，上游的 MIT 声明见 [NOTICE](NOTICE)。
