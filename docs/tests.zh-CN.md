# 测试

[English](tests.md) | [简体中文](tests.zh-CN.md)

在仓库根目录：

```bash
node tests/evals/run.mjs out/                         # 全部固定测试，含一批混合抢活
node tests/evals/run.mjs out/ --only gemini-t2i,batch-mixed
node tests/reliability.test.mjs               # 日志解析、限流、抢尾单阈值、Lovart 包装
node tests/series.test.mjs                    # 系列模式、假引擎、调色板分数
node tests/series-consistency.test.mjs        # 结构分、CLIP 回退，真实图片和程序生成的图
python3 tests/reliability_rename_test.py      # Muse 重命名和 fail-closed 审批检查
```

`tests/evals/run.mjs` 那两行是实机评测：需要已配置的引擎，可能消耗额度或按次付费的预算，不在 CI 里。reliability 和 series 测试用的是夹具，不连引擎。完整检查见 [CONTRIBUTING.md](../CONTRIBUTING.md)。
