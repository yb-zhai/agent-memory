/**
 * DSH-memory-nebula — 本地面板服务（零依赖，单目录可外发）。
 *
 * 数据面统一由 lib/engine.mjs 的 MemoryEngine 提供：
 *   - 默认纯本地 JSONL（NebulaMemory，零依赖，独立可运行）；
 *   - 探测到 Hindsight 则叠加其 HTTP API 数据（检索增强 + 可视化）；
 *   - Hindsight 不可用/未安装自动降级单机，面板如实显示模式，不伪造数据。
 *
 * 环境变量前缀统一为 MEMORY_NEBULA_*：
 *   MEMORY_NEBULA_PORT           面板端口（默认 8898）
 *   MEMORY_NEBULA_DATA_DIR       本地 JSONL 数据目录（默认 %DSH_HOME%/memory-nebula-data 或 ~/.memory-nebula）
 *   MEMORY_NEBULA_HINDSIGHT_URL  Hindsight HTTP API 地址（默认 http://127.0.0.1:8888，留空=禁用叠加）
 *   MEMORY_NEBULA_HINDSIGHT_DIR  Hindsight 根目录（默认空；安装器写入用户配置，留空则状态未知）
 *   MEMORY_NEBULA_BANK           指定 Hindsight bank（留空自动选）
 *   MEMORY_NEBULA_HINDSIGHT_KEY  Hindsight API key（可选，经 Authorization 头带上；插件不落盘）
 *   MEMORY_NEBULA_DISABLE_HINDSIGHT  设 1 强制禁用 Hindsight 叠加
 *   MEMORY_NEBULA_SANITIZE_CONTENT   设 0 关闭写入清洗（默认开：剔除思考标签、丢弃纯 JSON 工具输出）
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { MemoryEngine, MODES } from './lib/engine.mjs'
import { LegacyStats, recencyWeight } from './lib/legacy-stats.mjs'
import * as keyVault from './lib/key-vault.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PANEL = path.join(__dirname, 'panel.html')
const ICON = path.join(__dirname, 'icon.svg')

// 版本号的唯一权威源是 package.json —— 发布工具（release-it）只改这一处，
// 避免再出现「package.json 改了、server.js 常量忘了改」导致的升级回滚（见 1.3.9/1.3.10）。
function readPackageVersion() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')
    const v = JSON.parse(raw).version
    if (typeof v === 'string' && v.trim()) return v.trim()
  } catch {
    /* 读不到时退化为 unknown，不阻断服务启动 */
  }
  return 'unknown'
}

export const VERSION = readPackageVersion()
const SERVICE = 'dsh-nebula-memory'
// 本进程启动时刻（epoch ms）：旧面板用它对比 state.ts 判断是否连到了旧进程
const STARTED_AT = Date.now()

// Hindsight 侧文件路径——统一由 MEMORY_NEBULA_HINDSIGHT_DIR 派生。
// 未配置时不猜测本机路径：worker/额度状态显示「未知」，写设置会明确报错，
// 且绝不能把空目录交给 path.join 退化成当前工作目录下的相对路径。
const HINDSIGHT_DIR = String(process.env.MEMORY_NEBULA_HINDSIGHT_DIR || '').trim().replace(/[\\/]+$/, '')
const WORKER_WINDOW_JSON = HINDSIGHT_DIR ? path.join(HINDSIGHT_DIR, 'worker-window.json') : null
const WORKER_WINDOW_PS1 = HINDSIGHT_DIR ? path.join(HINDSIGHT_DIR, 'maintenance', 'worker-window.ps1') : null
const COST_GUARD_STATE = HINDSIGHT_DIR ? path.join(HINDSIGHT_DIR, 'logs', 'cost-guard.state.json') : null
const PREFIX = 'MEMORY_NEBULA_'

const DEFAULT_DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,accept,authorization',
  'cache-control': 'no-store',
}

const FALLBACK_QUERIES = [
  '最近在做什么',
  '这个项目有哪些坑',
  '我叫什么',
  '我的偏好是什么',
  '今天有哪些进展',
]

export function loadConfig(overrides = {}) {
  const home = path.resolve(overrides.dataDir || process.env[`${PREFIX}DATA_DIR`] || path.join(DEFAULT_DSH_HOME, 'memory-nebula-data'))
  const env = (k) => process.env[`${PREFIX}${k}`]

  const cfg = {
    version: VERSION,
    port: Number(env('PORT') || overrides.port || 8898) || 8898,
    host: '127.0.0.1',
    dataDir: home,
    hindsightUrl: String(env('HINDSIGHT_URL') || overrides.hindsightUrl || 'http://127.0.0.1:8888').replace(/\/+$/, ''),
    hindsightKey: String(env('HINDSIGHT_KEY') || overrides.hindsightKey || ''),
    bank: String(env('BANK') || overrides.bank || '').trim(),
    disableHindsight: env('DISABLE_HINDSIGHT') === '1' || overrides.disableHindsight === true,
    // 旧全功能面板需要饱满星图：每类多拉节点（三类合计）、边上限相应提高。
    // 可用 MEMORY_NEBULA_GRAPH_NODES / MAX_EDGES 覆盖；轻量场景可调小。
    graphNodes: clampInt(env('GRAPH_NODES') || overrides.graphNodes, 6000, 10, 20000),
    maxEdges: clampInt(env('MAX_EDGES') || overrides.maxEdges, 12000, 500, 40000),
    refreshMs: clampInt(env('REFRESH_MS') || overrides.refreshMs, 1500, 700, 10000),
    graphRefreshMs: clampInt(env('GRAPH_REFRESH_MS') || overrides.graphRefreshMs, 60000, 10000, 3600000),
    requestTimeoutMs: clampInt(env('REQUEST_TIMEOUT_MS') || overrides.requestTimeoutMs, 8000, 1000, 60000),
    // Hindsight 召回的独立硬超时：比通用 requestTimeoutMs 更严（默认 3s），
    // 超过 3s 就放弃 Hindsight、纯本地出结果 —— 避免外脑慢时拖住对话首字延迟。
    hindsightRecallTimeoutMs: clampInt(env('HINDSIGHT_RECALL_TIMEOUT_MS') || overrides.hindsightRecallTimeoutMs, 3000, 500, 15000),
    recallTopK: clampInt(overrides.recallTopK, 8, 1, 24),
    budgetChars: clampInt(overrides.budgetChars, 1400, 200, 4000),
    // 写入时清洗正文（剔除思考标签、丢弃纯 JSON 工具输出）。默认开；
    // 设 MEMORY_NEBULA_SANITIZE_CONTENT=0 可关闭，让正文原样存储。
    sanitizeContent: env('SANITIZE_CONTENT') !== '0' && overrides.sanitizeContent !== false,
  }

  // Hindsight 叠加默认开，除非显式禁用
  if (cfg.disableHindsight) cfg.hindsightUrl = ''

  return cfg
}

function clampInt(v, fb, lo, hi) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fb
  return Math.max(lo, Math.min(hi, n))
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    ...CORS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

export class MemoryNebulaServer {
  constructor(cfg) {
    this.cfg = cfg
    // API key 持久化：环境变量优先；否则尝试从 DPAPI 加密文件恢复（重启免重输）。
    this.keySource = 'none'
    if (String(cfg.hindsightKey || '').trim()) {
      this.keySource = 'env'
    } else {
      try {
        const restored = keyVault.loadKey(DEFAULT_DSH_HOME)
        if (restored) {
          cfg.hindsightKey = restored
          this.keySource = 'vault'
        }
      } catch { /* 解密失败按未配置处理 */ }
    }
    this.engine = new MemoryEngine(cfg, (m) => console.log(m))
    this.server = null
    this.ready = false
    this.port = cfg.port
    this.clients = new Set()
    this.timer = null
    this.graph = { nodes: [], edges: [], rev: 0, sources: { local: 0, hindsight: 0 } }
    this.graphAt = 0
    this.graphBusy = false
    this.lastRecall = null
    this.lastLocalCounts = { nodes: 0, edges: 0 }
    this.sentGraphRev = 0
    this.recentQueries = []
    // 旧全功能面板的数据兼容层：session 扫描 + Hindsight 额外字段。
    this.legacy = new LegacyStats({
      dshHome: process.env.DSH_HOME || path.join(os.homedir(), '.dsh'),
      hindsightUrl: cfg.hindsightUrl,
      bank: cfg.bank,
      statsProvider: () => this.engine.hindsight?.statsCache || {},
      localStatsProvider: () => ({ nodes: this.engine.lastStats?.local?.nodes || 0, edges: this.engine.lastStats?.local?.edges || 0 }),
      log: (m) => console.log(`[memory-nebula] ${m}`),
    })
    this.lastCountsLegacy = { units: 0, links: 0, traces: 0 }
  }

  async listen() {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handle(req, res).catch((error) => {
          console.error('[memory-nebula] request failed:', error)
          if (!res.headersSent) sendJson(res, 500, { error: error.message })
          else { try { res.end() } catch { /* ignore */ } }
        })
      })
      server.once('error', reject)
      server.listen(this.port, this.cfg.host, () => {
        this.server = server
        const address = server.address()
        if (address && typeof address === 'object') this.port = address.port
        resolve()
      })
    })
  }

  async init() {
    await this.engine.init()
    // engine 可能自动选了 bank，同步给 legacy 兼容层
    const eb = this.engine.hindsight?.bank
    if (eb) this.legacy.bank = eb
    this.currentUrl = this.cfg.hindsightUrl
    // legacy 铭牌/抽取层统计不是 ready 的必要条件，且其中的 Hindsight 元数据请求
    // （entitiesTotal/llm/llmStats/apiVersion）会同步等待 ~1.5s，拖慢冷启动。
    // 改成后台触发：本地会话扫描照跑，Hindsight 元数据等后台探测就绪后自然补上。
    this.legacy.maybeRefresh().catch(() => {})
    await this.refreshGraph()
    this.graphAt = Date.now()
  }

  async refreshGraph() {
    if (this.graphBusy) return
    this.graphBusy = true
    try {
      const g = await this.engine.graph()
      // 节点数受 cfg.graphNodes 限制：全量节点会让 /state 膨胀到数 MB，
      // 浏览器渲染星图时直接卡死白屏（实测 2.8 万节点 -> 8.5 MB）。
      //
      // 取样分两步，缺一不可：
      //   1) 沿时间轴等距抽样 —— 取「最近 N 个」会让星图只剩最近十几小时
      //      （实测 1500 个全落在 11-24 15:53 之后，前 20 天的记忆全被裁掉）；
      //   2) 补回已选节点的邻居 —— 抽样是独立随机的，两个相连节点同时被选中
      //      的概率只有 (1500/28269)²，实测 1500 个节点只剩 129 条边、
      //      仅 198 个节点有连接，星图变成一堆孤立点。
      const allNodes = Array.isArray(g.nodes) ? g.nodes : []
      const rawEdges = (g.edges || []).map((e) => {
        if (Array.isArray(e)) return e
        return [e.source ?? e.a, e.target ?? e.b, Number(e.weight ?? e.w) || 0]
      }).filter(([a, b]) => a && b)

      const limit = this.cfg.graphNodes
      let picked
      if (allNodes.length <= limit) {
        picked = allNodes
      } else {
        // 1) 按时间正序等距抽一半名额
        const sorted = allNodes
          .map((n) => ({ n, t: Number(n.ts) || 0 }))
          .sort((a, b) => a.t - b.t)
        const seedCount = Math.max(1, Math.floor(limit / 2))
        const step = sorted.length / seedCount
        const chosen = new Map()
        for (let i = 0; i < seedCount; i++) {
          const item = sorted[Math.min(Math.floor(i * step), sorted.length - 1)]
          chosen.set(item.n.id, item.n)
        }
        // 2) 建邻接表，把已选节点的邻居补进来，直到用满名额
        const adj = new Map()
        for (const [a, b] of rawEdges) {
          if (!adj.has(a)) adj.set(a, [])
          if (!adj.has(b)) adj.set(b, [])
          adj.get(a).push(b)
          adj.get(b).push(a)
        }
        const byId = new Map(sorted.map((it) => [it.n.id, it.n]))
        // 邻居也按时间顺序遍历，避免总是偏向某一段
        const queue = [...chosen.keys()]
        outer: while (queue.length && chosen.size < limit) {
          const cur = queue.shift()
          for (const nb of adj.get(cur) || []) {
            if (chosen.has(nb)) continue
            const node = byId.get(nb)
            if (!node) continue
            chosen.set(nb, node)
            queue.push(nb)
            if (chosen.size >= limit) break outer
          }
        }
        // 3) 名额还有剩（大量孤立节点时），按时间等距补齐
        if (chosen.size < limit) {
          const rest = sorted.filter((it) => !chosen.has(it.n.id))
          const need = limit - chosen.size
          const s2 = rest.length / Math.max(1, need)
          for (let i = 0; i < need && i * s2 < rest.length; i++) {
            chosen.set(rest[Math.floor(i * s2)].n.id, rest[Math.floor(i * s2)].n)
          }
        }
        picked = [...chosen.values()]
      }

      // 旧面板用节点 w 表示新旧程度（影响节点大小/亮度）；按 ts 补算真实权重。
      const nodes = picked.map((n) => ({ ...n, w: recencyWeight(Number(n.ts) || 0) }))
      const previousIds = new Set(this.graph.nodes.map((n) => n.id))
      const nextNodes = nodes.filter((n) => !previousIds.has(n.id)).slice(0, 30)
      // 抽样后节点变少了，指向未选中节点的边必须一并丢弃，否则星图上会出现
      // 悬空端点（面板画到不存在的位置）。
      const keptIds = new Set(nodes.map((n) => n.id))
      // 旧全功能面板的 buildGraph 期望边是 [a,b,w] 三元组。
      let edges = rawEdges
        .filter(([a, b]) => keptIds.has(a) && keptIds.has(b))
        .slice(0, this.cfg.maxEdges)
      this.graph = { nodes, edges, rev: Date.now(), sources: g.sources, newUnits: nextNodes }
      this.graphAt = Date.now()
    } catch (error) {
      console.warn('[memory-nebula] graph refresh failed:', error.message)
    } finally {
      this.graphBusy = false
    }
  }

  async currentState() {
    const engineState = this.engine.state()
    const ls = this.engine.lastStats || {}
    const localNodes = ls.local?.nodes || 0
    const localEdges = ls.local?.edges || 0
    const hsNodes = ls.hindsight?.nodes || 0
    const hsLinks = ls.hindsight?.links || 0
    // hybrid 时本地可能是 Hindsight 的镜像（同一批记忆），直接相加会重复计数。
    // 有 Hindsight 就以它的 stats 为权威；纯 local 才报本地引擎的数。
    const hybrid = engineState.mode === 'hybrid' && hsNodes > 0
    const counts = {
      units: hybrid ? hsNodes : localNodes || Number(this.legacy?.statsProvider()?.total_nodes) || 0,
      links: hybrid ? hsLinks : localEdges || Number(this.legacy?.statsProvider()?.total_links) || 0,
      traces: this.legacy ? this.legacy.recallCount : (this.lastRecall ? 1 : 0),
      bridges: Number(this.legacy?.statsProvider()?.links_by_link_type?.entity) || 0,
      // 来源拆分：面板可同时展示"本地 N / Hindsight M"，不做去重合并
      bySource: { local: localNodes, hindsight: hsNodes },
    }
    const state = {
      ok: true,
      ready: this.ready === true,
      service: SERVICE,
      version: VERSION,
      mode: engineState.mode,
      hindsightAvailable: engineState.hindsightAvailable,
      bank: engineState.bank,
      db: engineState.hindsightAvailable === true,
      counts,
      stats: this.engine.lastStats,
      layerStats: engineState.layerStats,
      graph: this.graph,
      recall: this.lastRecall,
      new_units: this.graph.newUnits || [],
      started_at: STARTED_AT,
      ts: Date.now() / 1000,
    }
    // 旧全功能面板的 layers 对象（兼容层产出，取自真实数据）
    if (this.legacy) {
      state.layers = this.legacy.layers(engineState.hindsightAvailable)
      state.activated = this.legacy.activated || []
    }
    return state
  }

  async remember(input) {
    return this.engine.remember(input)
  }

  async observe(input) {
    return this.engine.observe(input)
  }

  async recall(query, opts) {
    return this.engine.recall(query, opts)
  }

  startTimers() {
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => {
      this.tick().catch((e) => console.warn('[memory-nebula] tick failed:', e.message))
    }, this.cfg.refreshMs)
    this.timer.unref?.()
  }

  async tick() {
    // 周期重探测 Hindsight：自动 local <-> hybrid 升降级（通用化，不依赖启动顺序）
    await this.engine.maybeRecheckHindsight(30000).catch(() => {})
    await this.engine.refreshStats()
    if (!this.graphBusy && Date.now() - this.graphAt > this.cfg.graphRefreshMs) {
      this.refreshGraph().catch(() => {})
    }
    // 定期 tick 本地引擎（遗忘/归档/巩固节流）
    try { await this.engine.tick() } catch { /* ignore */ }

    // 兼容层：同步自动选出的 bank，刷新 session/Hindsight 额外数据
    if (this.legacy) {
      const eb = this.engine.hindsight?.bank
      if (eb) this.legacy.bank = eb
      await this.legacy.maybeRefresh().catch(() => {})
    }

    const state = await this.currentState()
    const delta = {
      units: state.counts.units - (this.lastCountsLegacy?.units || 0),
      links: state.counts.links - (this.lastCountsLegacy?.links || 0),
      traces: state.counts.traces - (this.lastCountsLegacy?.traces || 0),
    }
    this.lastCountsLegacy = state.counts
    const payload = {
      type: 'tick',
      counts: state.counts,
      delta,
      db: state.db,
      mode: state.mode,
      hindsightAvailable: state.hindsightAvailable,
      bank: state.bank,
      layers: state.layers,
      stats: state.stats,
      layerStats: state.layerStats,
      new_units: this.graph.newUnits || [],
    }
    if (this.graph.rev !== this.sentGraphRev) {
      payload.graph = this.graph
      this.sentGraphRev = this.graph.rev
    }
    this.broadcast(payload)
    this.graph.newUnits = []
  }

  broadcast(value) {
    const frame = `data: ${JSON.stringify(value)}\n\n`
    for (const client of this.clients) {
      try { client.write(frame) } catch { this.clients.delete(client) }
    }
  }

  servePanel(res) {
    let html
    let build = '0'
    try {
      html = fs.readFileSync(PANEL, 'utf8')
      build = String(Math.round(fs.statSync(PANEL).mtimeMs))
      html = html.split('__BUILD__').join(build)
    } catch (error) {
      sendJson(res, 500, { error: `panel.html missing: ${error.message}` })
      return
    }
    // 让页面知道自己这份 HTML 属于哪个 build，用于自更新检测
    html = html.replace('</head>', `<script>window.__PANEL_BUILD__=${JSON.stringify(build)};</script>\n</head>`)
    res.writeHead(200, { ...CORS, 'content-type': 'text/html; charset=utf-8' })
    res.end(html)
  }

  /** 当前面板 build（panel.html 的 mtime）。页面用它判断自己是否过期。 */
  panelBuild() {
    try { return String(Math.round(fs.statSync(PANEL).mtimeMs)) } catch { return '0' }
  }

  serveIcon(res) {
    try {
      const body = fs.readFileSync(ICON)
      res.writeHead(200, { ...CORS, 'content-type': 'image/svg+xml' })
      res.end(body)
    } catch {
      res.writeHead(204, CORS)
      res.end()
    }
  }

  serveEvents(res) {
    res.writeHead(200, { ...CORS, 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive', 'x-accel-buffering': 'no' })
    res.write(': connected\n\n')
    this.currentState().then((state) => {
      res.write(`data: ${JSON.stringify({ ...state, type: 'hello' })}\n\n`)
    })
    this.clients.add(res)
    const heartbeat = setInterval(() => { try { res.write(': ping\n\n') } catch { /* ignore */ } }, 15000)
    heartbeat.unref?.()
    const cleanup = () => { clearInterval(heartbeat); this.clients.delete(res) }
    req_on_close(res, cleanup)
  }

  async handleRecall(url, res) {
    const query = String(url.searchParams.get('q') || '').trim()
    if (!query) { sendJson(res, 400, { error: 'missing q' }); return }
    const started = Date.now()
    const result = await this.recall(query, { topK: this.cfg.recallTopK, budgetChars: this.cfg.budgetChars })
    const latency = Date.now() - started

    // 按真实数据链归一化：每条片段保留来源、召回臂、分层、类型与真实分数，
    // 不再随机轮播的示意卡。分数用 RRF 融合（见下），本地与 Hindsight 同列但标明来源。
    const localItems = []
    const hsItems = []
    const seen = new Set()
    const seenKey = (obj) => String(obj.id || obj.text || '').slice(0, 80)
    // 本地四臂召回片段（真实字段来自 fragments.cjs buildFragment）
    for (const f of (result.fragments || [])) {
      const obj = {
        source: 'local',
        id: String(f.id || ''),
        text: String(f.text || f.content || '').slice(0, 500),
        arm: f.arm || 'activation',
        why: f.why || '',
        layer: f.layer || '',
        kind: f.kind || '',
        hop: Number(f.hop) || 0,
        score: Number(f.score) || 0,
        importance: Number(f.importance) || 0,
        retention: Number(f.retention) || 0,
      }
      const key = seenKey(obj)
      if (!key || seen.has(key)) continue
      seen.add(key)
      localItems.push(obj)
    }
    // Hindsight 命中（experience/observation/world，带语义/关键词/重排分）
    const hs = result.hindsight || {}
    for (const h of (hs.results || [])) {
      const sc = h.scores || {}
      const obj = {
        source: 'hindsight',
        id: String(h.id || ''),
        text: String(h.text || '').slice(0, 500),
        arm: 'hindsight',
        why: String(h.type || ''),
        layer: '',
        kind: String(h.type || ''),
        hop: 0,
        score: Number(sc.final ?? h.score) || 0,
        scores: { semantic: Number(sc.semantic) || 0, keyword: Number(sc.keyword) || 0, reranker: Number(sc.reranker) || 0 },
      }
      const key = seenKey(obj)
      if (!key || seen.has(key)) continue
      seen.add(key)
      hsItems.push(obj)
    }

    // ---- RRF 融合（Reciprocal Rank Fusion）------------------------------
    // 本地四臂的 score 是 0~1 的加权融合分（0.55·lexNorm+0.30·actNorm+0.15·recency），
    // Hindsight 的 score 是语义/关键词/重排分，两者不在同一个分数空间，直接混排
    // 会因某侧天然偏高/偏低而淹没另一侧的精准匹配。
    // 改为按「来源」各取排名，score = Σ 1/(k + rank)，k=60：
    // 跨来源可比、组内相对顺序保留，且对各自 Top-K 大小不敏感。
    const RRF_K = 60
    const assignRrf = (items) => {
      // 组内按原始 score 降序排，rank 从 0 起
      const sorted = items.slice().sort((a, b) => b.score - a.score)
      const rrfByKey = new Map()
      sorted.forEach((it, idx) => rrfByKey.set(seenKey(it), 1 / (RRF_K + idx)))
      for (const it of items) {
        it.rawScore = it.score
        it.rrfRank = sorted.indexOf(it)
        it.score = rrfByKey.get(seenKey(it)) || 0
      }
    }
    assignRrf(localItems)
    assignRrf(hsItems)
    // 合并后按 RRF 分降序；同分时本地优先（保底语义靠本地），再按 id 稳定排序
    const results = localItems.concat(hsItems)
    results.sort((a, b) => (b.score - a.score) || ((a.source === 'local' ? 0 : 1) - (b.source === 'local' ? 0 : 1)) || String(a.id || '').localeCompare(String(b.id || '')))

    // 种子全量透传（不截断）：引擎侧已按 graphSeeds=18 产出，
    // 这里再 slice(0,8) 会让面板看到的种子数少于实际点亮数，星云与统计对不上。
    const seeds = (result.seeds || []).map((s) => (typeof s === 'string' ? { id: s, text: s } : { id: s.id, text: String(s.text || '').slice(0, 120) }))
    // 真实统计：四臂命中数 / 候选 / tokensUsed / dropped
    const stats = result.stats || {}
    const arms = stats.arms || {}
    const meta = {
      source: this.engine.mode,
      n_candidates: Number(stats.candidates) || results.length,
      tokensUsed: Number(stats.tokensUsed) || 0,
      dropped: Number(stats.dropped) || 0,
      arms: { lexical: Number(arms.lexical) || 0, activation: Number(arms.activation) || 0, graph: Number(arms.graph) || 0, profile: Number(arms.profile) || 0 },
      hindsightCount: (hs.results || []).length,
      expanded: 0,
    }
    this.lastRecall = {
      type: 'recall',
      query,
      seeds,
      fragments: result.fragments || [],
      text: result.text || '',
      hindsight: result.hindsight,
      results,
      activated: result.activated || [],
      meta,
      latency_ms: latency,
      fresh: true,
      ts: Date.now() / 1000,
    }
    // 记录真实召回次数（旧面板⑥卡需要）
    if (this.legacy) {
      this.legacy.noteRecall(latency)
      this.legacy.activated = result.activated || []
    }
    this.recentQueries = [query, ...this.recentQueries.filter((q) => q !== query)].slice(0, 60)
    this.broadcast(this.lastRecall)
    sendJson(res, 200, {
      query,
      latency_ms: latency,
      fragments: result.fragments || [],
      text: result.text || '',
      seeds,
      hindsight: result.hindsight,
      results,
      activated: result.activated || [],
      meta,
      fresh: true,
      mode: this.engine.mode,
    })
  }

  /** 读当前 worker 调度设置（worker-window.json） */
  async readWorkerSettings() {
    if (!WORKER_WINDOW_JSON) {
      return { available: false, schedulerEnabled: null, mode: 'manual', on: '23:00', off: '08:00', autoThreshold: 20 }
    }
    try {
      if (fs.existsSync(WORKER_WINDOW_JSON)) {
        return { available: true, ...JSON.parse(fs.readFileSync(WORKER_WINDOW_JSON, 'utf8')) }
      }
    } catch { /* fallthrough to unavailable */ }
    return { available: false, schedulerEnabled: null, mode: 'manual', on: '23:00', off: '08:00', autoThreshold: 20 }
  }

  /**
   * 读 worker 实时运行状态（2026-11-24 加）
   *
   * 面板需要区分「自动待机」与「运行中」：旧逻辑把 auto 模式一律判为运行中（绿闪），
   * 因为拿不到 worker 是否真的在处理任务。Hindsight 自带 operations 端点支持
   * status=processing 过滤，这就是精确信号：
   *   processing > 0 → worker 真的在干活
   *   processing = 0 且 pending > 0 → 开启但空闲
   * 端点调用超时 2 秒，失败时 available=false，面板回退为「未知」，不阻塞。
   */
  async readWorkerRuntime() {
    const settings = await this.readWorkerSettings()
    const out = { available: false, active: false, processing: 0, pending: 0, error: null }
    if (settings.schedulerEnabled === false) return { ...out, settings }

    const base = this.cfg.hindsightUrl
    const bank = this.engine?.hindsight?.bank || this.cfg.bank
    if (!base || !bank) return { ...out, settings, error: 'hindsight 未连接' }

    try {
      const root = `${base}/v1/default/banks/${encodeURIComponent(bank)}/operations`
      const fetchOps = async (status) => {
        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), 2000)
        try {
          const r = await fetch(`${root}?status=${status}&limit=1`, {
            signal: ctl.signal, headers: { accept: 'application/json' },
          })
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          const j = await r.json()
          return Number(j.total) || 0
        } finally { clearTimeout(timer) }
      }
      const [processing, pending] = await Promise.all([fetchOps('processing'), fetchOps('pending')])
      return { available: true, active: processing > 0, processing, pending, settings, error: null }
    } catch (e) {
      return { ...out, settings, error: e.message }
    }
  }

  /**
   * 读 Hindsight 额度/凭证状态（来自 cost-guard.state.json，零成本）。
   * 返回 { ok:boolean, quotaExhausted:boolean, errorsFreeHour:number, tripped:boolean,
   *        checkedAt:string|null, available:boolean }
   * available=false 表示本机没有 cost-guard 状态文件（如异机/未部署 cost-guard），前端显示「未知」。
   */
  async readQuotaStatus() {
    try {
      if (!COST_GUARD_STATE || !fs.existsSync(COST_GUARD_STATE)) {
        return { available: false, quotaExhausted: false, errorsFreeHour: 0, tripped: false, checkedAt: null }
      }
      let raw = fs.readFileSync(COST_GUARD_STATE, 'utf8')
      // cost-guard 用 PowerShell 写文件，可能带 UTF-8 BOM；JSON.parse 会因 BOM 报错，先剥掉
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1)
      const st = JSON.parse(raw)
      const errorsFreeHour = Number(st.errorsFreeHour) || 0
      const tripped = st.tripped === true
      const quotaExhausted = errorsFreeHour > 0 || tripped
      // kind：把两种原因分开，面板据此显示不同文案
      //   'quota' = 上游拒付/限流（额度或 key 有问题，充值/换 key 才会好）
      //   'trip'  = 本地用量超过自设上限（不是额度问题，不需要充值）
      const kind = errorsFreeHour >= 3 ? 'quota' : (tripped ? 'trip' : null)
      return {
        available: true,
        quotaExhausted,
        kind,
        errorsFreeHour,
        tripped,
        checkedAt: st.checkedAt || null,
        callsToday: Number(st.callsToday) || 0,
        tokensToday: Number(st.tokensToday) || 0,
      }
    } catch {
      return { available: false, quotaExhausted: false, errorsFreeHour: 0, tripped: false, checkedAt: null }
    }
  }

  /** 写 worker 调度设置 + 触发一次 worker-window.ps1 */
  async writeWorkerSettings(input) {
    if (!WORKER_WINDOW_JSON) {
      throw new Error('未配置 MEMORY_NEBULA_HINDSIGHT_DIR，无法修改 worker 调度')
    }
    const cur = await this.readWorkerSettings()
    const next = {
      // schedulerEnabled：缺省 true（只在显式传 false 时停用）
      schedulerEnabled: input.schedulerEnabled === false ? false : true,
      mode: input.mode === 'auto' ? 'auto' : 'manual',
      on: /^\d{1,2}:\d{2}$/.test(String(input.on || '')) ? String(input.on) : (cur.on || '23:00'),
      off: /^\d{1,2}:\d{2}$/.test(String(input.off || '')) ? String(input.off) : (cur.off || '08:00'),
      autoThreshold: Number.isInteger(Number(input.autoThreshold)) && Number(input.autoThreshold) > 0 ? Number(input.autoThreshold) : (cur.autoThreshold || 20),
    }
    // 写设置文件（UTF-8 无 BOM，worker-window.ps1 读它）
    fs.writeFileSync(WORKER_WINDOW_JSON, JSON.stringify(next, null, 2) + '\n', 'utf8')

    // 触发：停用 → -Mode Off（关掉 worker 一次，之后早退冻结）；启用 → -Mode Auto（重新进入调度）
    if (next.schedulerEnabled === false) {
      this._triggerWorker('Off')
    } else {
      this._triggerWorker('Auto')
    }
    return next
  }

  _triggerWorker(mode = 'Auto') {
    if (!WORKER_WINDOW_PS1 || !fs.existsSync(WORKER_WINDOW_PS1)) {
      console.warn('[memory-nebula] worker-window.ps1 missing, skip triggering:', WORKER_WINDOW_PS1)
      return
    }
    try {
      const child = spawn('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WORKER_WINDOW_PS1, '-Mode', mode,
      ], { stdio: 'ignore', windowsHide: true })
      child.on('error', (e) => console.warn('[memory-nebula] trigger worker-window failed:', e.message))
      child.on('exit', (code) => console.log(`[memory-nebula] trigger worker-window -Mode ${mode} exited code=${code}`))
      child.unref()
      console.log(`[memory-nebula] triggered worker-window -Mode ${mode}`)
    } catch (error) {
      console.warn('[memory-nebula] trigger worker-window error:', error.message)
    }
  }

  async handle(req, res) {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return }

    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const pathname = url.pathname

    if (pathname === '/icon.svg') { this.serveIcon(res); return }
    if (pathname === '/' || pathname === '/index.html') { this.servePanel(res); return }
    if (pathname === '/healthz') {
      sendJson(res, 200, await this.currentState())
      return
    }
    // 面板自更新检查：返回当前 panel.html 的 build，页面拿它和自己启动时的比对
    if (pathname === '/version') {
      sendJson(res, 200, { service: SERVICE, version: VERSION, panelBuild: this.panelBuild() })
      return
    }
    if (pathname === '/state') { sendJson(res, 200, await this.currentState()); return }
    if (pathname === '/events') { this.serveEvents(res); return }
    if (pathname === '/recall') { await this.handleRecall(url, res); return }
    if (pathname === '/queries') {
      const queries = this.recentQueries.length ? this.recentQueries : FALLBACK_QUERIES
      sendJson(res, 200, { queries, history: this.recentQueries.length })
      return
    }
    if (pathname === '/worker-settings') {
      if (req.method === 'GET') {
        sendJson(res, 200, await this.readWorkerSettings())
        return
      }
      if (req.method === 'POST') {
        let body = ''
        for await (const chunk of req) body += chunk
        try {
          const input = JSON.parse(body || '{}')
          const next = await this.writeWorkerSettings(input)
          sendJson(res, 200, { ok: true, settings: next })
        } catch (error) {
          sendJson(res, 400, { error: error.message })
        }
        return
      }
    }
    if (pathname === '/worker-status') {
      sendJson(res, 200, await this.readWorkerRuntime())
      return
    }
    if (pathname === '/quota-status') {
      sendJson(res, 200, await this.readQuotaStatus())
      return
    }
    if (pathname === '/remember' && req.method === 'POST') {
      let body = ''
      for await (const chunk of req) body += chunk
      try {
        const input = JSON.parse(body || '{}')
        const r = await this.remember(input)
        sendJson(res, 200, r)
      } catch (error) {
        sendJson(res, 400, { error: error.message })
      }
      return
    }
    if (pathname === '/compact' && req.method === 'POST') {
      // 手动压缩本地库：清理追加历史（磁盘变小、下次启动变快）。实例保持可用。
      if (this._compacting) { sendJson(res, 409, { error: '已有一次压缩在进行中' }); return }
      const mem = this.engine?.local?.mem
      if (!mem) { sendJson(res, 503, { error: '本地引擎未就绪' }); return }
      this._compacting = true
      try {
        sendJson(res, 200, await mem.compact())
      } catch (error) {
        sendJson(res, 500, { error: error.message })
      } finally {
        this._compacting = false
      }
      return
    }
    if (pathname === '/connection-settings') {
      if (req.method === 'GET') {
        // 只回显是否已配置与脱敏预览，绝不返回明文 key
        const key = String(this.cfg.hindsightKey || '')
        sendJson(res, 200, {
          hindsightUrl: this.cfg.hindsightUrl || '',
          hasKey: Boolean(key),
          keyHint: key ? `${key.slice(0, 3)}***${key.slice(-3)}` : '',
          source: this.keySource || 'none',
          vaultSupported: keyVault.supported,
          // 是否已持久化（重启后会自动恢复），面板据此提示"已保存"
          persisted: this.keySource === 'vault' || this.keySource === 'env',
        })
        return
      }
      if (req.method === 'POST') {
        let body = ''
        for await (const chunk of req) body += chunk
        try {
          const input = JSON.parse(body || '{}')
          if (typeof input.hindsightUrl === 'string' && input.hindsightUrl.trim()) {
            this.cfg.hindsightUrl = input.hindsightUrl.trim().replace(/\/+$/, '')
          }
          if (typeof input.hindsightKey === 'string') {
            const nextKey = input.hindsightKey.trim()
            this.cfg.hindsightKey = nextKey
            this.keySource = nextKey ? 'panel' : 'none'
            if (this.engine.hindsight) this.engine.hindsight.base = this.cfg.hindsightUrl
            // 持久化：用 Windows DPAPI（当前用户作用域）加密写入，重启后自动恢复。
            // 空值表示清除已保存的 key。
            try {
              const persisted = keyVault.saveKey(DEFAULT_DSH_HOME, nextKey)
              if (persisted) this.keySource = nextKey ? 'vault' : 'none'
              this.keyPersisted = persisted
            } catch (e) {
              this.keyPersisted = false
              this.keyPersistError = e.message
            }
          }
          // 立即重连验证
          let ok = false
          try {
            if (this.engine.hindsight) ok = await this.engine.hindsight.recheck().then((r) => r.after)
          } catch { /* ignore */ }
          sendJson(res, 200, {
            ok: true,
            connected: ok,
            hindsightUrl: this.cfg.hindsightUrl,
            hasKey: Boolean(this.cfg.hindsightKey),
            persisted: this.keyPersisted === true,
            persistError: this.keyPersistError || '',
            note: this.keyPersisted
              ? 'API key 已用 Windows DPAPI（当前用户）加密保存，重启后自动恢复'
              : 'API key 仅保存在本进程内存，重启后需重新设置（DPAPI 不可用或保存失败）',
          })
        } catch (error) {
          sendJson(res, 400, { error: error.message })
        }
        return
      }
    }
    if (pathname === '/observe' && req.method === 'POST') {
      let body = ''
      for await (const chunk of req) body += chunk
      try {
        const input = JSON.parse(body || '{}')
        const r = await this.observe(input)
        sendJson(res, 200, r)
      } catch (error) {
        sendJson(res, 400, { error: error.message })
      }
      return
    }
    if (pathname === '/consolidate' && req.method === 'POST') {
      try { sendJson(res, 200, await this.engine.consolidate()) } catch (error) { sendJson(res, 500, { error: error.message }) }
      return
    }

    sendJson(res, 404, { error: 'not found', path: pathname })
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const client of this.clients) { try { client.end() } catch { /* ignore */ } }
    this.clients.clear()
    if (this.server) { try { this.server.close() } catch { /* ignore */ } this.server = null }
    this.engine.close().catch(() => {})
  }
}

// req.on('close') 的辅助（避免 close 时再写）
function req_on_close(res, fn) {
  res.rawReq?.on?.('close', fn)
  res.on('close', fn)
  res.on('error', fn)
}

export async function start(overrides = {}) {
  const cfg = loadConfig(overrides)
  const firstPort = cfg.port

  // 2026-11-24：不再盲试 12 个端口，改为「先探复用，探不通就退出」。
  //
  // 历史 bug：旧逻辑对每个端口先 probeService（超时仅 600ms），
  // 探不到就 listen，EADDRINUSE 再 continue 到下一个端口。
  // 已有实例在忙（索引回写 24MB 时 /healthz 会超过 600ms）时探测超时，
  // 被误判为「端口空闲」，listen 又撞 EADDRINUSE，于是换到 +1 端口起新实例。
  // 实测一天内积累出 12 个实例（8898~8909），各占 ~500MB 内存、持续空转 CPU，
  // 且并发写同一个 index.json，留下大量 20MB 的 .tmp 残留。
  //
  // 现在：只认第一个端口（配置端口）。探到本服务就复用；探不到就说明
  // 端口被占用或已有实例不健康——两种情况下**都不该再起新实例**，直接退出，
  // 交给插件宿主（DSH）决定是否重启。一个插件只应有一个实例。
  const existing = await probeService(firstPort, 3000)
  if (existing && existing.service === SERVICE) {
    console.log(`[memory-nebula] reusing server on 127.0.0.1:${firstPort} (${existing.mode})`)
    return { port: firstPort, mode: existing.mode, reused: true, stop() {} }
  }

  const instance = new MemoryNebulaServer({ ...cfg, port: firstPort })
  try {
    await instance.listen()
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      // 端口被占但没有健康的本服务应答：多半是上一个实例还在启动或已失联。
      // 再起一个只会加剧问题（多实例写同一份数据），因此退出而不是换端口。
      throw new Error(
        `port ${firstPort} is in use but no healthy memory-nebula responded; ` +
        `refusing to start a second instance (previous instance may still be shutting down)`
      )
    }
    throw error
  }
  try {
    await instance.init()
    instance.ready = true
    instance.startTimers()
    console.log(`[memory-nebula] http://127.0.0.1:${instance.port}/ (${instance.engine.mode})`)
    return instance
  } catch (error) {
    instance.stop()
    throw error
  }
}

async function probeService(port, timeoutMs = 600) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } })
    if (!res.ok) return null
    const json = await res.json()
    return json && json.service ? json : null
  } catch {
    return null
  }
}

const invokedDirectly = (() => {
  try {
    if (!process.argv[1]) return false
    return path.resolve(process.argv[1]).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase()
  } catch {
    return false
  }
})()

if (invokedDirectly) {
  start()
    .then((instance) => {
      if (instance.reused) process.exit(0)
      const shutdown = () => { instance.stop(); process.exit(0) }
      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
    })
    .catch((error) => {
      console.error('[memory-nebula] failed to start:', error)
      process.exit(1)
    })
}
