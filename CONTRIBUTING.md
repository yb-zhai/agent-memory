# Contributing to Nebula Memory (agent-memory)

感谢你愿意参与。这个项目是**零依赖、纯本地**的 Agent 记忆系统，所以对提交有两项硬要求。

## 开始之前

```bash
git clone https://github.com/yb-zhai/agent-memory.git
cd agent-memory
node server.js          # 无需 npm install
```

浏览器打开 `http://127.0.0.1:8898/` 即可调试面板（纯 `local` 模式，不需要 Hindsight）。

动手之前建议先读 [docs/工程经验记录.md](docs/工程经验记录.md)——里面记录了 Git 操作、
PowerShell 编码、性能测量、评测数据落盘等场景下踩过的坑与已验证的正确做法，
能避免重复踩坑。

## 硬性约束

1. **不引入运行时依赖。**`package.json` 的 `dependencies` 必须保持为空。插件要能「解压即用、离线可跑」。
2. **不提交任何密钥或个人路径。**提交前请自查：
   - 不要硬编码盘符绝对路径或用户目录，改用 `MEMORY_NEBULA_*` 环境变量；
   - 不要把 `.env`、真实 API key、个人记忆数据（`*.jsonl`）打进提交；
   - `.gitignore` 已覆盖上述内容，但**不要用 `git add -f` 绕过它**。

## 代码风格

- 现有代码是 ESM（`.mjs`）与 CJS（`.cjs`）混用：`lib/engine.mjs` 走 ESM，`memory/*.cjs` 走 CJS，由 `memory/index.mjs` 桥接。改动请沿用所在文件的模块体系。
- 2 空格缩进，不加分号，单引号字符串。
- 注释写「为什么」，不写「做什么」——代码本身已经说明了做什么。
- 中英文注释都可以，同一个文件内保持一致。

## 测试要求

项目暂无测试框架，提 PR 前请至少完成：

```bash
node server.js
curl http://127.0.0.1:8898/healthz        # 应返回 service: dsh-memory-nebula
curl http://127.0.0.1:8898/state          # 应返回合法 JSON
```

改动涉及 Hindsight 叠加层时，请**同时验证无 Hindsight 的场景**——降级到 `local` 模式必须依然正常工作，这是本项目的核心契约。

## 版本规范与发布

本项目遵循 [Semantic Versioning 2.0.0](https://semver.org/lang/zh-CN/)。

### 版本号怎么升

| 变更性质 | 升哪位 | 例子 |
|---|---|---|
| 不兼容的接口变更（插件接口大改、数据格式不兼容） | **Major** | 1.4.2 → 2.0.0 |
| 向下兼容的新功能（新事件监听、新增面板卡槽） | **Minor** | 1.3.14 → 1.4.0 |
| 向下兼容的缺陷修复（修内存泄漏、修 UI 闪烁） | **Patch** | 1.3.14 → 1.3.15 |

**以下情况不要升版本号**，直接提交即可：

- 修改 README、注释、文档
- 内部重构（不影响任何外部行为）
- 修改 CI/CD 配置

### 版本号只有一个权威来源

**`package.json` 的 `version` 是唯一真源。** `server.js` 在启动时读取它得到 `VERSION`，
不再写死常量。

这一点很重要：历史上 `server.js` 里有一个写死的 `VERSION` 常量，1.3.9 和 1.3.10
两次发版忘了同步，导致健康检查判定失败、所有升级被静默回滚，缺陷也因此被掩盖了一天多
（详见 [docs/工程经验记录.md](docs/工程经验记录.md) 第 14 条）。改成单一真源后这个问题从根上不存在了。

`install.ps1` 在安装前会校验：`version` 是合法 SemVer，且 `server.js` 确实从
`package.json` 读取版本。若你在 `server.js` 里重新写死常量，安装会被拒绝。

### 提交信息规范（Conventional Commits）

发版工具依据提交前缀自动判定版本号并生成 CHANGELOG，**请严格使用**：

```
feat: 新增功能        -> 触发 Minor
fix:  修复缺陷        -> 触发 Patch
feat!: 不兼容变更     -> 触发 Major（或正文写 BREAKING CHANGE:）
docs/chore/test/build/ci:  不计入版本判定
```

可选作用域：`feat(panel):`、`fix(memory):`、`feat(install):`。

### 发版流程

```bash
npm run release -- --dry-run    # 先看会升到哪个版本、CHANGELOG 长什么样
npm run release:patch           # 修 bug 发版
npm run release:minor           # 新功能发版
npm run release:major           # 不兼容变更发版
```

工具（release-it）会自动：升版本号 → 生成 CHANGELOG → 提交 → 打 tag → 推送。

### 预发布版本

测试性的重大改动走预发布，稳定运行几天后再转正式版：

```bash
npm run release:pre             # 1.4.0-beta.1
npm run release:rc              # 1.4.0-rc.1
```

预发布版本在 `install.ps1` 里被视为合法 SemVer，可以正常安装。

### 每次发版必须带 CHANGELOG

`CHANGELOG.md` 由工具自动生成，包含三类信息：

- **Added** — 加了什么
- **Fixed** — 修了什么
- **Breaking Changes** — 有什么不兼容、插件开发者需要注意什么

## 升级检查清单

发版前请至少验证：

- 启动正常：`node server.js` 后 `curl http://127.0.0.1:8898/healthz` 返回 `service: dsh-memory-nebula`
- 版本一致：`/healthz` 返回的 `version` 等于 `package.json` 的 `version`
- 旧版数据可读：用旧版写入的记忆，新版升级后仍能召回
- `nodes.jsonl` / `edges.jsonl` 未被安装器替换
- 故障注入：让健康检查失败，确认旧代码、配置、profile 清单与记忆数据均恢复
- 记忆目录为普通文件、目录联接或符号链接时，必须在写入前拒绝
- 数据格式变更必须有明确的 `schemaVersion` 与迁移说明；禁止无备份原地改写
- `-DryRun` 不得停止进程、创建备份或修改任何文件


## 提交 PR

1. 从 `main` 切出描述性分支：`git checkout -b fix/worker-recover`；
2. 提交信息用 `feat: ` / `fix: ` / `docs: ` / `refactor: ` / `chore: ` 前缀；
3. 一个 PR 只做一件事，描述里写清「改了什么、为什么、怎么验证的」；
4. 修复 Issue 时在描述里写 `fixes #123`；
5. 维护者可能要求修改，请在同一分支继续提交，PR 会自动更新。

## 报告问题

请在 Issue 中附上：

- 操作系统与 Node.js 版本；
- 当前模式（`local` / `hybrid`）与 Hindsight 是否可用；
- 相关日志（`%DSH_HOME%/memory-nebula.log`），**提交前请先脱敏**；
- 复现步骤。

安全问题请勿开公开 Issue，见 [SECURITY.md](SECURITY.md)。
