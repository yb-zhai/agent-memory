/**
 * mirror-edges.mjs — 把 Hindsight 图的边导入本地 NebulaMemory。
 *
 * 背景：mirror-hindsight.mjs 只导了节点文本，没导边。结果本地 2.3 万节点只有几十条
 * hebbian 边，图扩散（1 跳/2 跳）几乎扩散不出去、星云只有种子亮。本脚本补上这一环。
 *
 * 类型映射（本地引擎只有 semantic / hebbian / explicit 三种边）：
 *   semantic  → semantic   （语义相似，直接对应）
 *   entity    → semantic   （共同提及同一实体，本质也是关联）
 *   temporal  → semantic   （时间相邻，本地无时间边概念，并入关联）
 *   caused_by → 不导入      （因果关系在本地没有对应语义，强行并入会制造假因果）
 *
 * 用法（在插件目录）：
 *   node scripts/mirror-edges.mjs
 *   HINDSIGHT_URL=http://127.0.0.1:8888 BANK=coding-agent::DSHN node scripts/mirror-edges.mjs
 *
 * 环境变量：
 *   HINDSIGHT_URL  Hindsight API（默认 http://127.0.0.1:8888）
 *   BANK           源 bank（默认 coding-agent::DSHN）
 *   DATA_DIR       本地记忆目录（默认 %DSH_HOME%/memory-nebula-data）
 *   PER_TYPE_LIMIT 每类最多取多少条边（默认 20000，即 Hindsight 单类上限）
 *   SKIP_EXISTING  设 1 跳过本地已有边的端点对（默认 1，增量友好）
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { NebulaMemory } = require('../memory/index.mjs')

const HINDSIGHT_URL = String(process.env.HINDSIGHT_URL || 'http://127.0.0.1:8888').replace(/\/+$/, '')
const BANK = String(process.env.BANK || 'coding-agent::DSHN')
const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(HOME, 'memory-nebula-data'))
const PER_TYPE_LIMIT = Math.max(100, Number(process.env.PER_TYPE_LIMIT) || 20000)
const SKIP_EXISTING = process.env.SKIP_EXISTING !== '0'

const bankPath = `/v1/default/banks/${encodeURIComponent(BANK)}`
const TYPES = ['experience', 'observation', 'world']

// Hindsight linkType -> 本地 edge kind；caused_by 明确不导入
const KIND_MAP = { semantic: 'semantic', entity: 'semantic', temporal: 'semantic' }

async function api(url, timeoutMs = 60000) {
  let lastErr
  for (let attempt = 0; attempt < 4; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
      return await res.json()
    } catch (e) {
      lastErr = e
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    } finally { clearTimeout(timer) }
  }
  throw lastErr
}

function countEdges() {
  try {
    const p = path.join(DATA_DIR, 'edges.jsonl')
    if (!fs.existsSync(p)) return 0
    return fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).length
  } catch { return 0 }
}

async function main() {
  console.log('=== Hindsight 边 → 本地图 ===')
  console.log(`源: ${HINDSIGHT_URL}${bankPath}`)
  console.log(`目标: ${DATA_DIR}`)
  console.log(`每类上限: ${PER_TYPE_LIMIT}  跳过已有: ${SKIP_EXISTING}`)

  const health = await api(`${HINDSIGHT_URL}/health`, 5000).catch(() => null)
  if (!health || (health.status !== 'healthy' && health.database !== 'connected')) {
    throw new Error('Hindsight API 不可用')
  }

  const mem = new NebulaMemory({ dir: DATA_DIR, log: () => {} })
  await mem.init()
  console.log(`本地载入: nodes=${mem.nodes.size} edges=${mem.edgeMap.size}`)

  // 关键：本地节点 id 是 NebulaMemory 重新生成的（如 mmwoxqyx），
  // Hindsight 边端点是 UUID，两者对不上。用节点 meta.hindsight_id 建反查表。
  const known = new Set(mem.nodes.keys())
  /** @type {Map<string,string>} hindsight_id -> local_id */
  const byHindsight = new Map()
  for (const [localId, node] of mem.nodes) {
    const hid = node && node.meta && node.meta.hindsight_id
    if (hid) byHindsight.set(String(hid), localId)
  }
  console.log(`可见节点 ${known.size}，其中带 hindsight_id 的 ${byHindsight.size}`)
  const existing = SKIP_EXISTING ? new Set(mem.edgeMap.keys()) : new Set()
  let added = 0, skippedMissing = 0, skippedDup = 0, skippedCaused = 0, failed = 0
  const started = Date.now()

  for (const type of TYPES) {
    let raw
    try {
      raw = await api(`${HINDSIGHT_URL}${bankPath}/graph?type=${encodeURIComponent(type)}&limit=${PER_TYPE_LIMIT}`)
    } catch (e) {
      console.warn(`  ${type} 拉取失败：${e.message}`)
      continue
    }
    const edges = Array.isArray(raw.edges) ? raw.edges : []
    let typeAdded = 0
    for (const item of edges) {
      const d = item && item.data
      if (!d || !d.source || !d.target) continue
      const linkType = String(d.linkType || 'semantic')
      if (linkType === 'caused_by') { skippedCaused++; continue }
      const kind = KIND_MAP[linkType] || 'semantic'
      // Hindsight UUID → 本地 id；任一端在本地不存在就跳过（镜像只导了这些节点）
      const aLocal = byHindsight.get(String(d.source))
      const bLocal = byHindsight.get(String(d.target))
      if (!aLocal || !bLocal || aLocal === bLocal) { skippedMissing++; continue }
      const [lo, hi] = aLocal < bLocal ? [aLocal, bLocal] : [bLocal, aLocal]
      const supKey = `${lo}\u0001${hi}`
      if (existing.has(supKey)) { skippedDup++; continue }
      try {
        await mem.link(aLocal, bLocal, Number(d.weight) || 1, { kind, source: 'hindsight-mirror' })
        existing.add(supKey)
        added++; typeAdded++
      } catch { failed++ }
    }
    console.log(`  ${type}: 边 ${edges.length} → 新增 ${typeAdded}（累计 ${added}）`)
  }

  await mem.close()
  console.log('=== 完成 ===')
  console.log(`新增 ${added} 条 · 跳过(端点缺失) ${skippedMissing} · 跳过(已存在) ${skippedDup} · 跳过(caused_by) ${skippedCaused} · 失败 ${failed}`)
  console.log(`本地 edges.jsonl 行数: ${countEdges()}`)
  console.log(`耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`)
  console.log('注：caused_by（因果）未导入——本地无对应语义，强行并入会制造假因果。')
}

main().catch((e) => { console.error('边导入失败:', e.message); process.exit(1) })
