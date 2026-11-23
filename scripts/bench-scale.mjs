/**
 * bench-scale.mjs — 超量规模压测（节点规模 + 文本长度两个维度）
 *
 * 测什么：
 *   A. 冷启动：加载 N 条记忆到索引就绪的耗时、RSS
 *   B. 召回延迟：固定查询集 × 分位数（短查询/长查询/未命中）
 *   C. 长文本召回：超长文档（1k~50k 字）的索引与命中耗时
 *   D. 内存边际：每万节点额外占用多少 RSS（规模曲线）
 *
 * 用法：
 *   node scripts/bench-scale.mjs <数据目录> [--label=100k]
 * 结果追加到 scripts/bench-scale-results.json
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)
const { NebulaMemory } = require(path.join(ROOT, 'memory', 'store.cjs'))

const args = process.argv.slice(2)
const DIR = args.find((a) => !a.startsWith('--'))
if (!DIR) { console.error('用法: node bench-scale.mjs <数据目录> [--label=xxx]'); process.exit(1) }
const LABEL = (args.find((a) => a.startsWith('--label=')) || '=unknown').split('=')[1]

const ITER = 30
const WARMUP = 5

const now = () => process.hrtime.bigint()
const ms = (t) => Number(process.hrtime.bigint() - t) / 1e6
const pct = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] }
const stats = (arr) => ({
  n: arr.length,
  mean: +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2),
  p50: +pct(arr, .5).toFixed(2),
  p90: +pct(arr, .9).toFixed(2),
  p99: +pct(arr, .99).toFixed(2),
  max: +Math.max(...arr).toFixed(2),
})

// 查询集：短/中/长/未命中（用合成词库里的高频词，保证多数能命中）
const QUERIES = {
  短查询: ['用户偏好', '容器报错', '记忆星云', '索引膨胀'],
  中查询: ['怎么解决容器报错的问题', '数据库迁移到 PostgreSQL 的步骤'],
  长查询: ['我们上周讨论过的那个关于记忆库索引膨胀和中文分词性能的方案最后选了哪个'],
  未命中: ['zzzqzwxec 完全不存在的超长无意义查询串'],
}

async function main() {
  const R = {
    label: LABEL,
    when: new Date().toISOString(),
    env: {
      cpu: os.cpus()[0].model,
      cores: os.cpus().length,
      ramGB: +(os.totalmem() / 1073741824).toFixed(1),
      node: process.version,
    },
    data: {},
    cold: {},
    recall: {},
    longText: {},
  }

  // 数据集信息
  const nf = path.join(DIR, 'nodes.jsonl')
  const ef = path.join(DIR, 'edges.jsonl')
  R.data = {
    nodesMB: fs.existsSync(nf) ? +(fs.statSync(nf).size / 1048576).toFixed(1) : 0,
    nodesLines: fs.existsSync(nf) ? countLines(nf) : 0,
    edgesMB: fs.existsSync(ef) ? +(fs.statSync(ef).size / 1048576).toFixed(1) : 0,
    edgesLines: fs.existsSync(ef) ? countLines(ef) : 0,
  }
  console.log(`[${LABEL}] 数据集: ${R.data.nodesLines.toLocaleString()} 行 / ${R.data.nodesMB} MB`)

  // A. 冷启动
  global.gc?.()
  const rssBefore = process.memoryUsage().rss / 1048576
  const t0 = now()
  const mem = new NebulaMemory({ dir: DIR, log: () => {} })
  await mem.init()
  const initMs = ms(t0)
  const rssAfter = process.memoryUsage().rss / 1048576
  R.cold = {
    initMs: +initMs.toFixed(0),
    nodes: mem.nodes.size,
    edges: mem.edgeMap.size,
    rssBeforeMB: +rssBefore.toFixed(0),
    rssAfterMB: +rssAfter.toFixed(0),
    rssDeltaMB: +(rssAfter - rssBefore).toFixed(0),
    msPerKNode: +(initMs / (mem.nodes.size / 1000)).toFixed(1),
    kbPerNode: +(((rssAfter - rssBefore) * 1024) / Math.max(1, mem.nodes.size)).toFixed(2),
  }
  console.log(`[${LABEL}] 冷启动: ${R.cold.initMs}ms  nodes=${R.cold.nodes.toLocaleString()}  RSS +${R.cold.rssDeltaMB}MB (${R.cold.kbPerNode} KB/节点)`)

  // B. 召回
  for (const [cat, qs] of Object.entries(QUERIES)) {
    const all = []
    const perQuery = {}
    for (const q of qs) {
      for (let i = 0; i < WARMUP; i++) await mem.recall(q, { limit: 6 })
      const arr = []
      let hits = 0
      for (let i = 0; i < ITER; i++) {
        const t = now()
        const r = await mem.recall(q, { limit: 6 })
        arr.push(ms(t))
        if (r.length) hits++
      }
      perQuery[q] = { ...stats(arr), hitRate: +(hits / ITER).toFixed(2) }
      all.push(...arr)
      await new Promise((r) => setTimeout(r, 20))
    }
    R.recall[cat] = { perQuery, pooled: stats(all) }
    console.log(`[${LABEL}] 召回·${cat}: p50=${R.recall[cat].pooled.p50}ms  p99=${R.recall[cat].pooled.p99}ms`)
  }

  // C. 长文本：找库里最长的几条，测召回命中它们的耗时
  const longest = [...mem.nodes.values()]
    .sort((a, b) => (b.text?.length || 0) - (a.text?.length || 0))
    .slice(0, 3)
  if (longest.length) {
    const arr = []
    for (let i = 0; i < 10; i++) {
      for (const node of longest) {
        const snippet = (node.text || '').slice(0, 40)   // 用长文开头当查询
        const t = now()
        await mem.recall(snippet, { limit: 6 })
        arr.push(ms(t))
      }
    }
    R.longText = {
      longestChars: longest.map((n) => n.text?.length || 0),
      recallByLongDocSnippet: stats(arr),
    }
    console.log(`[${LABEL}] 长文本召回: 最长 ${R.longText.longestChars[0].toLocaleString()} 字, p50=${R.longText.recallByLongDocSnippet.p50}ms`)
  }

  await mem.close()

  // 写入结果
  const outFile = path.join(HERE, 'bench-scale-results.json')
  let all = []
  if (fs.existsSync(outFile)) {
    try { all = JSON.parse(fs.readFileSync(outFile, 'utf8')) } catch { all = [] }
  }
  all = all.filter((x) => x.label !== LABEL)
  all.push(R)
  all.sort((a, b) => (a.cold.nodes || 0) - (b.cold.nodes || 0))
  fs.writeFileSync(outFile, JSON.stringify(all, null, 2))
  console.log(`\n结果已写入: ${outFile}`)
}

function countLines(f) {
  const buf = fs.readFileSync(f)
  let n = 0
  for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++
  if (buf.length && buf[buf.length - 1] !== 10) n++
  return n
}

main().catch((e) => { console.error(e); process.exit(1) })
