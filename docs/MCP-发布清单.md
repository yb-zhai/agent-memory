# MCP Server 发布/提交清单

`nebula-memory-mcp` 已发布到 npm，下面是把 MCP Server 提交到各目录的材料和操作步骤。

## 基础信息（各处通用）

| 项 | 值 |
|---|---|
| 名称 | Nebula Memory (nebula-memory-mcp) |
| GitHub | https://github.com/yb-zhai/agent-memory |
| npm | https://www.npmjs.com/package/nebula-memory-mcp |
| 描述 | 零依赖、纯本地的 Agent 记忆 MCP Server。四臂召回（词法/激活/图扩散/画像），离线可用、无需 API Key、无需数据库。 |
| 版本 | npm 1.0.0 / 项目 1.3.0 |
| 协议 | stdio (JSON-RPC 2.0) |
| 工具 | remember / recall / stats / forget |
| License | MIT |

## MCP 配置片段（通用，复制用）

```json
{
  "mcpServers": {
    "nebula-memory": {
      "command": "npx",
      "args": ["-y", "nebula-memory-mcp@latest"],
      "env": { "NEBULA_DATA_DIR": "/path/to/your/memory" }
    }
  }
}
```

---

## 1. Official MCP Registry（最重要）

仓库根目录已有 `server.json`（name: `io.github.yb-zhai/nebula-memory`）。

**方式**：用官方 `mcp-publisher` 工具发布。

参考：https://github.com/modelcontextprotocol/registry （quickstart.mdx）

大致步骤：
1. 安装 `mcp-publisher`（Go 工具或 npm，见官方 quickstart）；
2. 在仓库根目录执行 `mcp-publisher publish`；
3. 首次需要验证 GitHub 所有权（通过 GitHub Actions 或 DNS）。

> 官方 Registry 会同步到 registry.modelcontextprotocol.io，Claude/Cursor 等客户端从这里发现。

## 2. mcp-submit（一键提交多个目录）

一个命令提交到多个主流目录：

```bash
npx mcp-submit
```

按提示填 GitHub 地址即可。会自动提交到：Official Registry、Smithery、MCPCentral、mcp.so、awesome 列表等。

参考：https://www.npmjs.com/package/mcp-submit

## 3. awesome-mcp-servers（12k⭐）

**方式**：GitHub PR 到 https://github.com/punkpeye/awesome-mcp-servers

在列表里加一行：

```markdown
- [Nebula Memory](https://github.com/yb-zhai/agent-memory) - 零依赖纯本地 Agent 记忆 MCP Server，四臂召回，离线可用，无需 API Key。
```

> 注意：官方 modelcontextprotocol/servers 仓库已**不再接受**新增 server 链接的 PR，统一走 MCP Registry。

## 4. 其他目录（手动网页提交）

| 目录 | 地址 | 方式 |
|---|---|---|
| Smithery | https://smithery.ai | 网页/CLI，填 npm 包名 |
| MCP.so | https://mcp.so | 网页提交或 GitHub issue |
| PulseMCP | https://pulsemcp.com | 网页提交 |
| mcpservers.org | https://mcpservers.org | 网页提交 |
| MCPCentral | https://mcpcentral.io | 网页提交 |
| Claude Desktop 目录 | https://claude.ai/mcp | 浏览器提交 |

## 提交顺序建议

1. **先做 #1 官方 Registry**（最权威，其他目录很多会从它同步）；
2. 再跑 **#2 mcp-submit**（一键覆盖大部分）；
3. 最后手动补 #3、#4。

## 提交前检查

- ✅ npm 包已发布且 `npx -y nebula-memory-mcp` 能启动
- ✅ GitHub 仓库 public，README 完整
- ✅ `server.json` 在仓库根目录
- ✅ 描述里突出「零依赖 / 纯本地 / 离线」差异化
