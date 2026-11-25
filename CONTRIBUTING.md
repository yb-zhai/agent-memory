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
curl http://127.0.0.1:8898/healthz        # 应返回 service: dsh-nebula-memory
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
| **给已有功能加开关 / 配置项** | **Patch** | 1.4.0 → 1.4.1 |

**最后一行是例外，需要特别注意**：给已有功能加开关、加配置项，本质是让用户多一个控制手段，
没有引入新的能力边界，因此**按 Patch 处理，提交用 `fix:` 前缀而不是 `feat:`**。
若写成 `feat:`，发版工具会判定为 Minor，与实际发布意图不符（1.4.1 就遇到过这种情况）。

对照判断：**「原来做不到的事现在能做了」是 Minor；「原来能做的事现在可以换个方式控制」是 Patch。**

**以下情况不要升版本号**，直接提交即可：

- 修改 README、注释、文档
- 内部重构（不影响任何外部行为）
- 修改 CI/CD 配置
- **仓库内部工具类改动**（见下）

**「仓库内部工具类改动」明确指**：只服务于本仓库开发与发布流程、**插件使用者完全感知不到**的东西。
这类改动一律用 `chore:` 前缀，**不升 Minor**：

| 属于（用 `chore:`） | 不属于（该升 Minor/Patch） |
|---|---|
| `scripts/` 下的发版检查、基准测试、数据生成脚本 | 面向用户的基准报告、评测结论 |
| `release-it` 配置、钩子、CHANGELOG 生成规则 | 运行时新增的可配置项 |
| `.github/` 工作流、提交规范文件 | 插件暴露给 DSH 的新接口 |
| 本地开发辅助（模拟克隆、反证脚本） | 用户能直接触发的行为变化 |

判断标准只有一句：**使用者装完新版，能不能察觉到任何不同？**
察觉不到 → `chore:`，不升版；察觉得到 → 按上表升 Minor 或 Patch。

> 例：`7e3cd67 feat(release): 发版前检查提交前缀` 用了 `feat:`，下一个版本因此会升到 1.4.2。
> 但它只是发版流程的检查工具，使用者无感 —— 按本规则应为 `chore(release):`，不升版。

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
fix:  给已有功能加开关 / 配置项 -> 触发 Patch（例外，见「版本号怎么升」）
chore: 仓库内部工具（scripts / release-it / CI） -> 不升版（例外，见「版本号怎么升」）
feat!: 不兼容变更     -> 触发 Major（或正文写 BREAKING CHANGE:）
docs/chore/test/build/ci:  不计入版本判定
```

> **注意一**：给已有功能加开关、加配置项时**不要**用 `feat:`。虽然它写起来像新功能，
> 但按本项目的版本规则属于 Patch。写成 `feat:` 会让发版工具推出 Minor，与预期不符。
>
> **注意二**：只服务本仓库开发与发版流程、使用者无感的工具（`scripts/` 下的检查脚本、
> `release-it` 配置与钩子、CI 工作流）**一律用 `chore:`，不要用 `feat:`**。
> 写成 `feat:` 会推出版本号，但使用者完全感知不到这次更新，属于无意义的版本噪音。
>
> 发版时会自动检查：`scripts/check-commit-prefix.mjs` 扫描上一个 tag 以来的提交，
> 若发现用了 `feat:` 但标题含「开关 / 配置项 / toggle / option」等关键词，
> 会列出这些提交并提示改用 `fix:`。默认只提示不阻断，可手动加 `--strict` 改为阻断。

可选作用域：`feat(panel):`、`fix(memory):`、`feat(install):`。

### 发版流程

```bash
npm run release -- --dry-run    # 先看会升到哪个版本、CHANGELOG 长什么样
npm run release:patch           # 修 bug 发版
npm run release:minor           # 新功能发版
npm run release:major           # 不兼容变更发版
```

工具（release-it）会自动：升版本号 → 生成 CHANGELOG → 提交 → 打 tag → 推送。

### 推送前先自检，发现问题就停下

**推送是不可逆的公开动作。** 发现任何问题，先停下来修好、验证通过，再推。
不要「先推上去再说」，也不要推完再补。

推送前逐项确认：

| 检查项 | 怎么查 |
|---|---|
| 工作区干净 | `git status` 无意外改动 |
| 内容正确 | 逐行看过 `git diff`，确认只有预期改动 |
| 行尾与 BOM | 与文件原有格式一致（本仓库多为 LF 无 BOM；`install.ps1` 为 UTF-8 BOM + LF） |
| 文档引用 | 改了标题就复查锚点；`npm run check:hindsight` 可验接口契约 |
| 代码可跑 | `node --check` 过语法，**并在浏览器/实际入口里真跑一遍** |
| 版本三处一致 | 源码 `package.json` == 安装目录 `package.json` == 运行中 `/healthz` 返回的 `version`；tag 名应与 `package.json` 一致 |
| tag 指向正确 | 见下方「校验 tag 指向」，必须用 `^{commit}` 解引用后再比 |

#### 校验 tag 指向：附注 tag 不能用 rev-parse 直接比

本仓库的发布 tag 是**附注 tag**（annotated tag），它本身是一个独立对象，
`git rev-parse v2.0.0` 返回的是 **tag 对象的 ID**，不是它指向的提交 ID。
直接拿它和 `git rev-parse HEAD` 比，永远不相等。

```bash
# ❌ 错：比的是 tag 对象 ID，和 HEAD 必然不等
git rev-parse v2.0.0
git rev-parse HEAD

# ✅ 对：先解引用到提交，再比
git rev-parse 'v2.0.0^{commit}'    # tag 指向哪个提交
git rev-parse HEAD                 # 当前 HEAD
```

远程侧同理，`ls-remote` 要用 `^{}` 后缀才能看到解引用后的提交：

```bash
git ls-remote origin 'refs/tags/v2.0.0^{}'
```

> 附注 tag 对象 ID 与提交 ID 不同是**正常现象**，不代表 tag 有问题。

> 三条真实教训：
> 1. 修 CHANGELOG 时行尾写成了混合 LF/CRLF（仓库原本纯 LF），diff 看不出，肉眼看也不明显；
> 2. 面板改动用了未定义的变量，`node --check` 能过（语法合法），
>    但浏览器一打开就 `ReferenceError` 整块跳过渲染；
> 3. 移动 v2.0.0 tag 后，用 `git rev-parse v2.0.0` 与 `git rev-parse HEAD` 对比，
>    误判为「不一致」，实际是附注 tag 对象 ID 与提交 ID 本就不同。
>
> 所以「语法通过」不等于「能跑」，「两个 ID 不相等」也不等于「指向不对」——
> 都要用正确的判据再验一次。

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

### 提交信息里别裸写 `#` 加十六进制

`release-it` 会把提交信息里的 `#xxxxxx` 当成 issue 引用，自动生成
`/issues/...` 链接。颜色值正好长得一样，所以直接在提交信息里写色值会产出死链。

**❌ 不要这样写：**

```
chore: 生成图标，配色 #38e1ff / #a78bfa / #fbbf24
```

生成的 changelog 会变成：

```
references [#38e1ff](.../issues/38e1ff) [#a78bfa](.../issues/a78bfa) [#fbbf24](.../issues/fbbf24)
```

**⚠️ 用反引号包起来（未验证，不保证有效）：**

```
chore: 生成图标，配色 `#38e1ff` / `#a78bfa` / `#fbbf24`
```

理论上反引号会让它在 changelog 里保留为代码格式、不被解析成链接。
但**这一点尚未实测**——`release-it` 究竟是对原始 commit message 做替换，
还是在 changelog 渲染之后才处理，我们没有验证过。别把它当可靠做法。

**✅ 最稳妥：干脆不写 `#`**

```
chore: 生成图标（青色 / 紫色 / 黄色三套配色）
```

不出现 `#` 就没有被误判的可能，这是唯一能确定有效的写法。

同样的坑也适用于其他「像 issue 编号」的内容，例如 `#1` 开头的短句。
提交前可自查一遍提交信息里有没有裸露的 `#`。

## 升级检查清单

发版前请至少验证：

- 启动正常：`node server.js` 后 `curl http://127.0.0.1:8898/healthz` 返回 `service: dsh-nebula-memory`
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
