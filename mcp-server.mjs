/**
 * agent-memory MCP Server — 纯本地版（零依赖）。
 * 仓库：https://github.com/yb-zhai/agent-memory
 *
 * 一个 stdio 上的 Model Context Protocol (MCP) 服务，把 NebulaMemory 记忆引擎
 * 暴露给 Claude Desktop / Cursor / Windsurf 等任何 MCP 客户端。
 *
 * 设计原则：
 *   - 零依赖：手写 stdio + JSON-RPC 2.0，不引 @modelcontextprotocol/sdk；
 *   - 纯本地：只接本地四臂引擎（NebulaMemory），不碰 Hindsight / Postgres / LLM；
 *   - 与模型无关：任何 MCP 客户端接入后，都能读写这套记忆。
 *
 * 本 MCP 入口只接本地四臂；需要 Hindsight 语义增强请走 DSH 插件面板那条路
 * （Hindsight 服务端需自行安装，见 README「关于语义增强」）。
 *
 * 用法（Claude Desktop 的 claude_desktop_config.json）：
 *   {
 *     "mcpServers": {
 *       "agent-memory": {
 *         "command": "node",
 *         "args": ["C:\\path\\to\\agent-memory\\mcp-server.mjs"],
 *         "env": { "NEBULA_DATA_DIR": "C:\\path\\to\\memory" }
 *       }
 *     }
 *   }
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { NebulaMemory } = require(path.join(__dirname, 'memory', 'store.cjs'))

// ── 配置 ────────────────────────────────────────────────────────────────
const DATA_DIR = path.resolve(
  process.env.NEBULA_DATA_DIR ||
  process.env.MEMORY_NEBULA_DATA_DIR ||
  path.join(os.homedir(), '.agent-memory')
)

const SERVER_INFO = {
  name: 'agent-memory',
  version: '1.2.0',
}

// MCP 协议版本（当前规范）
const PROTOCOL_VERSION = '2024-11-05'

// ── 多库（namespace）支持 ────────────────────────────────────────────────
// 可选参数：不传 namespace 时走原来的 DATA_DIR 单库（完全向后兼容）；
// 传了则用 DATA_DIR/__ns__/<name> 子目录，各库互不干扰。
const NS_ROOT = path.join(DATA_DIR, '__ns__')
const memCache = new Map() // namespace -> NebulaMemory 实例

function normalizeNamespace(ns) {
  if (ns == null) return null
  const s = String(ns).trim()
  if (!s) return null
  // 白名单：只允许字母数字、下划线、连字符；防止目录穿越。
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) throw new Error(`invalid namespace: ${s}`)
  return s
}

async function getMemory(ns) {
  if (ns == null) return null // 调用方改用默认单库实例
  if (!memCache.has(ns)) {
    const dir = path.join(NS_ROOT, ns)
    const m = new NebulaMemory({ dir, log: () => {} })
    await m.init()
    memCache.set(ns, m)
  }
  return memCache.get(ns)
}

// ── stdio 行缓冲读写 ─────────────────────────────────────────────────────
// MCP stdio transport：每行一个 JSON-RPC 消息（LF 分隔），无 Content-Length 头
// （那是 LSP 的做法；MCP stdio 用换行分隔的 JSON）。

function readStdinLines(onLine) {
  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buf += chunk
    let idx
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '')
      buf = buf.slice(idx + 1)
      if (line.trim()) onLine(line)
    }
  })
  process.stdin.on('end', () => { if (buf.trim()) onLine(buf) })
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

// ── JSON-RPC 响应助手 ────────────────────────────────────────────────────
function ok(id, result) { send({ jsonrpc: '2.0', id, result }) }
function err(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }) }

// ── MCP 工具定义 ─────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'remember',
    description: '写入一条记忆。可选 importance（0~1，1.0 表示置顶/永久事实，永不受时间衰减，用于存 API 密钥、用户称呼偏好等关键信息）、kind（episode/fact/note/profile）、tags。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要记住的内容' },
        kind: { type: 'string', enum: ['episode', 'fact', 'note', 'profile'], description: '记忆类型，默认 episode' },
        importance: { type: 'number', description: '重要性 0~1，1.0 = 永久置顶', minimum: 0, maximum: 1 },
        tags: { type: 'array', items: { type: 'string' }, description: '标签' },
        namespace: { type: 'string', description: '目标记忆库（可选）。不填=默认单库；填了写入独立子库，如 work/personal。仅字母数字、_、-，≤64字符。' },
      },
      required: ['text'],
    },
  },
  {
    name: 'recall',
    description: '召回与 query 相关的记忆。本地四臂检索，返回按相关度排序的记忆列表。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要检索的内容' },
        limit: { type: 'number', description: '最多返回条数，默认 6' },
        namespace: { type: 'string', description: '目标记忆库（可选）。不填=默认单库；填了只在该子库内检索。' },
      },
      required: ['query'],
    },
  },
  {
    name: 'stats',
    description: '返回当前记忆库的统计信息（节点数、边数等）。',
    inputSchema: {
      type: 'object',
      properties: { namespace: { type: 'string', description: '目标记忆库（可选）。不填=默认单库。' } },
    },
  },
  {
    name: 'forget',
    description: '按 id 删除一条记忆。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '记忆 id' },
        namespace: { type: 'string', description: '目标记忆库（可选）。不填=默认单库。' },
      },
      required: ['id'],
    },
  },
  {
    name: 'compact',
    description: '手动压缩记忆库文件：清理追加历史，磁盘显著变小、下次启动明显变快。实例保持可用，不影响读写。可选 namespace。',
    inputSchema: {
      type: 'object',
      properties: { namespace: { type: 'string', description: '目标记忆库（可选）。不填=默认单库。' } },
    },
  },
]

// ── 工具执行 ─────────────────────────────────────────────────────────────
// defaultMem：默认单库实例；args.namespace 传了就切到对应子库。
async function callTool(name, args, defaultMem) {
  const ns = normalizeNamespace(args.namespace)
  const mem = ns == null ? defaultMem : await getMemory(ns)
  switch (name) {
    case 'remember': {
      const input = { text: String(args.text || '') }
      if (args.kind) input.kind = args.kind
      if (args.importance != null) input.importance = Number(args.importance)
      if (Array.isArray(args.tags)) input.tags = args.tags.map(String)
      const r = await mem.remember(input)
      return {
        content: [{ type: 'text', text: JSON.stringify({ id: r.id, deduped: r.deduped }) }],
      }
    }
    case 'recall': {
      const query = String(args.query || '')
      const limit = Math.max(1, Math.min(50, Number(args.limit) || 6))
      const hits = await mem.recall(query, { limit })
      const text = hits.length
        ? hits.map((h, i) => `${i + 1}. [${h.kind}] ${h.text} (score ${h.score})`).join('\n')
        : '(无匹配记忆)'
      return { content: [{ type: 'text', text }] }
    }
    case 'stats': {
      const s = await mem.stats()
      return { content: [{ type: 'text', text: JSON.stringify(s) }] }
    }
    case 'forget': {
      const r = await mem.forget(String(args.id || ''))
      return { content: [{ type: 'text', text: JSON.stringify(r) }] }
    }
    case 'compact': {
      const r = await mem.compact()
      const summary = {
        ok: r.ok,
        durationMs: r.durationMs,
        nodeLines: `${r.before.nodeLines} -> ${r.after.nodeLines}`,
        nodesFileMB: `${r.before.nodesMB} -> ${r.after.nodesMB}`,
      }
      return { content: [{ type: 'text', text: JSON.stringify(summary) }] }
    }
    default:
      throw new Error(`unknown tool: ${name}`)
  }
}

// ── 主流程 ───────────────────────────────────────────────────────────────
async function main() {
  // CLI 子命令：node mcp-server.mjs compact [数据目录]
  // ⚠️ 必须在插件服务停止后使用（压缩重写 JSONL，与服务双写会冲突）。
  if (process.argv[2] === 'compact') {
    const dir = path.resolve(
      process.argv[3] ||
      process.env.NEBULA_DATA_DIR ||
      process.env.MEMORY_NEBULA_DATA_DIR ||
      path.join(os.homedir(), '.agent-memory')
    )
    const mem = new NebulaMemory({ dir, log: () => {} })
    await mem.init()
    const r = await mem.compact()
    await mem.close()
    console.log(JSON.stringify(r, null, 2))
    return
  }

  // 默认单库实例（不传 namespace 时用），保持与旧版完全一致的行为。
  const defaultMem = new NebulaMemory({ dir: DATA_DIR, log: () => {} })
  await defaultMem.init()

  readStdinLines(async (line) => {
    let msg
    try { msg = JSON.parse(line) } catch { return } // 忽略无法解析的行
    const { id, method, params } = msg

    // 通知（无 id）→ 不回复
    if (id == null) return

    try {
      switch (method) {
        case 'initialize':
          ok(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          })
          break
        case 'tools/list':
          ok(id, { tools: TOOLS })
          break
        case 'tools/call': {
          const { name, arguments: args } = params || {}
          const result = await callTool(name, args || {}, defaultMem)
          ok(id, result)
          break
        }
        case 'ping':
          ok(id, {})
          break
        default:
          err(id, -32601, `method not found: ${method}`)
      }
    } catch (e) {
      err(id, -32603, e.message || String(e))
    }
  })
}

main().catch((e) => { console.error(e); process.exit(1) })
