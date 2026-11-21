# Contributing to dsh-memory-nebula

感谢你愿意参与。这个项目是**零依赖、纯本地**的 DSH 记忆插件，所以对提交有两项硬要求。

## 开始之前

```bash
git clone https://github.com/<your-name>/dsh-memory-nebula.git
cd dsh-memory-nebula
node server.js          # 无需 npm install
```

浏览器打开 `http://127.0.0.1:8898/` 即可调试面板（纯 `local` 模式，不需要 Hindsight）。

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

## 发布与升级检查

- **每次发布都要升版本号，并保持 `package.json` 的 `version` 与 `server.js` 的 `VERSION` 一致。**
  安装器的健康检查会核对服务实际返回的 `VERSION` 是否等于 `package.json` 的 `version`，
  **两者不一致会回滚**（防止"文件换了但跑的还是旧代码"）。
  即使两者都保持不变、安装器会放行，也不要这么做：DSH 前端与浏览器可能按版本号缓存 client 模块，
  版本号不变会导致新界面不生效（表现为"重启了还是旧面板"）。
  建议语义化升号：新增功能升 minor（1.0.0 → 1.1.0），修 bug 升 patch（1.1.0 → 1.1.1）。
- 至少验证一次「旧版写入记忆 → 新版升级 → 记忆仍可读取」，并确认 `nodes.jsonl` / `edges.jsonl` 未被安装器替换。
- 至少验证一次故障注入：让新版健康检查失败，确认旧代码、配置、profile 清单与记忆数据均恢复；另需注入回滚复制中途失败，确认当前工作库未被删除或截断。
- 必须覆盖路径中含真实 `.dsh` 段的默认首次安装与重复升级，以及缺少 `dependencies` / `bundles` 属性的最小 profile 清单。
- `DataDir` 为普通文件、目录联接或符号链接时必须在写入前拒绝；停止旧服务时不得误杀仅编辑或引用 `server.js` 的其他进程。
- 数据格式变更必须有明确的 `schemaVersion` 与迁移说明；先利用升级备份验证迁移，禁止无备份原地改写。
- `-DryRun` 不得停止进程、创建备份或修改任何文件。

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
