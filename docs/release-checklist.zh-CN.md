# 发版清单

[English](release-checklist.md) | [简体中文](release-checklist.zh-CN.md)

1. 对齐 `.claude-plugin/plugin.json`、`.codex-plugin/plugin.json`、
   `.claude-plugin/marketplace.json` 和 `skills/imagegen-swarm/SKILL.md` 的版本号。
   在 CHANGELOG 中补上日期和变更。
2. 跑 `npm test`、`node .github/check-frontmatter.mjs`、JavaScript 语法检查和
   `python3 -m py_compile skills/imagegen-swarm/scripts/*.py`。
3. 在 Ekko 已登录的机器上跑 `npm run smoke -- --require <本次改动的引擎列表>`。
   1.4.2 至少要求 `muse,lovart,gemini`，Grok 登录后也加上。先确认 Muse 出图是否包含在订阅里。
   未完成的实测写明待验证。已登录的引擎应 PASS，或因计费、账号不支持、停用而 SKIP。
   必测引擎 SKIP 会退出 1。出现 FAIL 就不打 tag。
4. 把 smoke 表贴到发版 PR，勾选模板里的 smoke 项。写清每个 SKIP 的原因，别贴凭证。
5. 审核通过后打 tag、发 release，再更新 README 的安装版本。

## Smoke 用法

```bash
npm run smoke -- [--engines codex,grok,gemini,jimeng,muse,lovart,api] [--require muse,lovart,gemini] [--out <dir>] [--keep] [--timeout <seconds>] [--json]
```

已安装的技能可用 `node scripts/smoke.mjs`。默认依次测试 Codex、Grok、Gemini、即梦、
Muse、Lovart 和 API。各引擎先做只读检查，再用同一条红圆提示词生成一张方图，不带参考图。
每个引擎默认限时 300 秒，包含预检和图片校验，可用 `--timeout <秒>` 调整。开始和结束
时逐项输出进度。超时、SIGINT 或 SIGTERM 后仍会保存 `SMOKE_TABLE.txt`。

- PASS 要求退出码 0、JSON 报成功、PNG 可解码、宽高都至少 256，且像素指纹与本次之前的结果不同。
- 未登录、停用、账号不支持或未允许扣费时记 SKIP。Codex 的 `image_gen_unavailable` 和 Gemini 额度耗尽也记 SKIP。
  通过预检后出图失败、超时或图片无效都记 FAIL。
- 默认不跑扣分的即梦或付费 API。Lovart 仅在 unlimited 且默认模型在白名单中时出图。
  `--allow-credits` 允许 Lovart 和即梦扣积分，`--allow-paid` 允许 API 在预算内出图。
  脚本从不切 Lovart 计费模式。先确认 Muse 出图是否包含在订阅里，再选 Muse。
- 有 FAIL 或必测引擎 SKIP 就退出 1。`--json` 按行输出。
  `~/.config/imagegen-swarm/smoke-last.json` 保存各引擎最近一次的时间、结果、安全摘要、耗时和版本。
  失败摘要留在 `--out` 或系统临时目录的本轮文件夹。默认删图，`--keep` 才保留。
  Muse 沿用侧聊天清理流程，Lovart 每次开新 thread。

## Ekko 盒子

- 每天约 09:45 CT 有 Lovart 任务，09:30–10:30 CT 不跑 Lovart smoke。
- 保持 `/home/box/dripfont/` 的文件和计数器原样。
- 盒子上的 Lovart 账号曾查到是 fast。由 Ekko 决定是否手动切换，或明确允许某次测试扣分。
