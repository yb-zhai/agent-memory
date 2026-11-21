# MCP Server 接入说明

`agent-memory` 提供一个**零依赖的 MCP Server**，让 Claude Desktop / Cursor / Windsurf 等任何 MCP 客户端一键接入这套记忆引擎。

> **当前版本：纯本地版**。只接本地四臂引擎（NebulaMemory），零依赖、零花费、不联网、不上云。
> **Hindsight 语义增强版：后续跟进**（暂未提供）。

---

## 快速接入（Claude Desktop）

### 1. clone 仓库

```bash
git clone https://github.com/yb-zhai/agent-memory.git
```

### 2. 编辑 Claude Desktop 配置

打开 Claude Desktop 的配置文件 `claude_desktop_config.json`（不同系统位置不同），加入：

```json
{
  "mcpServers": {
    "agent-memory": {
      "command": "node",
      "args": ["C:\\完整路径\\agent-memory\\mcp-server.mjs"],
      "env": {
        "NEBULA_DATA_DIR": "C:\\完整路径\\memory-data"
      }
    }
  }
}
```

- `command`：你的 Node 可执行文件（通常 `node`）；
- `args`：指向 `mcp-server.mjs` 的**绝对路径**；
- `NEBULA_DATA_DIR`（可选）：记忆数据的存放目录，不填则默认 `~/.agent-memory`。

### 3. 重启 Claude Desktop

重启后，Claude 会自动连上 MCP Server，你就能在对话中让 Claude 使用记忆了。

---

## 提供的工具

| 工具 | 作用 | 参数 |
|---|---|---|
| `remember` | 写入一条记忆 | `text`（必填）、`kind`、`importance`（1.0=永久置顶）、`tags` |
| `recall` | 召回相关记忆 | `query`（必填）、`limit` |
| `stats` | 记忆库统计 | 无 |
| `forget` | 按 id 删除 | `id`（必填） |

---

## 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `NEBULA_DATA_DIR` | 记忆数据目录 | `~/.agent-memory` |
| `MEMORY_NEBULA_DATA_DIR` | 同上（兼容 DSH 插件命名） | — |

---

## 测试（确认 MCP 正常工作）

```bash
node mcp-server.mjs
```

然后手动输入一行 JSON-RPC（回车）：

```json
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
```

应返回四个工具的定义。

---

## 纯本地 vs Hindsight 增强

| | 纯本地版（当前） | Hindsight 增强版（后续） |
|---|---|---|
| 依赖 | 零 | 需 Postgres + LLM |
| 成本 | 零 | 有 LLM 计费 |
| 能力 | 四臂召回（词法/激活/图扩散/画像） | + 语义检索 |
| 状态 | ✅ 已提供 | ⏳ 跟进中 |
