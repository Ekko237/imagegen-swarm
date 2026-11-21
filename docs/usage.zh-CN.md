# 用法

[English](usage.md) | [简体中文](usage.zh-CN.md)

直接跟你的 agent 说要什么图，技能会自动启用。也可以自己跑一批。在仓库根目录：

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

每项必填 `id` 和 `prompt`，`aspect`、`ref`、`video`、`engine` 可选。图存在 `out/<id>.png`，进度按行输出 JSON，`out/batch-results.json` 记着每张是哪家出的、花了多久，以及[保留率](keep-rate.zh-CN.md)里的 `keep` 计数。单个引擎的脚本也能单独用，比如 `node skills/imagegen-swarm/scripts/gemini-image.mjs --prompt "..." --out a.png --aspect 1:1`。全部参数见 [SKILL.md](../skills/imagegen-swarm/SKILL.md)。在已安装的技能文件夹里，去掉前面的 `skills/imagegen-swarm/`。

`id` 必须是 1–100 个字符的字符串，以 Unicode 字母或数字开头，其余字符只能是字母、数字、`.`、`_` 或 `-`。例如 `cover-1`、`中文图1`。

只跑一张柠檬切片的检查在[中文说明](../README.zh-CN.md#快速使用)。
