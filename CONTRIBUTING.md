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
| 行尾与 BOM | `npm run check:encoding` 一键查（见下方「BOM 与行尾」）。**改完看 `git diff --numstat`：若显示整文件重写（如 `1085 1085`）而不是 1~2 行，说明行尾被动了** |
| 文档引用 | 改了标题就复查锚点；`npm run check:hindsight` 可验接口契约 |
| 代码可跑 | `node --check` 过语法，**并在浏览器/实际入口里真跑一遍** |
| 版本三处一致 | 源码 `package.json` == 安装目录 `package.json` == 运行中 `/healthz` 返回的 `version`；tag 名应与 `package.json` 一致 |
| tag 指向正确 | 见下方「校验 tag 指向」，必须用 `^{commit}` 解引用后再比 |

#### BOM 与行尾：`*.ps1` 必须带 BOM，其余一律不带

**判断标准是文件开头那 3 个字节，不是语法检查，也不是肉眼看代码。** 一条命令查完：

```bash
npm run check:encoding          # 只查 BOM（日常用这个）
npm run check:encoding:all      # BOM + 仓库内行尾，严格模式
```

**三道自动拦截**（`*.ps1` 丢 BOM 这类问题不该靠人记）：

| 时机 | 怎么配 | 拦什么 |
|---|---|---|
| **提交前** | 每人执行一次 `git config core.hooksPath .githooks` | BOM + 行尾，违规直接拒绝提交 |
| **CI** | 自动生效（`.github/workflows/encoding-check.yml`） | 同上，且**自证有效**：故意去掉 `install.ps1` 的 BOM，检查器必须报错 |
| **发版前** | 自动生效（`.release-it.json` 的 `before:init`） | 同上 |

钩子一类的自动检查都是**本地可选**的：`.githooks` 需要 `core.hooksPath` 才会生效，
新克隆仓库默认没有。CI 那层是强制的，所以即使没装钩子也不会漏到 main。

| 文件类型 | BOM | 行尾（仓库内） |
|---|---|---|
| `*.ps1`（`install.ps1` / `uninstall.ps1`） | **必须有** UTF-8 BOM | LF |
| `*.mjs` / `*.cjs` / `*.js` / `*.html` / `*.cmd` / `*.json` | 无 | LF |
| `*.md` | 无 | 不强制（Markdown 渲染与行尾无关） |

> **行尾以「仓库内存储格式」为准。** 本仓库设了 `core.autocrlf=true`，工作区检出是 CRLF
> 属正常现象；脚本查的是 `git show HEAD:<file>` 的内容，所以不会误报。

##### 为什么 `*.ps1` 必须带 BOM

PowerShell 5.1 读**无 BOM** 的 UTF-8 脚本时，会按系统 ANSI 代码页解析——中文 Windows 上是 GBK。
脚本里的中文注释变成乱码后，可能吃掉后面的括号，报出像这样的错误：

```
At install.ps1:84 char:1
+ }
+ ~
Unexpected token '}' in expression or statement.
```

这个报错和注释毫无关系，很难联想到编码问题。

**真实教训**：给 `install.ps1` 加几行中文注释，编辑器顺手把 BOM 去掉了。结果：

- `powershell -File install.ps1 -DryRun` → **第 84 行语法报错**（实际那里没有任何中文）
- `[System.Management.Automation.PSParser]::Tokenize(...)` → **0 个错误**

两个工具结论相反，很容易误判成「没问题」。补回 BOM 后 DryRun 立刻恢复正常。
所以**别信语法检查，也别肉眼看**，直接验首字节，或者跑 `npm run check:encoding`。

编辑器保存时去掉 BOM 是很常见的行为（VS Code、各种格式化工具都可能），
改完 `.ps1` 一定要重跑一次这个检查。

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

#### 别手动改行尾：repo 存 LF，工作区因 autocrlf 是 CRLF

这个仓库设了 `core.autocrlf=true`，所以**同一份文件有两种正确状态**：

| 位置 | 行尾 | 说明 |
|---|---|---|
| 仓库里（`git show HEAD:README.md`） | **LF** | 这是仓库的存储格式，符合「LF 无 BOM」的约定 |
| 工作区（`README.md` 实际文件） | **CRLF** | git 检出时自动转的，不是你改坏的 |

**踩过的坑**：改完一行后，用 PowerShell 或 Python 把工作区文件「统一成 LF」，
git 反而判定**全部行都变了**，`git diff --numstat` 从 `1 1` 变成 `1085 1085`，
一个字的改动看起来像重写了整个文件。

原因是：手动改写绕过了 git 的自动转换，git 拿工作区的 LF 和索引里（转换后）的内容对比，
发现完全不同；而正常流程是「工作区 CRLF → 提交时转 LF → 与索引一致」。

**正确做法**：

```bash
# ❌ 错：手动改行尾，会让 diff 变成整文件重写
#     （PowerShell）$t = $t -replace "`r`n", "`n"; [IO.File]::WriteAllText($p, $t, $enc)

# ✅ 对：只改内容，行尾交给 git
#     用编辑工具做最小替换，改完确认 diff 只有预期那几行
git diff --numstat <file>     # 应为 1 1 这种，不是 1085 1085
```

如果已经改坏了，用 `git checkout -- <file>` 撤销，再重做一次最小替换即可。
**不要**用 `core.autocrlf=false` 去「修正」——那会引入更多无关差异。

> 判断依据看 numstat，别看文件的实际行尾：工作区是 CRLF 属于正常，
> 该验的是「git 认为我改了几行」。

#### 真实教训（推送前自检的由来）

> 三条真实教训：
> 1. 修 CHANGELOG 时行尾写成了混合 LF/CRLF（仓库原本纯 LF），diff 看不出，肉眼看也不明显；
> 2. 面板改动用了未定义的变量，`node --check` 能过（语法合法），
>    但浏览器一打开就 `ReferenceError` 整块跳过渲染；
> 3. 移动 v2.0.0 tag 后，用 `git rev-parse v2.0.0` 与 `git rev-parse HEAD` 对比，
>    误判为「不一致」，实际是附注 tag 对象 ID 与提交 ID 本就不同。
>
> 所以「语法通过」不等于「能跑」，「两个 ID 不相等」也不等于「指向不对」——
> 都要用正确的判据再验一次。
>
> 后来改 README 一行字时又踩了行尾：手动把工作区统一成 LF，diff 变成整文件重写
> （`1085 1085`）。**同一个坑踩了两次，原因不同但判据相同**——
> 看 `git diff --numstat` 的行数，而不是盯着文件的实际行尾。详见上一节。
>
> 再后来给 `install.ps1` 加中文注释，编辑器把 BOM 去掉了：
> `-DryRun` 报「第 84 行 Unexpected token '}'」（那里根本没有中文），
> 而 PSParser 报 0 错误 —— **两个工具结论相反**。补回 BOM 即恢复。
> 判据只能是文件首 3 个字节，`npm run check:encoding` 一条命令验。

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
