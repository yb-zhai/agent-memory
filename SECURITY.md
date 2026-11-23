# Security Policy

## 报告漏洞

**请勿为安全漏洞开公开 Issue。** 请通过 GitHub 的 [Private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) 私下报告，或在仓库 Security 标签页提交。

请在报告中说明：影响范围、复现步骤、以及你认为的严重程度。我们会在 7 天内首次响应。

## 安全设计

这个插件的安全边界很窄，因此约束必须被明确守住：

| 边界 | 实现 |
|---|---|
| 网络暴露面 | 面板服务**只监听 `127.0.0.1`**，不对外网开放 |
| 密钥 | 优先级：环境变量 `MEMORY_NEBULA_HINDSIGHT_KEY` > 面板设置。面板设置的值用 **Windows DPAPI（CurrentUser 作用域）加密**后存于 `%DSH_HOME%\memory-nebula.key`，密文只有同一台机器的同一个 Windows 用户能解密；**绝不**写入日志、面板回显（只回显 `sk-***abc` 脱敏）、导出文件或 profile 清单 |
| 数据外传 | 本地 JSONL 引擎不联网、不上传、无遥测 |
| 数据位置 | 全部写在 `MEMORY_NEBULA_DATA_DIR` 下，由使用者指定 |
| 只读叠加 | Hindsight 数据仅作只读镜像展示，**不写回**本地 JSONL |

### 记忆数据是明文 JSONL（有意取舍，勿存凭据）

- 本地记忆**不加密**：`nodes.jsonl` / `edges.jsonl` 是明文 JSON 行——这是有意设计，换取外部工具可直接扫描、备份、迁移（与 Obsidian 等本地笔记软件同一信任边界）。**安全边界 = 操作系统用户账户**：能读你用户文件的进程或人，就能读记忆。
- 因此：**不要把高价值凭据（API 密钥、密码、私钥）写进记忆**。记忆库的定位是「工作记忆」，不是密码保险箱——要记凭据，用系统凭据管理器或环境变量，记忆里只存「凭据放在哪里」的指针。README 中的示例仅演示 importance 置顶机制，不代表建议存储真实凭据。
- 路线图：可选的 at-rest 加密（DPAPI 作用域加密 JSONL，牺牲外部可扫描性，默认关闭）——有明确需求再实现。

### 关于 API Key 落盘

面板里填入的 Hindsight API Key 会持久化，以便重启后免于重输。安全边界如下：

- **加密方式**：Windows DPAPI，`CurrentUser` 作用域。密文拷到其他机器或其他 Windows 用户下**无法解密**，会静默失效并提示重新输入。
- **非 Windows 平台**：不做持久化，key 仅存在于进程内存。
- **清除方式**：面板「worker 调度 → Hindsight 连接 → 清除已保存的 Key」，或直接删除 `%DSH_HOME%\memory-nebula.key`。
- **残余风险**：同一 Windows 用户身份下的其他进程理论上可调用 DPAPI 解密。这比明文落盘安全得多，但不等于"绝对不可读"；如需完全不留盘，改用环境变量注入并把面板里的 key 清空。

## 使用者自查

- 不要把 `.env` 提交到 Git，也不要随插件 zip 外发；
- 定期检查 `MEMORY_NEBULA_HINDSIGHT_DIR` 指向的目录权限，其中的 `worker-window.json`、`cost-guard.state.json` 可能含运行状态信息；
- `%DSH_HOME%\backups\memory-nebula\` 中的升级备份包含完整记忆副本和本地路径，不得提交公开仓库或随插件包外发；不需要的旧备份应妥善删除。
- 共享截图或日志前，先脱敏个人记忆内容与路径。
