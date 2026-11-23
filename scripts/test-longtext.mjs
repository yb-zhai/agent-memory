/**
 * test-longtext.mjs — 长文本写入实测 + 超级节点图扩散实测
 *
 * 测什么：
 *   A. 不同长度文本的 remember 耗时（含分词/抽取/索引）
 *   B. 截断行为验证（MAX_TEXT=2000 是否静默丢失）
 *   C. 超级节点：5000 度节点的 1/2 跳扩散耗时
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const require = createRequire(import.meta.url)
const ROOT = 'E:/DSHN/build/DSH-memory-nebula'
const { NebulaMemory } = require(path.join(ROOT, 'memory', 'store.cjs'))

const now = () => process.hrtime.bigint()
const ms = (t) => Number(process.hrtime.bigint() - t) / 1e6
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] }
const st = (a) => ({ n: a.length, p50: +pct(a, .5).toFixed(2), p90: +pct(a, .9).toFixed(2), max: +Math.max(...a).toFixed(2) })

const SENT = ['用户偏好手冲咖啡并且喜欢在深夜写代码时喝。', '容器报错的解决方法通常是重启服务并检查日志输出。', '记忆星云面板使用四臂召回算法进行本地检索。', '数据库迁移到 PostgreSQL 需要先做冷备份。', '索引膨胀会导致查询变慢需要定期压缩。']
function makeText(chars) {
  let s = ''
  let i = 0
  while (s.length < chars) s += SENT[i++ % SENT.length]
  return s.slice(0, chars)
}

const SB = path.join(os.tmpdir(), `nebula-longtext-${Date.now()}`)
fs.mkdirSync(SB, { recursive: true })

async function main() {
  const mem = new NebulaMemory({ dir: SB, log: () => {} })
  await mem.init()

  console.log('='.repeat(58))
  console.log('A. 长文本 remember 耗时（每次新建库，避免去重干扰）')
  console.log('='.repeat(58))
  const LENS = [100, 500, 1000, 2000, 5000, 20000, 50000]
  const results = []
  for (const len of LENS) {
    const dir = path.join(SB, `len-${len}`)
    fs.mkdirSync(dir, { recursive: true })
    const m = new NebulaMemory({ dir, log: () => {} })
    await m.init()
    const text = makeText(len)
    const arr = []
    let storedLen = 0
    for (let i = 0; i < 10; i++) {
      const t = now()
      const r = await m.remember({ text: text + ` [${i}]` })   // 加序号避免去重
      arr.push(ms(t))
      storedLen = r.node?.text?.length || 0
    }
    const s = st(arr)
    results.push({ inputChars: len, storedChars: storedLen, ...s })
    console.log(`  输入 ${String(len).padStart(6)} 字 → 存入 ${String(storedLen).padStart(6)} 字 | p50=${String(s.p50).padStart(7)}ms  p90=${String(s.p90).padStart(7)}ms  max=${String(s.max).padStart(7)}ms`)
    await m.close()
  }

  console.log()
  console.log('='.repeat(58))
  console.log('B. 截断行为（MAX_TEXT 上限）')
  console.log('='.repeat(58))
  const truncated = results.filter((r) => r.storedChars < r.inputChars)
  if (truncated.length) {
    for (const r of truncated) {
      const lost = ((r.inputChars - r.storedChars) / r.inputChars * 100).toFixed(1)
      console.log(`  ⚠️  输入 ${r.inputChars} 字 → 实际只存 ${r.storedChars} 字（丢失 ${lost}%）`)
    }
    console.log('  → 确认存在静默截断，需要改为自动切块')
  } else {
    console.log('  未发现截断')
  }

  console.log()
  console.log('='.repeat(58))
  console.log('C. 超级节点图扩散实测')
  console.log('='.repeat(58))
  // 造 1 个超级节点 + 5000 个邻居，全连边
  const dir = path.join(SB, 'supernode')
  fs.mkdirSync(dir, { recursive: true })
  const m2 = new NebulaMemory({ dir, log: () => {} })
  await m2.init()
  console.log('  造图：1 个枢纽节点 + 5000 个带独特关键词的邻居 ...')
  const hub = await m2.remember({ text: '核心枢纽节点 系统架构总览' })
  const neighborIds = []
  for (let i = 0; i < 5000; i++) {
    const r = await m2.remember({ text: `邻居节点 ${i} 独特词 uq${i} 系统相关` })
    neighborIds.push(r.id)
    if ((i + 1) % 1000 === 0) process.stdout.write(`\r    ${i + 1}/5000`)
  }
  console.log()
  for (const nid of neighborIds) {
    m2._addEdge(hub.id, nid, 0.5 + Math.random() * 0.5, { kind: 'hebbian' })
  }
  const deg = (() => { let c = 0; for (const e of m2.edgeMap.values()) if (e.a === hub.id || e.b === hub.id) c++; return c })()
  console.log(`  枢纽度数为 ${deg}，总节点 ${m2.nodes.size}`)

  // 查询会命中枢纽 → 触发大扇出
  const queries = ['系统架构', 'uq1234', 'uq4999']
  for (const q of queries) {
    const arr = []
    let frags = 0
    for (let i = 0; i < 15; i++) {
      const t = now()
      const r = await m2.recall(q, { limit: 8 })
      arr.push(ms(t))
      frags = r.length
    }
    const s = st(arr)
    console.log(`  查询 "${q}" (命中 ${frags} 条) | p50=${s.p50}ms  p90=${s.p90}ms  max=${s.max}ms`)
  }

  // 对照：小度数图
  console.log('\n  对照组：无超级节点的小库 ...')
  const dir2 = path.join(SB, 'normal')
  fs.mkdirSync(dir2, { recursive: true })
  const m3 = new NebulaMemory({ dir: dir2, log: () => {} })
  await m3.init()
  for (let i = 0; i < 500; i++) await m3.remember({ text: `普通节点 ${i} 独特词 nq${i} 系统相关` })
  const base = []
  for (let i = 0; i < 15; i++) {
    const t = now()
    await m3.recall('系统架构', { limit: 8 })
    base.push(ms(t))
  }
  const bs = st(base)
  console.log(`  查询 "系统架构" | p50=${bs.p50}ms  p90=${bs.p90}ms`)

  await mem.close(); await m2.close(); await m3.close()

  const out = path.join(ROOT, 'scripts', 'longtext-results.json')
  fs.writeFileSync(out, JSON.stringify({ lens: results, supernode: { degree: deg, queries: queries.map((q) => st([0])) }, normal: bs }, null, 2))
  console.log(`\n结果: ${out}`)
  fs.rmSync(SB, { recursive: true, force: true })
}

main().catch((e) => { console.error(e); process.exit(1) })
