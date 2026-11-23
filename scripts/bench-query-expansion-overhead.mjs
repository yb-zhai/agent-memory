/**
 * bench-query-expansion-overhead.mjs — 查询扩展的 p50/p90 开销基准
 *
 * 背景：scripts/verify-optimization.mjs 里的性能段只跑 50 次 × 单轮，
 * 延迟噪声大（实测会出现「开启反而更快」）。本脚本用更稳的方法复测：
 *   - 每态预热后采样 N 次
 *   - 交替跑 R 轮（ON/OFF 轮换），抵消机器负载漂移
 *   - 报告每轮分位数 + 中位数汇总
 *
 * 用法：
 *   node scripts/bench-query-expansion-overhead.mjs [--rounds=5] [--samples=200] [--nodes=500]
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const { NebulaMemory } = require(path.join(ROOT, 'memory', 'store.cjs'))

const args = process.argv.slice(2)
const opt = (n, d) => { const h = args.find(a => a.startsWith(`--${n}=`)); return h ? h.split('=')[1] : d }
const ROUNDS = Number(opt('rounds', 5))
const SAMPLES = Number(opt('samples', 200))
const NODES = Number(opt('nodes', 500))

const QUERY = '数据库服务器配置问题怎么解决'
const OFF = { expandSynonyms: false, fixTypos: false, profileBoost: false }

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neb-perf-'))
  const mem = new NebulaMemory({ dir, log: () => {} })
  await mem.init()
  for (let i = 0; i < NODES; i++) {
    await mem.remember({ text: `记忆条目 ${i} 包含一些常见词汇如数据库服务器配置` })
  }

  const sample = async (opts) => {
    const t = process.hrtime.bigint()
    await mem.recall(QUERY, { limit: 6, ...opts })
    return Number(process.hrtime.bigint() - t) / 1e6
  }

  // 预热：让 JIT 与索引热起来，两侧各热一次
  for (let i = 0; i < 50; i++) { await sample(OFF); await sample({}) }

  const results = []
  for (let r = 0; r < ROUNDS; r++) {
    // 交替顺序：偶数轮先 OFF、奇数轮先 ON，抵消顺序效应
    const order = r % 2 === 0 ? ['off', 'on'] : ['on', 'off']
    const row = { round: r + 1 }
    for (const which of order) {
      const opts = which === 'off' ? OFF : {}
      const arr = []
      for (let i = 0; i < SAMPLES; i++) arr.push(await sample(opts))
      arr.sort((a, b) => a - b)
      row[which] = { p50: pct(arr, 0.5), p90: pct(arr, 0.9), p99: pct(arr, 0.99), mean: arr.reduce((s, x) => s + x, 0) / arr.length }
    }
    results.push(row)
  }

  console.log('\n' + '='.repeat(78))
  console.log(`查询扩展开销基准  (${ROUNDS} 轮 × ${SAMPLES} 次/态, 库 ${NODES} 条)`)
  console.log('='.repeat(78))
  console.log(`  ${'轮'.padEnd(4)} ${'OFF p50'.padStart(10)} ${'ON p50'.padStart(10)} ${'Δp50'.padStart(9)} ${'OFF p90'.padStart(10)} ${'ON p90'.padStart(10)} ${'Δp90'.padStart(9)}`)
  for (const r of results) {
    console.log(`  ${String(r.round).padEnd(4)} ${r.off.p50.toFixed(2).padStart(10)} ${r.on.p50.toFixed(2).padStart(10)} ${(r.on.p50 - r.off.p50).toFixed(2).padStart(9)} ${r.off.p90.toFixed(2).padStart(10)} ${r.on.p90.toFixed(2).padStart(10)} ${(r.on.p90 - r.off.p90).toFixed(2).padStart(9)}`)
  }

  const med = (key, field) => {
    const a = results.map(r => r[key][field]).sort((x, y) => x - y)
    return a[Math.floor(a.length / 2)]
  }
  const offP50 = med('off', 'p50'), onP50 = med('on', 'p50')
  const offP90 = med('off', 'p90'), onP90 = med('on', 'p90')
  const dP50 = onP50 - offP50, dP90 = onP90 - offP90

  console.log('\n' + '-'.repeat(78))
  console.log(`  中位数汇总（${ROUNDS} 轮）：`)
  console.log(`    扩展关闭  p50=${offP50.toFixed(2)}ms  p90=${offP90.toFixed(2)}ms`)
  console.log(`    扩展开启  p50=${onP50.toFixed(2)}ms  p90=${onP90.toFixed(2)}ms`)
  console.log(`    开销      p50=${dP50 >= 0 ? '+' : ''}${dP50.toFixed(2)}ms (${(dP50 / offP50 * 100).toFixed(0)}%)  p90=${dP90 >= 0 ? '+' : ''}${dP90.toFixed(2)}ms`)
  console.log('='.repeat(78))

  const out = {
    when: new Date().toISOString(),
    config: { rounds: ROUNDS, samples: SAMPLES, nodes: NODES, query: QUERY },
    perRound: results,
    summary: {
      off: { p50: +offP50.toFixed(3), p90: +offP90.toFixed(3) },
      on: { p50: +onP50.toFixed(3), p90: +onP90.toFixed(3) },
      overhead: { p50: +dP50.toFixed(3), p90: +dP90.toFixed(3), pct50: +(dP50 / offP50 * 100).toFixed(1) },
    },
  }
  const outFile = path.join(ROOT, 'scripts', 'expansion-overhead-results.json')
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2))
  console.log(`\n结果: ${outFile}`)

  await mem.close()
  fs.rmSync(dir, { recursive: true, force: true })
}

main().catch(e => { console.error(e); process.exit(1) })
