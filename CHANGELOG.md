# Changelog

本项目遵循 [Semantic Versioning 2.0.0](https://semver.org/lang/zh-CN/)。
版本变更由 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 自动推导，按以下三类呈现对使用者有影响的变更：

- **Added** — 向下兼容的新功能（升 Minor）
- **Fixed** — 向下兼容的缺陷修复（升 Patch）
- **Changed / Breaking Changes** — 行为变化或不兼容的接口变更（升 Major）

Docs / Chore / Test / Build / CI 类提交也会列出，便于追溯改动来源。


## [1.4.0](https://github.com/yb-zhai/agent-memory/compare/v1.3.13...v1.4.0) (2026-11-24)

### Added

* **release:** 引入 SemVer 2.0.0 规范与自动化发版工具链 ([c9e7c93](https://github.com/yb-zhai/agent-memory/commit/c9e7c9342c8c1b83450ca28f3c51775f7bb1d279))

# Changelog

本项目遵循 [Semantic Versioning 2.0.0](https://semver.org/lang/zh-CN/)。
版本变更由 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 自动推导：

- **Added** — 向下兼容的新功能（升 Minor）
- **Fixed** — 向下兼容的缺陷修复（升 Patch）
- **Breaking Changes** — 不兼容的接口变更（升 Major）

> 从 1.3.14 起，以下条目由 `npm run release` 自动生成，不再手工维护。
> 1.3.13 及更早版本为回溯整理。

## [1.3.13] - 2026-11-24

### Added

- **install:** 安装器自更新 —— 在动任何文件之前检查脚本自身是否落后于仓库，`-SelfUpdate` 可自动拉取并用新版重新执行；工作区脏、分叉、非 git 目录或连不上远程时一律跳过，绝不覆盖用户改动。

### Fixed

- 旧版用户无法用上新校验的问题：`install.ps1` 此前不会自更新，停在旧版的用户无论下载多新的包都跑旧安装器。

> **注意**：自更新逻辑需要脚本本身更新过一次才生效。1.3.12 及更早的用户请先手动 `git pull` 一次。

## [1.3.12] - 2026-11-24

### Added

- **install:** 升级前校验包内版本号自洽，版本不一致时在**修改任何文件之前**中止安装，并给出可操作的处理办法。

### Fixed

- **memory:** 启动时清理残留的原子写临时文件（`index.json.tmp-<pid>-<hex>`）。只删属于本进程或所属进程已退出的，多实例并存时保留其他进程正在写的文件。
- 引擎层告警此前被静默丢弃：`lib/engine.mjs` 构造本地引擎时未注入日志函数，导致 `_log()` 全部空操作。现已接上。

## [1.3.11] - 2026-11-24

### Fixed

- **memory:** 画像摘要重复写入 —— `refreshSummary` 在内容未变时仍无条件 `_rewriteNode`，而服务每 1.5 秒 tick 一次，**运行一天可累积数万行**。现改为内容未变即跳过，并给摘要刷新加 5 分钟节流。该缺陷自首版起即存在。

## [1.3.10] - 2026-11-23

### Added

- **memory:** 查询扩展三路补偿 + 召回效果实测报告与评测工具链。
- **memory:** 错别字词表修正，支持 `user-dict.json` 外置词表。

### Fixed

- **server:** 端口冲突时不再递增换端口，杜绝多实例并存。
- 长文本分块 + 超级节点度数上限。

## [1.3.9] - 2026-11-23

### Fixed

- 长文本分块 + 超级节点度数上限。

## [1.3.8] - 2026-11-21

首个公开版本：零依赖本地 JSONL 记忆引擎（四臂召回）+ 可视化面板 + 可选 Hindsight 语义增强。
