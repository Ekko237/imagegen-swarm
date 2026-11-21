# 安装

[English](install.md) | [简体中文](install.zh-CN.md)

[中文说明](../README.zh-CN.md)里只有一条钉死版本的安装命令。本页是这条命令、插件和文件夹安装，以及这个版本号是什么意思。

```bash
npx skills add Ekko237/imagegen-swarm@v1.4.2 -a claude-code -a codex
```

这条命令用 npx skills CLI 安装技能，适用于 Claude Code、Codex 和其他 agent。想用插件方式装，就改用下面两段之一。

这里的安装命令都固定在 v1.4.2 版本，装下来的就是这个标签里的代码，装之前可以先到 https://github.com/Ekko237/imagegen-swarm/tree/v1.4.2 看一遍。以后想升级，先到 https://github.com/Ekko237/imagegen-swarm/releases 看新版本的发布说明，再把命令里的 v1.4.2 换成新的标签。

## Claude Code 插件

在 Claude Code 里输入下面两行，从本仓库的插件市场安装：

```text
/plugin marketplace add Ekko237/imagegen-swarm#v1.4.2
/plugin install imagegen-swarm@imagegen-swarm
```

## Codex 插件

在终端里运行下面两行，从同一个仓库安装 Codex 插件：

```bash
codex plugin marketplace add Ekko237/imagegen-swarm --ref v1.4.2
codex plugin add imagegen-swarm@imagegen-swarm
```

以上任一种方式安装的都是技能本身。你仍需要 Node.js 18+，以及装了 Pillow 的 Python 3（`python3 -m pip install pillow`）。macOS、Windows、Linux 都能用。生成前至少登录一个引擎。Lovart 需要官方 AK/SK。

验证：让你的 agent 画一片蓝底上的柠檬切片。你应该得到一张新的 PNG，这次运行会记下是哪家出的。

## 文件夹安装、npx 和 Windows

### 文件夹

把 `skills/imagegen-swarm` 复制或软链接到 agent 的技能目录。文件夹必须命名为 `imagegen-swarm`。

```bash
git clone --branch v1.4.2 --depth 1 https://github.com/Ekko237/imagegen-swarm.git
mkdir -p ~/.claude/skills ~/.codex/skills
ln -s "$PWD/imagegen-swarm/skills/imagegen-swarm" ~/.claude/skills/imagegen-swarm
ln -s "$PWD/imagegen-swarm/skills/imagegen-swarm" ~/.codex/skills/imagegen-swarm
```

不想用软链接，就把 `ln -s` 换成 `cp -a`。软链接安装要更新，就删掉原来的克隆，按同样的方法克隆新的标签。复制安装要再复制一次。以前装在 `image-gen` 下的，改名为 `imagegen-swarm`。

### npx skills

```bash
npx skills add Ekko237/imagegen-swarm@v1.4.2 -a claude-code -a codex
```

### Windows

把 `skills/imagegen-swarm` 复制到 `%USERPROFILE%\.claude\skills\imagegen-swarm` 或 `%USERPROFILE%\.codex\skills\imagegen-swarm`。Windows 上脚本调用 `python`，也可以设置 `PYTHON`。Pillow 用 `python -m pip install pillow` 安装。Windows 上的即梦程序是 `dreamina.exe`，固定校验和写在 [SETUP.md](../skills/imagegen-swarm/SETUP.md)（英文）。

在技能文件夹里查看哪几家已经能用：

```bash
node scripts/check.mjs
```

如果是本仓库的克隆，同一条检查是 `node skills/imagegen-swarm/scripts/check.mjs`。
