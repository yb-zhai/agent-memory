/**
 * eval-longmemeval.mjs — LongMemEval 基准 + 记忆新鲜度（写入→可召回）延迟测试
 *
 * 两套评测：
 *   A. 学术基准（LongMemEval oracle 500 题）
 *      - 把每题的证据会话写入记忆库
 *      - 用问题召回，判断是否命中 answer_session
 *      - 报告 Recall@k / MRR，按 question_type 分组
 *
 *   B. 记忆新鲜度（我们的独家指标）
 *      - 写入一条已知事实 → 每隔 N ms 尝试召回 → 记录首次召回成功的时间
 *      - 覆盖：本地引擎 / Hindsight（worker 开/关）
 *      - 这就是「auto 模式下新记忆多久能被召回」
 *
 * 用法：
 *   node scripts/eval-longmemeval.mjs --data=<path> --mode=local [--limit=100]
 *   node scripts/eval-longmemeval.mjs --freshness --mode=both
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const require = createRequire(import.meta.url)
const ROOT = 'E:/DSHN/build/DSH-memory-nebula'
const { NebulaMemory } = require(path.join(ROOT, 'memory', 'store.cjs'))

const args = process.argv.slice(2)
const opt = (n, d) => { const h = args.find(a => a.startsWith(`--${n}=`)); return h ? h.split('=')[1] : d }
const has = (n) => args.includes(`--${n}`)

const DATA_PATH = opt('data', 'D:/cache/temp/longmemeval_oracle.json')
const LIMIT = Number(opt('limit', 0))       // 0 = 全部
const K = Number(opt('k', 5))
const DO_FRESH = has('freshness')
const DO_BENCH = !DO_FRESH || has('bench')

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── LongMemEval 评测 ────────────────────────────────────────────────────────
async function evalLongMemEval() {
  if (!fs.existsSync(DATA_PATH)) {
    console.error(`数据集不存在: ${DATA_PATH}`)
    console.error('下载: python -c "import urllib.request;urllib.request.urlretrieve(\'https://hf-mirror.com/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_oracle.json\', \'D:/cache/temp/longmemeval_oracle.json\')"')
    return null
  }
  const all = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'))
  const items = LIMIT > 0 ? all.slice(0, LIMIT) : all
  console.log('='.repeat(64))
  console.log(`A. LongMemEval 基准（${items.length} / ${all.length} 题，Recall@${K}）`)
  console.log('='.repeat(64))

  const dir = path.join(os.tmpdir(), `lme-${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })

  const byType = {}
  let totalHit = 0, totalQ = 0
  let mrrSum = 0
  const t0global = Date.now()

  for (let qi = 0; qi < items.length; qi++) {
    const item = items[qi]
    // 每题独立库：只灌该题的 haystack（oracle 版的 3 个证据会话）
    const qdir = path.join(dir, `q${qi}`)
    fs.mkdirSync(qdir, { recursive: true })
    const mem = new NebulaMemory({ dir: qdir, log: () => {} })
    await mem.init()

    // 写入会话（每轮对话作为一条记忆，带 session id 便于判定）
    const sessIds = []
    for (let si = 0; si < item.haystack_sessions.length; si++) {
      const sid = item.haystack_session_ids[si]
      sessIds.push(sid)
      for (const turn of item.haystack_sessions[si]) {
        const text = `[${sid}] ${turn.role}: ${turn.content}`
        await mem.remember({ text, kind: 'episode', meta: { sessionId: sid, source: 'longmemeval' } })
      }
    }

    // 召回
    const hits = await mem.recall(item.question, { limit: K })
    // 判定：召回的文本里是否含答案会话的 id
    const answerSids = new Set(item.answer_session_ids || [])
    let rank = -1
    for (let i = 0; i < hits.length; i++) {
      const txt = hits[i].text || ''
      for (const sid of answerSids) {
        if (txt.includes(`[${sid}]`)) { rank = i + 1; break }
      }
      if (rank > 0) break
    }
    const hit = rank > 0
    if (hit) { totalHit++; mrrSum += 1 / rank }
    totalQ++

    const qt = item.question_type || 'unknown'
    byType[qt] = byType[qt] || { n: 0, hit: 0, mrr: 0 }
    byType[qt].n++
    if (hit) { byType[qt].hit++; byType[qt].mrr += 1 / rank }

    await mem.close()
    fs.rmSync(qdir, { recursive: true, force: true })

    if ((qi + 1) % 25 === 0) {
      const el = (Date.now() - t0global) / 1000
      process.stdout.write(`\r  进度 ${qi + 1}/${items.length}  (${el.toFixed(0)}s, 命中率 ${(totalHit / totalQ * 100).toFixed(1)}%)`)
    }
  }
  console.log()

  fs.rmSync(dir, { recursive: true, force: true })

  console.log('\n按题型：')
  console.log(`  ${'question_type'.padEnd(28)} ${'n'.padStart(4)} ${'Recall@K'.padStart(10)} ${'MRR'.padStart(8)}`)
  for (const [t, v] of Object.entries(byType).sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${t.padEnd(28)} ${String(v.n).padStart(4)} ${(v.hit / v.n * 100).toFixed(1).padStart(9)}% ${(v.mrr / v.n).toFixed(3).padStart(8)}`)
  }
  console.log(`\n  总体 Recall@${K}: ${(totalHit / totalQ * 100).toFixed(2)}%  (${totalHit}/${totalQ})`)
  console.log(`  总体 MRR:       ${(mrrSum / totalQ).toFixed(4)}`)
  console.log(`  耗时: ${((Date.now() - t0global) / 1000).toFixed(0)}s`)

  // byType 内部 mrr 为倒数和（用于打印），落盘前归一化为均值，
  // 否则 JSON 里存的 127.33 这类累加值无法直接使用
  const byTypeOut = {}
  for (const [t, v] of Object.entries(byType)) {
    byTypeOut[t] = { n: v.n, hit: v.hit, recall: v.hit / v.n, mrr: v.mrr / v.n }
  }
  return { total: totalQ, hit: totalHit, recall: totalHit / totalQ, mrr: mrrSum / totalQ, k: K, byType: byTypeOut }
}

// ── 记忆新鲜度：写入 → 可召回 延迟 ──────────────────────────────────────────
async function evalFreshness() {
  console.log('\n' + '='.repeat(64))
  console.log('B. 记忆新鲜度（写入 → 可召回，端到端延迟）')
  console.log('='.repeat(64))

  const dir = path.join(os.tmpdir(), `fresh-${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })
  const mem = new NebulaMemory({ dir, log: () => {} })
  await mem.init()

  const results = []
  // 3 轮：每轮写入一条带唯一 token 的事实，轮询何时可召回
  for (let round = 0; round < 3; round++) {
    const token = `ZQX${Date.now()}${round}`
    const fact = `用户的项目代号是 ${token}，这是一个唯一标识用于测试记忆新鲜度。`
    const tWrite = Date.now()
    await mem.remember({ text: fact })

    let firstHit = -1
    let attempts = 0
    const maxWait = 5000
    while (Date.now() - tWrite < maxWait) {
      attempts++
      const hits = await mem.recall(token, { limit: 5 })
      if (hits.length > 0 && hits.some(h => (h.text || '').includes(token))) {
        firstHit = Date.now() - tWrite
        break
      }
      await sleep(50)
    }
    results.push({ round, token, latencyMs: firstHit, attempts })
    console.log(`  轮 ${round + 1}: 写入后 ${firstHit >= 0 ? firstHit + 'ms' : `>${maxWait}ms（未召回）`} 可召回  (轮询 ${attempts} 次)`)
  }

  await mem.close()
  fs.rmSync(dir, { recursive: true, force: true })

  const valid = results.filter(r => r.latencyMs >= 0)
  if (valid.length) {
    const avg = valid.reduce((s, r) => s + r.latencyMs, 0) / valid.length
    console.log(`\n  本地引擎平均: ${avg.toFixed(0)}ms（${valid.length}/${results.length} 轮成功）`)
  }
  return { mode: 'local', results }
}

async function main() {
  const outFile = path.join(ROOT, 'scripts', 'eval-results.json')

  // 读回既有结果，避免只跑其中一项时把另一项覆盖成 null
  // （历史事故：跑 --freshness 曾把 bench 数据冲掉，导致报告数字无原始数据可核验）
  let prev = {}
  try { prev = JSON.parse(fs.readFileSync(outFile, 'utf8')) } catch { /* 首次运行 */ }

  const out = {
    when: new Date().toISOString(),
    bench: DO_BENCH ? null : (prev.bench || null),
    freshness: DO_FRESH ? null : (prev.freshness || null),
  }

  if (DO_BENCH) {
    out.bench = await evalLongMemEval()
  }
  if (DO_FRESH) {
    out.freshness = await evalFreshness()
  }

  fs.writeFileSync(outFile, JSON.stringify(out, null, 2))
  console.log(`\n结果: ${outFile}`)
  console.log(`  bench:     ${out.bench ? '已更新' : '保留旧值/为空'}`)
  console.log(`  freshness: ${out.freshness ? '已更新' : '保留旧值/为空'}`)
}

main().catch(e => { console.error(e); process.exit(1) })
