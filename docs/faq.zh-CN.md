# 常见问题

[English](faq.md) | [简体中文](faq.zh-CN.md)

**要六家都登录吗？**

不用。有一家就能用。接上的越多，生成越快。只装你要用的。`node skills/imagegen-swarm/scripts/check.mjs` 会列出哪几家已经能用。没登录的会被关掉，手上的图退回队列。

**登录安全吗？**

技能本身不含账号和密钥。每家的登录留在它自己的目录里。分享这个技能时，不要把那些目录一起打包。Lovart 的 AK/SK 写在 `~/.lovart/env`，权限是 `600`，不要写进对话，也不要写进 git。各家目录见 [SETUP.md](../skills/imagegen-swarm/SETUP.md)。

**不同模型画出来，风格会一致吗？**

默认不会。每张图只有自己的 `prompt`、可选的 `ref` 和 `aspect`。哪条通道接得了，就由它画，所以一批图常常分给不同的模型。

同一角色、同一品牌或一套封面，用[系列图模式](series-mode.zh-CN.md)。

即梦最多 10 张参考图，Gemini 最多 3 张，Grok 1 张。Gemini 可能会改写提示词，结果里的 `prompt_verbatim` 就是 `false`。

**额度用完会怎样？**

某家报额度用完、没登录或没安装，技能会关掉它，把它手上的图退回队列。普通的 429 限流会先退避，连续三次才关掉这家。失败的图会换一家还没试过的引擎重做，最多 `--tries` 家（默认 3）。如果你配置了按张付费的 api 线路，它会从这里接手，直到用完你设的预算。六家都没有额度时，改在 ChatGPT、Gemini 或 Grok 的网页里新开一个标签生成，下载核对后再关掉标签。引擎报错和额度用完不是一回事。你点名的那家失败时，技能会报告这个错误。

**需要 API 密钥吗？**

大多数引擎不需要。Codex 和即梦用你已有的账号。Grok、Gemini、Muse 用各自的账号登录。Lovart 需要官方 AK/SK，存在本机。可选的按张付费线路用你自己的 OpenAI 或 Gemini API key，见 [SETUP.md](../skills/imagegen-swarm/SETUP.md)。

**在哪些 agent 里能用？**

Claude Code 和 Codex。
