/**
 * DSH-memory-nebula — MemoryEngine 抽象层。
 *
 * 统一三后端为同一个数据面，供 server.js 和 panel 使用：
 *   - LocalBackend      — 纯文件 JSONL（NebulaMemory，零依赖，默认/兜底）
 *   - HindsightBackend  — Hindsight HTTP API（可选叠加：检索增强 + 可视化数据源）
 *   - （legacy live_server.py 代理已废弃，不进入本插件）
 *
 * 原则：
 *   - 核心引擎永远可独立运行（LocalBackend 永远可用）；
 *   - 探测到 Hindsight 才叠加其数据；不可用/未安装自动降级单机，不报错、不伪造。
 *
 * 统一模型 UnifiedMemory：
 *   node { id, text, kind, tags[], importance, ts, factType?, score? }
 *   edge { a, b, w, kind }
 *   stats { nodes, edges, documents }
 * kind 映射（Local 为主；Hindsight 层 factType 映射到 kind）：
 *   episode → experience；fact → observation/world；profile/note/summary → observation
 */

import { TraceWriter } from './trace-writer.mjs'

export const MODES = Object.freeze({
  LOCAL: 'local',       // 纯单机 JSONL（默认）
  HYBRID: 'hybrid',     // Local + Hindsight 叠加
  HINDSIGHT: 'hindsight', // 仅 Hindsight（当前不使用，保留语义）
})

// Hindsight fact_type → 本地 kind 的归并映射（用于统一面板展示）
export function factTypeToKind(factType) {
  const t = String(factType || '').toLowerCase()
  if (t === 'experience') return 'episode'
  if (t === 'observation' || t === 'world') return 'fact'
  return 'fact'
}

function clamp(n, lo, hi) {
  const v = Number(n)
  if (!Number.isFinite(v)) return lo
  return v < lo ? lo : v > hi ? hi : v
}

function num(v, fb) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fb
}

export class LocalBackend {
  constructor(engine) {
    this.engine = engine
    this.mem = null
  }

  get id() { return 'local' }
  get label() { return '单机 JSONL' }

  async init() {
    const { NebulaMemory } = await import('../memory/index.mjs')
    const dir = this.engine.cfg.dataDir
    // 把日志接进 store：否则 init() 里的告警（如残留 tmp 清理）会被静默丢弃
    this.mem = new NebulaMemory({
      dir,
      log: (msg) => { try { this.engine.log(msg) } catch { /* 日志失败不影响主流程 */ } },
    })
    await this.mem.init()
    this.engine.log(`local backend ready dir=${dir}`)
  }

  async close() {
    if (this.mem) { try { await this.mem.close() } catch { /* ignore */ } this.mem = null }
  }

  async remember(input) {
    return this.mem.remember(input)
  }

  async observe(input) {
    return this.mem.observe(input)
  }

  async recallFragments(query, opts) {
    return this.mem.recallFragments(query, opts)
  }

  async recall(query, opts) {
    return this.mem.recall(query, opts)
  }

  async consolidate() {
    return this.mem.consolidate()
  }

  async tick(opts) {
    return this.mem.tick(opts)
  }

  async stats() {
    // close() 后 this.mem 为 null；后台探测任务（_connectHindsightBackground）可能
    // 在 close() 之后才跑 refreshStats，此时要安全返回而不是抛 null 读属性。
    return this.mem ? this.mem.stats() : { nodes: 0, edges: 0 }
  }

  async graph() {
    // Local 后端：从 exportAll 里取节点/边，拼成 panel 要的 graph 形状
    const all = this.mem.exportAll()
    const nodes = (all.nodes || []).map((n) => ({
      id: n.id,
      text: n.text,
      fact_type: n.kind,
      ts: n.ts,
      w: 1, // panel 权重占位，本地引擎用 score 表达
    }))
    const edges = (all.edges || []).map((e) => ({
      id: `${e.a}::${e.b}`,
      source: e.a,
      target: e.b,
      weight: e.w,
      kind: e.kind,
    }))
    return { nodes, edges, rev: Date.now() }
  }

  layerStats() {
    return this.mem.layerStats()
  }

  async forget(id) {
    return this.mem.forget(id)
  }
}

export class HindsightBackend {
  constructor(engine) {
    this.engine = engine
    this.base = ''
    this.bank = ''
    this.available = false
    this.statsCache = {}
  }

  get id() { return 'hindsight' }
  get label() { return 'Hindsight HTTP API' }

  bankPath(bank) {
    return `/v1/default/banks/${encodeURIComponent(bank)}`
  }

  async _fetchJson(url, opts = {}, timeoutMs = 8000) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        ...opts,
        signal: controller.signal,
        headers: { accept: 'application/json', ...this._authHeaders(), ...(opts.headers || {}) },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
      return await res.json()
    } finally {
      clearTimeout(timer)
    }
  }

  /** API key 只从运行时配置读取，不进日志、不落盘。未配置时返回空对象。 */
  _authHeaders() {
    const key = String(this.engine.cfg.hindsightKey || '').trim()
    return key ? { authorization: `Bearer ${key}` } : {}
  }

  async _probe() {
    try {
      const res = await fetch(`${this.base}/health`, { signal: AbortSignal.timeout(1500), headers: { accept: 'application/json', ...this._authHeaders() } })
      if (!res.ok) return false
      const json = await res.json().catch(() => null)
      return json && (json.status === 'healthy' || json.status === 'ok' || json.database === 'connected')
    } catch {
      return false
    }
  }

  async init() {
    const base = String(this.engine.cfg.hindsightUrl || '').replace(/\/+$/, '')
    if (!base) { this.available = false; return false }
    this.base = base
    return this._tryConnect()
  }

  /**
   * 探测 + 建立连接（选 bank + 刷新 stats）。
   * 可重复调用：既是启动时的 init，也是周期重探测的核心。
   * @returns {boolean} 本次是否处于「已连接」状态
   */
  async _tryConnect() {
    if (!this.base) { this.available = false; return false }
    const up = await this._probe()
    if (!up) {
      if (this.available) this.engine.log('hindsight lost, downgrading to local-only')
      this.available = false
      return false
    }
    // 健康则选 bank + 刷新（幂等，重复调用安全）
    try {
      const banks = await this._fetchJson(`${this.base}/v1/default/banks`)
      const list = Array.isArray(banks) ? banks : (banks.banks || [])
      const cfgBank = this.engine.cfg.bank
      if (cfgBank) {
        this.bank = cfgBank
      } else if (list.length) {
        const profile = process.env.DSH_PROFILE || process.env.MEMORY_NEBULA_BANK || ''
        const preferred = list.find((b) => b.bank_id === `coding-agent::${profile}`)
        this.bank = (preferred || list.slice().sort((a, b) => (num(b.fact_count, 0) - num(a.fact_count, 0)))[0]).bank_id
      }
      if (!this.bank) { this.available = false; return false }
      await this._refreshStats()
      if (!this.available) this.engine.log(`hindsight overlay ready bank=${this.bank}`)
      this.available = true
      return true
    } catch (error) {
      if (this.available) this.engine.log(`hindsight overlay lost: ${error.message}`)
      this.available = false
      return false
    }
  }

  /** 周期重探测：返回是否发生了「可用性翻转」。由 MemoryEngine 驱动。 */
  async recheck() {
    const before = this.available
    const after = await this._tryConnect()
    return { before, after, flipped: before !== after }
  }

  async _refreshStats() {
    try {
      this.statsCache = await this._fetchJson(`${this.base}${this.bankPath(this.bank)}/stats`, {}, this.engine.cfg.requestTimeoutMs)
    } catch { /* keep cache */ }
  }

  async stats() {
    if (!this.available) return null
    await this._refreshStats().catch(() => {})
    return this.statsCache
  }

  async graph() {
    if (!this.available) return { nodes: [], edges: [], rev: Date.now() }
    const types = ['experience', 'observation', 'world']
    const results = await Promise.allSettled(
      types.map((t) => this._fetchJson(`${this.base}${this.bankPath(this.bank)}/graph?type=${encodeURIComponent(t)}&limit=${this.engine.cfg.graphNodes}`, {}, this.engine.cfg.requestTimeoutMs).catch(() => ({ nodes: [], edges: [] }))),
    )
    const nodes = new Map()
    const edges = new Map()
    results.forEach((res, idx) => {
      if (res.status !== 'fulfilled') return
      const type = types[idx]
      for (const raw of res.value.nodes || []) {
        const d = raw && raw.data
        if (!d || !d.id) continue
        nodes.set(d.id, { id: d.id, text: String(d.text || d.label || '').slice(0, 300), fact_type: type, ts: Date.parse(d.date || '') || 0, w: 1 })
      }
      for (const raw of res.value.edges || []) {
        const d = raw && raw.data
        if (!d || !d.source || !d.target) continue
        edges.set(d.id, [d.source, d.target, num(d.weight, 0)])
      }
    })
    const nodeIds = new Set(nodes.keys())
    const edgeList = [...edges.values()].filter(([s, t]) => nodeIds.has(s) && nodeIds.has(t)).map(([source, target, weight]) => ({ id: `${source}::${target}`, source, target, weight }))
    return { nodes: [...nodes.values()], edges: edgeList, rev: Date.now() }
  }

  async recall(query) {
    if (!this.available || !this.bank) return null
    try {
      return await this._fetchJson(
        `${this.base}${this.bankPath(this.bank)}/memories/recall`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) },
        30000,
      )
    } catch {
      return null
    }
  }
}

/**
 * MemoryEngine：组合 Local + Hindsight，暴露统一接口。
 */
export class MemoryEngine {
  constructor(cfg, logger) {
    this.cfg = cfg
    this._log = logger || (() => {})
    this.local = new LocalBackend(this)
    this.hindsight = new HindsightBackend(this)
    this.mode = MODES.LOCAL
    this.lastStats = null
    this._lastRecheckAt = 0
    // 把 Hindsight 召回写回 brain.recall_trace，喂给 brain_dynamics.py 的 hebb/prune。
    // legacy live_server 停用后该表断更，赫布链路空转（2026-11 排查结论）。写入失败不影响召回。
    this.traceWriter = new TraceWriter(this.cfg, (m) => this.log(m))
  }

  log(msg) {
    this._log(`[memory-nebula] ${msg}`)
  }

  async init() {
    // 本地是保底，必须就绪后才能算「可用」；Hindsight 是增强，探测放后台并发，
    // 不阻塞 ready。之前这里 await 本地 + await Hindsight（~2.4s + ~3.5s 串行），
    // 冷启动被 Hindsight 的 _probe 超时 + bank 列表 + stats 拖到 6 秒。
    // 现在：本地就绪即返回，Hindsight 探测完成后自动升/降级 mode（复用 recheck 路径）。
    await this.local.init()
    this.mode = MODES.LOCAL
    this.log(`engine mode=${this.mode} (hindsight probing in background)`)
    await this.refreshStats()
    // 后台并发探测 Hindsight：完成即切 hybrid，失败保持 local，全程不阻塞调用方。
    this._hindsightProbe = this._connectHindsightBackground()
  }

  /** 后台连接 Hindsight：探测 + 选 bank + 刷新 stats，完成后自动升/降级 mode。
   *  失败（未装 / 未起 / 超时）静默保持 local，不抛错、不阻塞。 */
  async _connectHindsightBackground() {
    try {
      const hs = await this.hindsight.init()
      if (hs) {
        this.mode = MODES.HYBRID
        this.log('hindsight overlay ready -> mode=hybrid')
      } else if (this.hindsight.base) {
        this.log('hindsight not ready, stay local (recheck will retry)')
      }
      await this.refreshStats()
    } catch (error) {
      this.log(`hindsight background probe failed, stay local: ${error.message}`)
    }
  }

  async close() {
    await this.local.close()
  }

  /**
   * 周期重探测 Hindsight，自动在 local / hybrid 之间升降级。
   * 通用化：覆盖「Hindsight 后启动」「分时段（夜晚才起 API）」「中途掉线重启」等场景，
   * 不依赖使用者的启动顺序。
   * @param {number} intervalMs 距上次重探测的最小间隔
   * @returns {boolean} 是否发生了模式翻转
   */
  async maybeRecheckHindsight(intervalMs = 30000) {
    const now = Date.now()
    if (now - this._lastRecheckAt < intervalMs) return false
    this._lastRecheckAt = now
    if (!this.hindsight.base) return false // 未配置 Hindsight，永远 local

    const res = await this.hindsight.recheck()
    const newMode = res.after ? MODES.HYBRID : MODES.LOCAL
    if (newMode !== this.mode) {
      const prev = this.mode
      this.mode = newMode
      this.log(`mode transition: ${prev} -> ${newMode}`)
      await this.refreshStats()
      return true
    }
    if (res.after) {
      // 仍 hybrid：刷新一下 stats，保持叠加数据新鲜
      await this.refreshStats()
    }
    return false
  }

  async refreshStats() {
    const local = await this.local.stats()
    const hs = await this.hindsight.stats()
    this.lastStats = {
      local: {
        nodes: num(local && local.nodes, 0),
        edges: num(local && local.edges, 0),
      },
      hindsight: hs ? {
        nodes: num(hs.total_nodes, 0),
        links: num(hs.total_links, 0),
        documents: num(hs.total_documents, 0),
      } : null,
    }
    return this.lastStats
  }

  async remember(input) { return this.local.remember(input) }
  async observe(input) { return this.local.observe(input) }
  async consolidate() { return this.local.consolidate() }
  async tick(opts) { return this.local.tick(opts) }
  async forget(id) { return this.local.forget(id) }

  /** 统一召回：Local 四臂为主；Hindsight 命中作为附加证据（可选叠加）。
   *  两侧**并发**请求（Promise.all），不再串行等待 —— 之前 Hindsight 慢时会把
   *  整体召回拖到它的超时（30s），本地明明 2460ms 就能出结果也得干等。
   *  现在整体耗时 = max(本地, Hindsight)，且 Hindsight 受 requestTimeoutMs 硬超时兜底。 */
  async recall(query, opts = {}) {
    // 本地是保底，必须成功；Hindsight 是增强，失败/超时都不阻塞主链路。
    const t0 = Date.now()
    const hindsightPromise = this.hindsight.available
      ? this._recallHindsightBounded(query)
      : Promise.resolve(null)

    const [local, hindsight] = await Promise.all([
      this.local.recallFragments(query, opts),
      hindsightPromise,
    ])
    // 补写 brain.recall_trace（fire-and-forget，失败静默）→ 恢复 hebb/prune 数据源
    try {
      this.traceWriter.write(query, hindsight, Date.now() - t0, local && local.fragments)
    } catch (e) {
      this.log(`[trace] write dispatch failed: ${e.message}`)
    }
    return { ...local, hindsight }
  }

  /** Hindsight 召回 + 硬超时：用独立的 hindsightRecallTimeoutMs（默认 3s）兜底，
   *  比通用 requestTimeoutMs（8s）更严 —— 外脑 3s 没回就降级纯本地，
   *  把对话首字延迟压住；同时覆盖 HindsightBackend.recall 内部的 30s 超时。 */
  async _recallHindsightBounded(query) {
    const ms = num(this.cfg.hindsightRecallTimeoutMs, 3000)
    let timer
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), ms)
      if (timer && timer.unref) timer.unref()
    })
    const task = this.hindsight.recall(query).catch(() => null)
    const winner = await Promise.race([task, timeout])
    clearTimeout(timer)
    return winner
  }

  async graph() {
    const local = await this.local.graph()
    const hindsight = this.hindsight.available ? await this.hindsight.graph() : { nodes: [], edges: [] }
    // 合并：本地在前，Hindsight 追加去重（Hindsight 层作为叠加数据源）
    const seen = new Set(local.nodes.map((n) => n.id))
    const hNodes = hindsight.nodes.filter((n) => !seen.has(n.id))
    const hEdges = hindsight.edges.filter((e) => e && e.source && e.target && !seen.has(e.id))
    return {
      nodes: [...local.nodes, ...hNodes],
      edges: [...local.edges, ...hEdges],
      rev: Date.now(),
      sources: { local: local.nodes.length, hindsight: hNodes.length },
    }
  }

  state() {
    return {
      mode: this.mode,
      hindsightAvailable: this.hindsight.available,
      bank: this.hindsight.bank || '',
      stats: this.lastStats,
      layerStats: this.local.layerStats(),
      version: this.cfg.version,
    }
  }
}

export default MemoryEngine
