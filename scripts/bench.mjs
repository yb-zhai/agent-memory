/**
 * NebulaMemory 纯本地引擎 · 标准化基准（v2，针对当前最新版引擎）
 *
 * 口径：引擎层（store.cjs 直接调用），不含 HTTP / Hindsight / MCP 序列化（MCP 端到端单独测）。
 * 数据：真实库快照的**副本**（不触碰运行中的真实库；每次冷启动前重新拷贝，保证同一输入）。
 *
 * 阶段：
 *   A 环境 + 数据集快照
 *   B 冷启动 ×2（各自重新拷贝快照）
 *   C 热召回（原始未压缩库）：固定 8 条查询 ×（5 预热 + 30 测量），分位数统计
 *   D 写入 / 删除延迟（副本上）
 *   E close() 触发压缩 → 报告文件变化
 *   F 压缩后冷启动 + 再次召回（同查询集，前后对比）
 *   G 小库（新建 100 条）＝ namespace 新子库的规模与路径
 *   H MCP stdio 端到端（spawn mcp-server.mjs，20 次往返）
 *
 * 用法：node scripts/bench.mjs [数据目录]
 * 结果 JSON 写入 scripts/bench-results.json。
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { spawn } from 'node:child_process'

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)
const { NebulaMemory } = require(path.join(ROOT, 'memory', 'store.cjs'))

const LIVE_DIR = process.argv[2] || path.join(os.homedir(), '.dsh', 'memory-nebula-data')
const SB = path.join(os.tmpdir(), `nebula-bench-${Date.now()}`)
const ITER = 30          // 每查询测量次数
const WARMUP = 5         // 每查询预热次数
const COOL_MS = 1500     // 阶段间冷却

// 固定查询集：短口语 / 中等 / 长句 / 术语 / 必不命中 —— 写死保证可复现
const QUERIES = [
  '老板喝什么',
  '容器报错怎么解决',
  '记忆星云连线',
  'API 密钥',
  '用户偏好',
  '今天做了什么',
  '源码位于哪个目录 项目结构是什么样的 这周做了哪些改动',
  'zzzqzwxec 完全不存在的词',
]

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const now = () => process.hrtime.bigint()
const ms = (t) => Number(process.hrtime.bigint() - t) / 1e6

function pct(arr, q) {
  const s = arr.slice().sort((a, b) => a - b)
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))
  return s[i]
}
function stats(arr) {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length
  return {
    n: arr.length,
    mean: +mean.toFixed(2),
    p50: +pct(arr, .50).toFixed(2),
    p90: +pct(arr, .90).toFixed(2),
    p99: +pct(arr, .99).toFixed(2),
    min: +Math.min(...arr).toFixed(2),
    max: +Math.max(...arr).toFixed(2),
  }
}
function countLines(file) {
  const buf = fs.readFileSync(file)
  let n = 0
  for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++
  if (buf.length > 0 && buf[buf.length - 1] !== 10) n++
  return n
}
function snapshot() {
  for (const f of ['nodes.jsonl', 'edges.jsonl']) {
    fs.copyFileSync(path.join(LIVE_DIR, f), path.join(SB, f))
  }
}
const R = { startedAt: new Date().toISOString(), env: {}, dataset: {}, phases: {} }

async function coldInit(tag, { snapshot: doSnapshot = true } = {}) {
  if (doSnapshot) snapshot()       // 每次冷启动默认用同一份原始快照；压缩后对比阶段显式关闭
  const t = now()
  const mem = new NebulaMemory({ dir: SB, log: () => {} })
  await mem.init()
  const took = ms(t)
  const rss = process.memoryUsage().rss / 1048576
  const out = { tag, initMs: +took.toFixed(0), nodes: mem.nodes.size, edges: mem.edgeMap.size, rssMB: +rss.toFixed(0) }
  console.log(`[${tag}] init=${out.initMs}ms nodes=${out.nodes} edges=${out.edges} rss=${out.rssMB}MB`)
  return { mem, out }
}

async function recallBench(mem, tag) {
  const perQuery = {}
  const pooled = []
  for (const q of QUERIES) {
    for (let i = 0; i < WARMUP; i++) await mem.recall(q, { limit: 6 })
    const arr = []
    let hits = 0
    for (let i = 0; i < ITER; i++) {
      const t = now()
      const r = await mem.recall(q, { limit: 6 })
      arr.push(ms(t))
      if (r.length > 0) hits++
    }
    perQuery[q] = { ...stats(arr), hitRate: +(hits / ITER).toFixed(2) }
    pooled.push(...arr)
    console.log(`  [${tag}] "${q.slice(0, 16)}" p50=${perQuery[q].p50}ms p90=${perQuery[q].p90}ms hit=${perQuery[q].hitRate}`)
    await sleep(30)
  }
  const pooledStats = stats(pooled)
  console.log(`[${tag}] pooled p50=${pooledStats.p50} p90=${pooledStats.p90} p99=${pooledStats.p99} mean=${pooledStats.mean}ms`)
  return { perQuery, pooled: pooledStats }
}

async function main() {
  console.log(`sandbox=${SB}`)
  fs.mkdirSync(SB, { recursive: true })

  // ── A 环境 ──
  const cpu = os.cpus()[0]
  R.env = {
    cpu: `${cpu.model} @ ${cpu.speed}MHz`,
    cores: os.cpus().length,
    ramGB: +(os.totalmem() / 1073741824).toFixed(1),
    platform: `${os.platform()} ${os.release()}`,
    node: process.version,
  }
  console.log(`env: ${R.env.cpu} ×${R.env.cores} RAM=${R.env.ramGB}GB node=${R.env.node}`)

  // ── A 数据集快照（报告原始规模） ──
  snapshot()
  const nl = countLines(path.join(SB, 'nodes.jsonl'))
  R.dataset = {
    source: LIVE_DIR,
    nodesJsonlMB: +(fs.statSync(path.join(SB, 'nodes.jsonl')).size / 1048576).toFixed(1),
    nodesLines: nl,
    edgesJsonlMB: +(fs.statSync(path.join(SB, 'edges.jsonl')).size / 1048576).toFixed(1),
  }
  console.log(`dataset: nodes ${R.dataset.nodesJsonlMB}MB / ${nl} lines, edges ${R.dataset.edgesJsonlMB}MB`)

  // ── B 冷启动 ×2（C 轮召回挂第二次，输入=原始快照） ──
  const colds = []
  for (const tag of ['cold-1', 'cold-2']) {
    const { mem, out } = await coldInit(tag)
    colds.push(out)
    if (tag === 'cold-2') R.phases.recallRaw = await recallBench(mem, 'raw')
    await mem.close()
    await sleep(COOL_MS)
  }
  R.phases.coldInit = colds

  // ── D 写入 / 删除（重新拷贝原始快照再跑，保证同口径） ──
  {
    const { mem } = await coldInit('write-run')
    const wArr = []
    const ids = []
    for (let i = 0; i < 30; i++) {
      const t = now()
      const r = await mem.remember({ text: `基准测试写入第 ${i} 条：这条记忆用于测量写入延迟，包含分词与去重检查。` })
      wArr.push(ms(t))
      ids.push(r.id)
    }
    const fArr = []
    for (const id of ids.slice(0, 10)) {
      const t = now()
      await mem.forget(id)
      fArr.push(ms(t))
    }
    R.phases.write = { remember: stats(wArr), forget: stats(fArr) }
    console.log(`[write] remember p50=${R.phases.write.remember.p50}ms p99=${R.phases.write.remember.p99}ms; forget p50=${R.phases.write.forget.p50}ms`)

    // ── E 压缩（close 触发；此时库=原始快照+30 写入） ──
    const sizeBefore = fs.statSync(path.join(SB, 'nodes.jsonl')).size
    await mem.close()
    await sleep(COOL_MS)
    const sizeAfter = fs.statSync(path.join(SB, 'nodes.jsonl')).size
    const linesAfter = countLines(path.join(SB, 'nodes.jsonl'))
    R.phases.compaction = {
      beforeMB: +(sizeBefore / 1048576).toFixed(1),
      afterMB: +(sizeAfter / 1048576).toFixed(1),
      linesBefore: nl,
      linesAfter,
    }
    console.log(`[compaction] ${R.phases.compaction.beforeMB}MB → ${R.phases.compaction.afterMB}MB, lines ${nl} → ${linesAfter}`)

    // ── F 压缩后冷启动 + 召回对比（用压缩后的库，不重拷快照） ──
    const { mem: mem2, out: postCold } = await coldInit('cold-post-compact', { snapshot: false })
    R.phases.recallPostCompact = await recallBench(mem2, 'post-compact')
    R.phases.coldPostCompact = postCold
    await mem2.close()
    await sleep(COOL_MS)
  }

  // ── G 小库（等价于 namespace 新子库的规模与路径） ──
  {
    const smallDir = path.join(SB, 'small')
    fs.mkdirSync(smallDir, { recursive: true })
    const t = now()
    const mem = new NebulaMemory({ dir: smallDir, log: () => {} })
    await mem.init()
    const initMs = +ms(t).toFixed(1)
    const wArr = []
    for (let i = 0; i < 100; i++) {
      const t0 = now()
      await mem.remember({ text: `小库条目 ${i}：项目 ${i % 7} 的第 ${i} 号备忘，覆盖若干关键词如咖啡、报错、部署。` })
      wArr.push(ms(t0))
    }
    const recall = await recallBench(mem, 'small-100')
    R.phases.smallBank = { initMs, nodes: mem.nodes.size, write: stats(wArr), recall }
    await mem.close()
    console.log(`[small] init=${initMs}ms nodes=${mem.nodes.size} write p50=${R.phases.smallBank.write.p50}ms`)
  }

  // ── H MCP stdio 端到端（基于压缩后副本） ──
  {
    const child = spawn(process.execPath, [path.join(ROOT, 'mcp-server.mjs')], {
      env: { ...process.env, NEBULA_DATA_DIR: SB },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stderr.resume()   // 防止 stderr 堵塞
    const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n')
    const pending = new Map()
    let waiter = null
    child.stdout.on('data', (chunk) => {
      child._buf = (child._buf || '') + chunk.toString('utf8')
      let i
      while ((i = child._buf.indexOf('\n')) >= 0) {
        const line = child._buf.slice(0, i).trim()
        child._buf = child._buf.slice(i + 1)
        if (!line) continue
        try {
          const msg = JSON.parse(line)
          const res = pending.get(msg.id)
          if (res) { pending.delete(msg.id); res(msg) }
        } catch { /* 忽略坏行 */ }
      }
      if (waiter) { const w = waiter; waiter = null; w() }
    })
    const call = async (obj) => new Promise((res, rej) => {
      pending.set(obj.id, res)
      send(obj)
      setTimeout(() => { if (pending.has(obj.id)) { pending.delete(obj.id); rej(new Error('mcp timeout')) } }, 60000)
    })
    await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bench', version: '0' } } })
    const arr = []
    for (let i = 0; i < 20; i++) {
      const t = now()
      const resp = await call({ jsonrpc: '2.0', id: 100 + i, method: 'tools/call', params: { name: 'recall', arguments: { query: '记忆星云连线', limit: 6 } } })
      if (resp.error) throw new Error('mcp recall error: ' + JSON.stringify(resp.error))
      arr.push(ms(t))
      await sleep(20)
    }
    child.kill()
    R.phases.mcpStdio = { note: 'tools/call recall 往返，含 JSON-RPC 序列化与引擎调用（压缩后副本）', ...stats(arr) }
    console.log(`[mcp] p50=${R.phases.mcpStdio.p50}ms p90=${R.phases.mcpStdio.p90}ms mean=${R.phases.mcpStdio.mean}ms`)
  }

  fs.rmSync(SB, { recursive: true, force: true })
  const out = path.join(HERE, 'bench-results.json')
  fs.writeFileSync(out, JSON.stringify(R, null, 2))
  console.log(`RESULT_JSON=${out}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
