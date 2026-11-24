/**
 * mirror-hindsight.mjs — 把 Hindsight bank 的记忆镜像到本地 NebulaMemory JSONL。
 *
 * 目的：让"纯本地模式"（不跑 Hindsight）也有真实记忆可召回。
 * 这是**有损单向镜像**，不是双向同步：
 *   - 搬运：文本 / 类型 / 时间 / 标签 / 实体 / 原始 id
 *   - 不搬：Hindsight 的 84 万条边（temporal/entity/caused_by 在本地引擎没有对应类型；
 *           semantic 边含义与本地的 hebbian/explicit 不等价），导入后本地边为 0，
 *           本地引擎的 hebbian 边会在后续召回时按共现自然生长。
 *   - 导入后本地库是快照，不会自动跟随 Hindsight 后续写入；重跑本脚本可刷新（幂等去重）。
 *
 * 用法（在插件目录）：
 *   node scripts/mirror-hindsight.mjs
 *   HINDSIGHT_URL=http://127.0.0.1:8888 BANK=<你的 bank> \
 *   DATA_DIR=%DSH_HOME%/memory-nebula-data node scripts/mirror-hindsight.mjs
 *
 * 环境变量：
 *   HINDSIGHT_URL  Hindsight API（默认 http://127.0.0.1:8888）
 *   BANK           源 bank（必填，缺失时直接报错退出）
 *   DATA_DIR       本地记忆目录（默认 %DSH_HOME%/memory-nebula-data）
 *   BATCH          每批写入条数（默认 200）
 *   LIMIT          本次最多导入条数（默认 0=全部）
 *   START_OFFSET   从源的第几条开始（默认 0；用于断点续导）
 *   END_OFFSET     到源的第几条结束（默认 0=到 LIMIT/total）
 *   RESET          设 1 清空本地库后全量重建（默认 0=增量）
 *   NO_DEDUPE      设 1 跳过本地 tf-idf 去重（镜像场景强烈推荐：源 id 已唯一，
 *                  去重是 O(n²)，23800 条时极慢；默认 0 保留去重以兼容增量刷新）
 *
 * 断点续导（1.3.2+）：DATA_DIR 下会写 mirror-state.json 记录进度水位。
 *   崩溃/中断后重跑本脚本，若检测到「上次没导完」，自动从水位续导，
 *   无需手动记 START_OFFSET；重跑幂等（源 id 唯一 + 去重关闭）。
 *   显式传 START_OFFSET / RESET=1 会覆盖水位（按你的显式意图走）。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { NebulaMemory } = require('../memory/index.mjs')

const HINDSIGHT_URL = String(process.env.HINDSIGHT_URL || 'http://127.0.0.1:8888').replace(/\/+$/, '')
const BANK = String(process.env.BANK || '').trim()
if (!BANK) {
  // 不猜 bank：猜错会静默拉空数据，不如直接告诉用户要填什么
  console.error('缺少 BANK：请用环境变量指定要镜像的 bank，例如')
  console.error('  BANK=<你的 bank> node scripts/mirror-hindsight.mjs')
  process.exit(1)
}
const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(HOME, 'memory-nebula-data'))
const BATCH = Math.max(1, Number(process.env.BATCH) || 200)
const LIMIT = Math.max(0, Number(process.env.LIMIT) || 0)
const START_OFFSET = Math.max(0, Number(process.env.START_OFFSET) || 0)
const END_OFFSET = Math.max(0, Number(process.env.END_OFFSET) || 0)
const RESET = process.env.RESET === '1'
const NO_DEDUPE = process.env.NO_DEDUPE === '1'
const PAGE = 100

// 断点续导水位文件：记录上次导到哪、源总数、时间戳。
// 崩溃后重跑据此自动续导，消除「补偿窗口内重启漏数据」。
const STATE_FILE = path.join(DATA_DIR, 'mirror-state.json')
const readState = () => {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { return null }
}
const writeState = (s) => {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(s), 'utf8') } catch { /* 写失败不致命，最多重导一批 */ }
}
const clearState = () => {
  try { if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE) } catch { }
}

// Hindsight fact_type -> 本地 kind（本地只有 episode/fact/profile/note）
const KIND_MAP = {
  experience: 'episode',   // 经历 → 原始片段
  observation: 'note',     // 观察 → 笔记
  world: 'fact',           // 世界知识 → 事实
}
const IMPORTANCE = { episode: 0.55, note: 0.5, fact: 0.65 }

const bankPath = `/v1/default/banks/${encodeURIComponent(BANK)}`

async function api(url, timeoutMs = 20000) {
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
      if (attempt < 3) await new Promise(r => setTimeout(r, 800 * (attempt + 1)))
    } finally { clearTimeout(timer) }
  }
  throw lastErr
}

function parseDate(v) {
  const ms = Date.parse(v || '')
  return Number.isFinite(ms) ? ms : 0
}

function normalizeTags(item) {
  const out = []
  const raw = item.tags
  if (Array.isArray(raw)) out.push(...raw.map(String))
  else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) out.push(`${k}:${String(v)}`)
  }
  // entities 拼进标签（截断，避免超 MAX_TAGS）
  const ents = typeof item.entities === 'string' ? item.entities.split(/[,\s]+/) : (Array.isArray(item.entities) ? item.entities : [])
  for (const e of ents) if (e && e.trim()) out.push(`ent:${e.trim()}`)
  return out.slice(0, 16)
}

async function main() {
  console.log('=== Hindsight → 本地记忆镜像 ===')
  console.log(`源: ${HINDSIGHT_URL}${bankPath}`)
  console.log(`目标: ${DATA_DIR}`)
  console.log(`模式: ${RESET ? '全量重建(RESET=1)' : '增量'} · 去重: ${NO_DEDUPE ? '关闭(镜像推荐)' : '开启(tf-idf)'}`)

  // 健康检查
  const health = await api(`${HINDSIGHT_URL}/health`, 5000).catch(() => null)
  if (!health || (health.status !== 'healthy' && health.database !== 'connected')) {
    throw new Error('Hindsight API 不可用，无法镜像')
  }

  // 先取总数
  const first = await api(`${HINDSIGHT_URL}${bankPath}/memories/list?limit=1&offset=0`)
  const total = Number(first.total) || 0
  console.log(`源记忆总数: ${total}`)
  if (!total) { console.log('源库为空，退出'); return }

  // 准备本地引擎
  fs.mkdirSync(DATA_DIR, { recursive: true })
  if (RESET) {
    for (const f of ['nodes.jsonl', 'edges.jsonl', 'index.json', 'trace.jsonl']) {
      const p = path.join(DATA_DIR, f)
      if (fs.existsSync(p)) { fs.unlinkSync(p); console.log(`已删除 ${f}`) }
    }
  }
  const mem = new NebulaMemory({
    dir: DATA_DIR,
    // 镜像场景关掉 tf-idf 去重：源记忆 id 已唯一，去重 O(n²) 在 2 万条时极慢。
    // 用 RESET=1 全量重建保证幂等；普通 remember() 不受影响。
    dedupeThreshold: NO_DEDUPE ? 1.01 : 0.92,
    log: (m) => { if (process.env.VERBOSE) console.log('  ', m) },
  })
  await mem.init()
  const countNodes = () => {
    try {
      const p = path.join(DATA_DIR, 'nodes.jsonl')
      if (!fs.existsSync(p)) return 0
      return fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).length
    } catch { return 0 }
  }
  console.log(`本地镜像前: nodes=${countNodes()}`)

  const cap = LIMIT ? Math.min(total, LIMIT) : total
  const target = END_OFFSET ? Math.min(cap, END_OFFSET) : cap

  // 断点续导：优先取水位文件里的 offset；显式 START_OFFSET / RESET 覆盖水位。
  const prevState = readState()
  let startOffset = START_OFFSET
  if (RESET) {
    // 全量重建：清水位，从 0 开始
    clearState()
    startOffset = 0
  } else if (startOffset === 0 && prevState && Number(prevState.offset) > 0 && Number(prevState.offset) < total) {
    // 上次没导完（水位 < 源总数），自动从水位续导，无需手动 START_OFFSET
    startOffset = Number(prevState.offset)
    console.log(`检测到上次未完成（水位 ${startOffset}/${prevState.total}），自动续导`)
  }

  let ok = 0, deduped = 0, failed = 0, offset = startOffset
  if (offset >= target) { console.log(`起点 ${offset} ≥ 终点 ${target}，无需导入`); clearState(); await mem.close(); return }
  const started = Date.now()

  while (offset < target) {
    const limit = Math.min(PAGE, target - offset)
    const page = await api(`${HINDSIGHT_URL}${bankPath}/memories/list?limit=${limit}&offset=${offset}`)
    const items = Array.isArray(page.items) ? page.items : []
    if (!items.length) break
    for (const item of items) {
      const kind = KIND_MAP[item.fact_type] || 'episode'
      try {
        const r = await mem.remember({
          text: String(item.text || '').slice(0, 2000),
          kind,
          ts: parseDate(item.date) || parseDate(item.mentioned_at) || Date.now(),
          importance: IMPORTANCE[kind],
          tags: normalizeTags(item),
          source: `hindsight-mirror:${BANK}`,
          meta: { hindsight_id: item.id, hindsight_type: item.fact_type, document_id: item.document_id || '' },
        })
        if (r.deduped) deduped++
        else ok++
      } catch (e) {
        failed++
        if (failed <= 5) console.warn(`  跳过 ${item.id}: ${e.message}`)
      }
    }
    offset += items.length
    // 每导完一批就落盘水位（崩溃最多丢这一批 = PAGE 条，重跑幂等补回）
    writeState({ offset, total, target, bank: BANK, updatedAt: Date.now() })
    if (offset % (BATCH * PAGE) < PAGE || offset >= target) {
      console.log(`进度 ${offset}/${target} · 本地 nodes=${countNodes()} (新增${ok} 去重${deduped} 失败${failed})`)
    }
  }
  await mem.close()
  // 导完（或到达 target）清水位，标记本次完成
  clearState()

  console.log('=== 完成 ===')
  console.log(`处理 ${offset} 条：新增 ${ok}，去重 ${deduped}，失败 ${failed}`)
  console.log(`本地最终: nodes=${countNodes()}`)
  console.log(`耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`)
  console.log('注：Hindsight 的边未导入（类型不兼容）；本地 hebbian 边会在后续召回时自然生长。')
}

main().catch((e) => { console.error('镜像失败:', e.message); process.exit(1) })
