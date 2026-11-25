# AGENTS.md — 给 AI 协作者的项目须知

> 本文件面向「新开一个会话、对本仓库一无所知」的 AI 助手。
> 目的是让你在**动手之前**就知道这个项目有哪些不可协商的约定，而不是等你踩坑之后再回来补。

## 这个项目是什么

`dsh-nebula-memory` —— 一个**零运行时依赖、纯本地**的 DSH Agent 记忆插件：
本地四臂召回引擎（词法 / 激活 / 图扩散 / 画像，JSONL 存储）+ 可视化面板 + 可选 Hindsight 双引擎。

- 主入口：`server.js`（面板服务，端口 `8898`）、`panel.html`（前端）、`lib/engine.mjs`（引擎）
- 规则文档：`CONTRIBUTING.md`（硬性约束、代码风格、提交规范、发布流程）
- **`package.json` 的 `dependencies` 必须永远为空** —— 这是硬性要求，不是风格偏好

## ⚠️ 提交前必须知道的三道自动拦截

这个仓库对**文件编码**有强制检查。`*.ps1` 丢失 UTF-8 BOM 会导致 PowerShell 5.1 按 GBK
解析中文注释、报出与注释无关的语法错误，而 `PSParser` 却显示 0 错误 —— **语法检查发现不了**。

因此设了三道拦截，改动后请确认都能过：

| 时机 | 机制 | 怎么跑 |
|---|---|---|
| 本地提交前 | `.githooks/pre-commit` | 一次性启用：`git config core.hooksPath .githooks` |
| CI | `.github/workflows/encoding-check.yml` | 自动；且会故意破坏 `install.ps1` 验证检查器没坏 |
| 发版前 | `.release-it.json` 的 `before:init` | 自动 |

**本地自查命令**（改完任何文件都可以跑）：

```bash
npm run check:encoding          # 只查 BOM
npm run check:encoding:all      # BOM + 仓库内行尾（严格）
```

### 编码约定（判断标准是文件首字节，不是语法检查）

| 文件类型 | BOM | 行尾（仓库内） |
|---|---|---|
| `*.ps1`（`install.ps1` / `uninstall.ps1`） | **必须有** UTF-8 BOM | LF |
| `*.mjs` / `*.cjs` / `*.js` / `*.html` / `*.cmd` / `*.json` | 无 | LF |
| `*.md` | 无 | 不强制 |

> **编辑器会去掉 BOM。** 改完 `*.ps1` 一定要重跑 `npm run check:encoding`。
> 本仓库设了 `core.autocrlf=true`，所以**工作区是 CRLF、仓库里是 LF**，两者都正常。
> 不要手动把工作区改成 LF —— 那会让 `git diff` 变成整文件重写。判断依据是
> `git diff --numstat` 的行数，不是文件的实际行尾。

## 提交与发布

- 提交信息遵循 **Conventional Commits**，前缀决定 CHANGELOG 归类与版本号。
- **SemVer 纪律**：README / 注释 / CI 配置 / 内部重构**不升版本**；加开关和配置项属于 Patch（用 `fix:`）。
- 发布用 `release-it`：`npm run release:minor` 等。它会自动跑语法检查、提交前缀检查、编码检查。
- 推送前请逐项过一遍 `CONTRIBUTING.md` 的「推送前先自检」。**发现问题先停下修好，不要先推。**

## 验证习惯（这条很重要）

在这个仓库里，「语法检查通过」和「改对了」是两件不同的事。已经踩过的坑：

1. 面板改动用了未定义变量，`node --check` 能过，浏览器一打开就 `ReferenceError`；
2. `install.ps1` 丢 BOM，`PSParser` 报 0 错误，但 `-DryRun` 直接语法崩溃；
3. 编码脚本第一版写成查 `git show HEAD:`，注入故障时**完全没抓到** —— 因为仓库里还有 BOM。

所以：

- 改了面板，**一定要在浏览器里实际打开看**；
- 改了 `install.ps1`，跑一次 `-DryRun` 确认能执行；
- 写了检查脚本，**先注入一个故障确认它能抓到**，再相信它报的「通过」。

## 改动范围

- 只改用户要求的部分，不顺手重构无关代码。
- 文档类改动（README / CONTRIBUTING）如果改动较大，先把内容给用户看再提交。
- 涉及 Windows 路径、编码、行尾的改动要格外小心，`CONTRIBUTING.md` 里都有记录。

## 更详细的信息在哪

| 想了解 | 看这里 |
|---|---|
| 硬性约束、代码风格、自检清单、发布流程 | `CONTRIBUTING.md` |
| 使用方式、架构、双引擎、FAQ | `README.md` |
| 历史踩坑与正确做法 | `docs/工程经验记录.md` |
| 具体某个版本的改动 | `CHANGELOG.md` |
