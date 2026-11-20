# 系列图模式

[English](series-mode.md) | [简体中文](series-mode.zh-CN.md)

系列图模式默认关闭，绝不自动开启。这是按 X 上的用户反馈加的：几家引擎一起画，风格要一致。当你提到同一角色、同一品牌、同一吉祥物、一套封面或一个系列，或者每项任务共用同一张风格参考图时，助手会先问一句：「这批要统一风格吗？要的话我打开系列图模式」。只有你同意后才开启，用你自己的描述写 `series.style`，把共用参考图放进 `series.ref`。信号不明确就不提醒，比如 50 张不同风格的字体图，照常生成。

命令行的提醒条件更窄：没传 `--series`、任务文件没有 `series` 键（纯数组也算没有）、至少 4 项任务，并且每项任务都有完全相同的非空参考图列表，才向 stderr 输出一行中英双语的 `series_hint` JSON 事件，提示「这批任务共用同一组参考图，如果要统一风格，可以加 --series」。路径按任务文件所在目录用 `path.resolve` 解析，列表顺序和重复次数都必须一致；不解析文件系统软链接，空路径字符串不算参考图，也不根据提示词相似度判断。显式写了任何 `series` 值，包括 `false` 或 `null`，都不提醒。

发生提醒时，最终摘要和 `out/batch-results.json` 会记 `series_hint: true`；没提醒就省略这个字段。提醒只提供信息，不会开启系列图模式、询问或等待，也不改变引擎、服务调用及参数、环境或退出码。

同意开启后，写在任务文件里，和任务列表并列：

```json
"series": {"style": "...", "ref": ["style.png"]}
```

```bash
node skills/imagegen-swarm/scripts/batch.mjs --jobs jobs.json --out out/ --series --style "..." --style-ref style.png
```

- 同一段风格说明，加上风格参考图，发给每一家引擎。
- 每张图在本地和参考图比对打分（没有参考图时，和第一张留下的图比）。分偏低的丢掉，退回队列，优先交给目前风格最齐的那家引擎。
- 摘要里，丢掉的次数在 `keep.style_redos`。`delivery_seconds` 是写到摘要为止的墙钟，含这次打分和这些重做。

检查什么（`series.method` 或 `--style-method`；打分从不联网）：

| 方法 | 需要 | 比的是 | 不同对象被留下 | 同一对象被丢掉 |
| --- | --- | --- | ---: | ---: |
| `auto`（默认） | — | 装了 `clip` 就用它，否则用 `structure` | | |
| `structure` | Pillow | 构图、线条、画法：0.4 × SSIM + 0.5 × 梯度方向网格 + 0.1 × 调色板 | 31% | 26% |
| `clip` | numpy、onnxruntime，以及你自己下载的 89 MB CLIP ViT-B/32 模型（MIT 许可），见 [SETUP.md](../skills/imagegen-swarm/SETUP.md#series-consistency-optional-clip-score) | 画的是不是同一个对象（图像向量）；每张约 0.5 秒、约 230 MB 内存 | 11% | 10% |
| `palette-histogram` | Pillow | 只看颜色和亮度（1.3.x 的分数） | 6% | 76% |

比例是在默认阈值 0.72 下，用 4,947 对标注过的真实插画、标志和照片测的（[验证报告](series-consistency-validation.md)，英文）。`structure` 和 `clip` 都校准过，0.72 正好是各自实测的工作点，所以旧的任务文件照常能用。摘要里有实际用的方法，以及每张留下的图的 `style_score`、`style_raw_score` 和 `style_components`。

仍然保证不了的：没有哪种方法能确认是同一张脸、同一个角色或同一个标志。`structure` 分不出同一画风下的两个角色，`clip` 大约十次仍错一次。真实的多引擎系列，保留率没有测过。交付前逐张看。全部参数见 [SKILL.md](../skills/imagegen-swarm/SKILL.md#series-mode)。

`keep` 怎么数，包括 `style_redos`，见[保留率](keep-rate.zh-CN.md)。
