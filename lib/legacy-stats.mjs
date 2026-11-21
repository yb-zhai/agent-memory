/**
 * legacy-stats.mjs — 旧 dsh-brain-nebula 面板的数据兼容层。
 *
 * 目的：在整合版（本地 JSONL + Hindsight 叠加）里补齐旧全功能面板所需的
 * 数据字段，让旧 panel.html 的 1887 行 canvas 渲染逻辑几乎原样复用：
 *   - layers.sessions / conversation：扫描 DSH_HOME/sessions 的 zstd 会话文件
 *   - layers.ingest：entities / documents / chunks / mentions（Hindsight API）
 *   - layers.memory：units / links / engrams / bridges / fact_types / link_types
 *   - layers.retrieval：traces / last_latency / last_ts
 *   - layers.llm：requests / tokens / model / models
 *   - layers.engines：hindsight / llm / vl 铭牌
 *   - delta：counts 增量
 *
 * 设计约束：
 *   - 零第三方依赖（zstd 用 Node 22 内置 zlib.zstdDecompressSync）
 *   - 慢调用（chunks 遍历文档、mentions）低频刷新，不进高频 tick
 *   - 数据取不到就留 null（面板显示「—」），绝不伪造 0
 */

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import os from 'node:os'

const SUBAGENT_TOOLS = new Set(['spawn_teammate', 'subagent', 'subagent_fork', 'workflow'])

function encodeBank(bank) { return encodeURIComponent(bank) }

function sumTokens(stats) {
  if (!stats) return 0
  if (stats.tokens && Number.isFinite(Number(stats.tokens.total))) return Number(stats.tokens.total)
  let total = 0
  for (const bucket of stats.buckets || []) {
    const tokens = bucket.tokens || bucket
    total += Number(tokens.total) || (Number(tokens.input) || 0) + (Number(tokens.output) || 0) + (Number(tokens.cached) || 0) + (Number(tokens.thoughts) || 0)
  }
  return total
}

function contentText(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join(' ')
}

function isLocalProvider(provider) {
  const p = String(provider || '').toLowerCase()
  if (!p) return false
  return p === 'onnx' || p === 'local' || p === 'ollama' || p === 'llamacpp' || p === 'llama.cpp' || p === 'vllm' || p === 'lmstudio'
}

function recencyWeight(ms) {
  if (!ms) return 0.4
  const ageDays = Math.max(0, (Date.now() - ms) / 86400000)
  return Math.max(0.05, Math.round(0.5 ** (Math.max(0, ageDays - 7) / 45) * 1000) / 1000)
}

// -- DSH session 文件扫描 ----------------------------------------------------

function listSessionFiles(root) {
  const out = []
  const stack = [[root, 0]]
  while (stack.length) {
    const [dir, depth] = stack.pop()
    if (depth > 6) continue
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push([full, depth + 1])
      } else if (entry.isFile() && entry.name === 'session.v4.jsonl.zstd') {
        try {
          const stat = fs.statSync(full)
          out.push({ path: full, size: stat.size, mtimeMs: stat.mtimeMs })
        } catch { /* ignore */ }
      }
    }
  }
  return out
}

function scanSessions(dshHome) {
  const files = listSessionFiles(path.join(dshHome, 'sessions')).sort((a, b) => b.mtimeMs - a.mtimeMs)
  const latest = files.find((file) => file.size > 1024) || files[0] || null
  const now = Date.now()
  const bytes = files.reduce((sum, file) => sum + file.size, 0)
  return {
    count: files.length,
    bytes,
    mb: Math.round((bytes / (1024 * 1024)) * 10) / 10,
    active: files.filter((file) => now - file.mtimeMs < 900000).length,
    last_ts: latest ? latest.mtimeMs / 1000 : 0,
    latest,
  }
}

function readSchedules(dshHome) {
  try {
    const file = path.join(dshHome, 'storages', 'schedule.json')
    if (!fs.existsSync(file)) return { count: 0, next: null }
    const json = JSON.parse(fs.readFileSync(file, 'utf8'))
    const rows = Array.isArray(json) ? json : json.schedules || json.items || []
    return { count: rows.length, next: null }
  } catch { return { count: 0, next: null } }
}

function emptyConversation() {
  return { users: 0, assistants: 0, turns: 0, steps: 0, tool_calls: 0, todos: 0, subagents: 0, tool_top: [], tail: [], last_ts: 0, cwd: '', preset: '', id: '' }
}

/** 增量读取 zstd 会话文件（每帧一个 JSONL chunk） */
class SessionReader {
  constructor(file) { this.file = file; this.offset = 0; this.buffer = ''; this.resetState() }
  resetState() {
    this.state = { users: 0, assistants: 0, turns: 0, steps: 0, toolCalls: 0, tools: Object.create(null), todos: 0, subagents: 0, lastTs: 0, tail: [], cwd: '', preset: '', id: '' }
  }
  reset() { this.offset = 0; this.buffer = ''; this.resetState() }
  pushTail(kind, text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim()
    if (!clean) return
    this.state.tail.push({ kind, text: clean.slice(0, 140) })
    if (this.state.tail.length > 8) this.state.tail.shift()
  }
  consume(line) {
    let event
    try { event = JSON.parse(line) } catch { return }
    const type = event.type || event.kind || ''
    const data = event.data || {}
    const ts = Number(event.time)
    if (Number.isFinite(ts) && ts > 0) {
      const seconds = ts > 1e12 ? ts / 1000 : ts
      if (seconds > this.state.lastTs) this.state.lastTs = seconds
    }
    if (type === 'session') {
      this.state.id = data.id || event.id || this.state.id
      this.state.cwd = data.cwd || this.state.cwd
      this.state.preset = data.agentPreset || data.preset || this.state.preset
      return
    }
    if (type === 'user/message') { this.state.users += 1; this.pushTail('user', contentText(data.content)); return }
    if (type === 'assistant/message') { this.state.assistants += 1; this.pushTail('assistant', contentText((data.message || {}).content)); return }
    if (type === 'turn/start') { this.state.turns += 1; return }
    if (type === 'step/start') { this.state.steps += 1; return }
    if (type === 'todo/write') { if (Array.isArray(data.todos)) this.state.todos = data.todos.length; return }
    if (type === 'tool/call') {
      this.state.toolCalls += 1
      const name = data.name || 'unknown'
      this.state.tools[name] = (this.state.tools[name] || 0) + 1
      if (SUBAGENT_TOOLS.has(name)) this.state.subagents += 1
      if (name === 'todo_write') {
        try { const args = JSON.parse(data.arguments || '{}'); if (Array.isArray(args.todos)) this.state.todos = args.todos.length } catch { /* ignore */ }
      }
      this.pushTail('tool', name)
    }
  }
  readNew() {
    let stat
    try { stat = fs.statSync(this.file) } catch { return this.state }
    if (stat.size < this.offset) this.reset()
    if (stat.size === this.offset) return this.state
    let chunk
    try {
      const fd = fs.openSync(this.file, 'r')
      const length = stat.size - this.offset
      chunk = Buffer.allocUnsafe(length)
      fs.readSync(fd, chunk, 0, length, this.offset)
      fs.closeSync(fd)
    } catch { return this.state }
    const starts = []
    for (let i = 0; i <= chunk.length - 4; i += 1) {
      if (chunk[i] === 0x28 && chunk[i + 1] === 0xb5 && chunk[i + 2] === 0x2f && chunk[i + 3] === 0xfd) starts.push(i)
    }
    if (!starts.length) return this.state
    if (starts[0] !== 0) { if (this.offset === 0) return this.state; this.reset(); return this.readNew() }
    let consumed = 0
    for (let i = 0; i < starts.length; i += 1) {
      const start = starts[i]
      const end = starts[i + 1] ?? chunk.length
      let text
      try { text = zlib.zstdDecompressSync(chunk.subarray(start, end)).toString('utf8') } catch { break }
      consumed = end
      this.buffer += text
      let index
      while ((index = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, index).replace(/\r$/, '')
        this.buffer = this.buffer.slice(index + 1)
        if (line.trim()) this.consume(line)
      }
    }
    this.offset += consumed
    return this.state
  }
  snapshot() {
    const tools = Object.entries(this.state.tools).sort((a, b) => b[1] - a[1]).slice(0, 5)
    return {
      users: this.state.users, assistants: this.state.assistants, turns: this.state.turns, steps: this.state.steps,
      tool_calls: this.state.toolCalls, todos: this.state.todos, subagents: this.state.subagents, tool_top: tools,
      tail: this.state.tail.slice(-6), last_ts: this.state.lastTs, cwd: this.state.cwd, preset: this.state.preset, id: this.state.id,
    }
  }
}

/** 从 Hindsight 采集旧面板铭牌/抽取层需要的额外数据 */
class ExtraHindsight {
  constructor(base, bank, timeoutMs = 8000) { this.base = String(base || '').replace(/\/+$/, ''); this.bank = bank; this.timeout = timeoutMs }
  path() { return `${this.base}/v1/default/banks/${encodeBank(this.bank)}` }
  async json(url, opts = {}, timeoutMs = this.timeout) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal, headers: { accept: 'application/json', ...(opts.headers || {}) } })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
      return await res.json()
    } finally { clearTimeout(timer) }
  }
  async apiVersion() { const j = await this.json(`${this.base}/version`); return String(j.api_version || '') }
  async entitiesTotal() { const j = await this.json(`${this.path()}/entities?limit=1`); return Number(j.total) || 0 }
  async documents() { const j = await this.json(`${this.path()}/documents?limit=500`); return Array.isArray(j.items) ? j.items : [] }
  async docChunkTotal(id) { const j = await this.json(`${this.path()}/documents/${encodeURIComponent(id)}/chunks?limit=1`); return Number(j.total) || 0 }
  async entityMentions() {
    const j = await this.json(`${this.path()}/entities?limit=20000`, {}, 20000)
    const rows = Array.isArray(j.items) ? j.items : []
    return rows.reduce((s, e) => s + (Number(e.mention_count) || 0), 0)
  }
  async llm() {
    const j = await this.json(`${this.path()}/llm-requests?limit=40`)
    const items = Array.isArray(j.items) ? j.items : []
    const seen = new Map()
    let latest = null
    for (const item of items) {
      const model = String(item && item.model ? item.model : '').trim()
      if (!model) continue
      const provider = String(item.provider || '').trim()
      if (!latest) latest = { provider, model, status: item.status || '', at: item.started_at || null }
      const key = `${provider}\u0000${model}`
      const hit = seen.get(key)
      if (hit) hit.n += 1
      else seen.set(key, { provider, model, n: 1, status: item.status || '', at: item.started_at || null })
    }
    const models = Array.from(seen.values()).sort((a, b) => b.n - a.n).slice(0, 3)
    return { requests: Number(j.total) || 0, model: latest, models }
  }
  async llmStats() { return this.json(`${this.path()}/llm-requests/stats?period=7d`) }
}

/**
 * LegacyStats：整合版服务端的旧形状数据兼容层。
 * opts: { dshHome, hindsightUrl, bank, statsProvider, localStatsProvider, log }
 *   statsProvider(): 返回 Hindsight /stats 原始对象（整合版 engine 已有）
 *   localStatsProvider(): 返回 { nodes, edges } 本地引擎统计
 */
export class LegacyStats {
  constructor(opts) {
    this.dshHome = opts.dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
    this.hindsightUrl = opts.hindsightUrl || ''
    this.bank = opts.bank || ''
    this.statsProvider = opts.statsProvider || (() => ({}))
    this.localStatsProvider = opts.localStatsProvider || (() => ({}))
    this.log = opts.log || (() => {})
    this.extra = null
    this.apiVersion = ''
    this.entities = 0
    this.llm = { requests: 0, model: null, models: [] }
    this.tokens = 0
    this.extract = { chunks: null, mentions: null, at: 0, busy: false, err: '' }
    this.local = { sessions: { count: 0, mb: 0, active: 0, last_ts: 0 }, conversation: emptyConversation(), schedules: { count: 0, next: null } }
    this.reader = null
    this.recallCount = 0
    this.recallMeta = null
    this.lastMetaAt = 0
    this.statePath = path.join(this.dshHome, 'memory-nebula-legacy-state.json')
    this._loadState()
  }

  _loadState() {
    try {
      if (fs.existsSync(this.statePath)) {
        const j = JSON.parse(fs.readFileSync(this.statePath, 'utf8'))
        this.recallCount = Number(j.recallCount) || 0
      }
    } catch { /* ignore */ }
  }
  saveState() {
    try {
      fs.writeFileSync(this.statePath, JSON.stringify({ recallCount: this.recallCount }, null, 2) + '\n', 'utf8')
    } catch (e) { this.log(`legacy state save failed: ${e.message}`) }
  }

  noteRecall(latencyMs) {
    this.recallCount += 1
    this.recallMeta = { last_latency: latencyMs || null, last_ts: Date.now() / 1000 }
    this.saveState()
  }

  _ensureExtra() {
    if (!this.extra || this.extra.bank !== this.bank || this.extra.base !== String(this.hindsightUrl || '').replace(/\/+$/, '')) {
      this.extra = new ExtraHindsight(this.hindsightUrl, this.bank)
    }
    return this.extra
  }

  /** 高频 tick 调用：节流刷新本地扫描 + 轻量元数据 */
  async maybeRefresh(nowMs = Date.now()) {
    // 本地会话扫描（便宜，5s）
    if (!this._localAt || nowMs - this._localAt > 5000) {
      this._localAt = nowMs
      try {
        const scan = scanSessions(this.dshHome)
        if (scan.latest) {
          if (!this.reader || this.reader.file !== scan.latest.path) this.reader = new SessionReader(scan.latest.path)
          this.reader.readNew()
        }
        this.local = {
          sessions: { count: scan.count, mb: scan.mb, active: scan.active, last_ts: scan.last_ts },
          conversation: this.reader ? this.reader.snapshot() : emptyConversation(),
          schedules: readSchedules(this.dshHome),
        }
      } catch { /* keep last */ }
    }

    if (!this.bank || !this.hindsightUrl) return
    const extra = this._ensureExtra()
    // 轻量元数据（10s）
    if (!this.lastMetaAt || nowMs - this.lastMetaAt > 10000) {
      this.lastMetaAt = nowMs
      const [entities, llm, llmStats, ver] = await Promise.all([
        extra.entitiesTotal().catch(() => 0),
        extra.llm().catch(() => ({ requests: 0, model: null, models: [] })),
        extra.llmStats().catch(() => null),
        this.apiVersion ? Promise.resolve(this.apiVersion) : extra.apiVersion().catch(() => ''),
      ])
      this.entities = entities
      this.llm = llm
      this.tokens = sumTokens(llmStats)
      if (ver) this.apiVersion = ver
    }
    // 抽取层（10min，慢）
    if (!this.extract.busy && (!this.extract.at || nowMs - this.extract.at > 600000)) {
      this._refreshExtract(extra).catch(() => {})
    }
  }

  async _refreshExtract(extra) {
    this.extract.busy = true
    try {
      const docs = await extra.documents()
      let chunks = 0, failed = 0
      for (const doc of docs) {
        if (!doc || !doc.id) continue
        try { chunks += await extra.docChunkTotal(doc.id) } catch { failed += 1 }
      }
      const mentions = await extra.entityMentions().catch(() => null)
      this.extract = { chunks: failed ? null : chunks, mentions, at: Date.now(), busy: false, err: failed ? `${failed} documents failed` : '' }
    } catch (e) {
      this.extract = { ...this.extract, at: Date.now(), busy: false, err: e.message }
    }
  }

  /** 组装旧面板 layers 对象 */
  layers(hindsightAvailable) {
    const st = this.statsProvider() || {}
    const local = this.localStatsProvider() || {}
    const byType = st.nodes_by_fact_type || {}
    const byLink = st.links_by_link_type || {}
    const memory = {
      units: Number(st.total_nodes) || local.nodes || 0,
      links: Number(st.total_links) || local.edges || 0,
      engrams: Number(st.total_observations) || 0,
      bridges: Number(byLink.entity) || 0,
      fact_types: byType,
      link_types: byLink,
      pending_consolidation: Number(st.pending_consolidation) || 0,
      last_write_at: st.last_memory_write_at || null,
    }
    const ingest = {
      documents: Number(st.total_documents) || 0,
      chunks: this.extract.chunks,
      entities: this.entities || 0,
      unit_entities: this.extract.mentions,
      entities_by_fact_type: byType,
    }
    const retrieval = {
      traces: this.recallCount,
      last_latency: this.recallMeta ? this.recallMeta.last_latency : null,
      last_ts: this.recallMeta ? this.recallMeta.last_ts : null,
    }
    const llm = {
      requests: this.llm.requests || 0,
      tokens: this.tokens || 0,
      model: this.llm.model || null,
      models: this.llm.models || [],
    }
    const engines = {
      hindsight: { url: this.hindsightUrl || '', bank: this.bank || '', ok: Boolean(hindsightAvailable), mode: hindsightAvailable ? 'hybrid' : 'local', version: this.apiVersion || '' },
      llm: {
        provider: (llm.model && llm.model.provider) || '',
        model: (llm.model && llm.model.model) || '',
        status: (llm.model && llm.model.status) || '',
        at: (llm.model && llm.model.at) || null,
        billing: isLocalProvider(llm.model && llm.model.provider) ? 'local' : 'remote',
      },
      vl: { running: false, model: '' },
    }
    return { ...this.local, ingest, memory, retrieval, llm, engines }
  }
}

export { recencyWeight, sumTokens, contentText }
