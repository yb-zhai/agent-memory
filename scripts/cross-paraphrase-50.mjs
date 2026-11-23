/**
 * cross-paraphrase-50.mjs — 跨表述召回测试（50 题，含错别字场景）
 * 对比开关扩展前后的召回率。
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const require = createRequire(import.meta.url)
const { NebulaMemory } = require('E:/DSHN/build/DSH-memory-nebula/memory/store.cjs')

// 10 条基础事实
const FACTS = {
  A: '邯郸永年县有一家铸造厂，是我们最大的铸件客户，年产三万吨。',
  B: '周末在家用 V60 手冲，埃塞俄比亚耶加雪菲，水温 92 度。',
  C: '服务器的 PostgreSQL 端口被占了，改成 5434 才正常。',
  D: '小朋友今年上二年级，在实验小学，喜欢恐龙和乐高。',
  E: '下周三要交季度报表给财务部张经理，需要提前准备。',
  F: '项目用 Docker Compose 部署，不用 K8s，因为团队规模小。',
  G: '数据库密码放在 1Password 的「工作」保险库里。',
  H: '团队的代码规范是先写测试再提交 PR，不接受直接推主干。',
  I: '老板喜欢喝冰美式，不加糖，每天早上九点一杯。',
  J: '公司的服务器机房在杭州，有 12 台机器。',
}

// 50 题：(query, 期望命中的事实 key, 难度)
const CASES = [
  // near（词面重叠）15 题
  ['邯郸那个铸造厂年产多少？', 'A', 'near'],
  ['手冲咖啡用多少度水温？', 'B', 'near'],
  ['PostgreSQL 改成了哪个端口？', 'C', 'near'],
  ['孩子在哪个学校上学？', 'D', 'near'],
  ['报表交给谁？', 'E', 'near'],
  ['项目用的什么部署方式？', 'F', 'near'],
  ['密码存在哪个工具？', 'G', 'near'],
  ['提交代码前要先做什么？', 'H', 'near'],
  ['老板喝什么咖啡？', 'I', 'near'],
  ['服务器机房在哪？', 'J', 'near'],
  ['铸造厂是做什么的？', 'A', 'near'],
  ['耶加雪菲怎么冲的？', 'B', 'near'],
  ['5434 是干什么的？', 'C', 'near'],
  ['实验小学是哪个孩子的学校？', 'D', 'near'],
  ['张经理要什么？', 'E', 'near'],

  // mid（同义/上下位）15 题
  ['我们最大的供应商是哪家？', 'A', 'mid'],
  ['我周末有什么放松方式？', 'B', 'mid'],
  ['上次那个数据库问题怎么解决的？', 'C', 'mid'],
  ['我孩子有什么爱好？', 'D', 'mid'],
  ['最近有什么要赶的事情？', 'E', 'mid'],
  ['为什么没用容器编排平台？', 'F', 'mid'],
  ['重要凭据怎么保管的？', 'G', 'mid'],
  ['我们对代码质量有什么要求？', 'H', 'mid'],
  ['我老板有什么习惯？', 'I', 'mid'],
  ['我们的机器放在哪？', 'J', 'mid'],
  ['那家工厂年产量？', 'A', 'mid'],
  ['我喝咖啡有什么讲究？', 'B', 'mid'],
  ['端口冲突那次怎么修的？', 'C', 'mid'],
  ['小朋友喜欢玩什么？', 'D', 'mid'],
  ['这个季度的财务报表？', 'E', 'mid'],

  // far（纯语义，无词面重叠）12 题
  ['上次那个铸件的客户是哪家？', 'A', 'far'],
  ['我平时喝咖啡有什么讲究？', 'B', 'far'],
  ['数据库连不上那次是怎么修的？', 'C', 'far'],
  ['我孩子多大了？', 'D', 'far'],
  ['我们怎么上线服务的？', 'F', 'far'],
  ['我账号密码放在哪来着？', 'G', 'far'],
  ['代码怎么才能合进去？', 'H', 'far'],
  ['早上喝的那个不加糖的是什么？', 'I', 'far'],
  ['算力设施放在哪里？', 'J', 'far'],
  ['铸件生意做得怎么样？', 'A', 'far'],
  ['那个饮品需要什么条件？', 'B', 'far'],
  ['连接失败怎么处理？', 'C', 'far'],

  // typo（拼音错别字）8 题
  ['铸造厂的那个客户是谁？', 'A', 'typo'],
  ['重要秘钥怎么保管的？', 'G', 'typo'],
  ['数据库布署在哪台服物器？', 'F', 'typo'],
  ['经里说要交报高', 'E', 'typo'],
  ['项目因该下周上线', 'F', 'typo'],
  ['系统已经重起了吗', 'C', 'typo'],
  ['那个数剧库的问题', 'C', 'typo'],
  ['手充咖啡用什么水温？', 'B', 'typo'],
]

const SB = path.join(os.tmpdir(), `xp50-${Date.now()}`)
fs.mkdirSync(SB, { recursive: true })

const rankOf = (hits, factText, limit = 20) => {
  for (let i = 0; i < Math.min(hits.length, limit); i++) {
    if ((hits[i].text || '') === factText) return i + 1
  }
  return 0
}

async function run(expand) {
  const dir = path.join(SB, expand ? 'on' : 'off')
  fs.mkdirSync(dir, { recursive: true })
  const mem = new NebulaMemory({ dir, log: () => {} })
  await mem.init()
  for (const k of Object.keys(FACTS)) await mem.remember({ text: FACTS[k], kind: 'fact' })

  const byDiff = { near: [], mid: [], far: [], typo: [] }
  for (const [query, key, diff] of CASES) {
    const hits = await mem.recall(query, {
      limit: 20,
      expandSynonyms: expand,
      fixTypos: expand,
      profileBoost: expand,
    })
    const r = rankOf(hits, FACTS[key], 20)
    byDiff[diff].push(r)
  }
  await mem.close()
  return byDiff
}

function summarize(label, byDiff) {
  console.log(`\n${label}`)
  console.log(`  ${'难度'.padEnd(6)} ${'n'.padStart(3)} ${'命中'.padStart(5)} ${'Recall'.padStart(9)} ${'MRR'.padStart(8)}`)
  let tn = 0, th = 0, tm = 0
  for (const d of ['near', 'mid', 'far', 'typo']) {
    const ranks = byDiff[d]
    const n = ranks.length
    if (!n) continue
    const hit = ranks.filter(x => x > 0).length
    const mrr = ranks.filter(x => x > 0).reduce((s, x) => s + 1 / x, 0) / n
    tn += n; th += hit; tm += ranks.filter(x => x > 0).reduce((s, x) => s + 1 / x, 0)
    console.log(`  ${d.padEnd(6)} ${String(n).padStart(3)} ${String(hit).padStart(5)} ${(hit / n * 100).toFixed(1).padStart(8)}% ${mrr.toFixed(3).padStart(8)}`)
  }
  console.log(`  ${'总体'.padEnd(6)} ${String(tn).padStart(3)} ${String(th).padStart(5)} ${(th / tn * 100).toFixed(1).padStart(8)}% ${(tm / tn).toFixed(3).padStart(8)}`)
  return { total: tn, hit: th, recall: th / tn, mrr: tm / tn, byDiff }
}

async function main() {
  console.log('='.repeat(70))
  console.log(`跨表述召回测试 · 50 题（10 条事实，Recall@20）`)
  console.log('='.repeat(70))

  const off = await run(false)
  const sOff = summarize('【扩展关闭】', off)

  const on = await run(true)
  const sOn = summarize('【扩展开启：纠错+同义+画像】', on)

  console.log('\n' + '='.repeat(70))
  console.log('提升对比')
  console.log('='.repeat(70))
  console.log(`  ${'难度'.padEnd(6)} ${'关闭'.padStart(10)} ${'开启'.padStart(10)} ${'提升'.padStart(10)}`)
  for (const d of ['near', 'mid', 'far', 'typo']) {
    const a = off[d], b = on[d]
    const ra = a.filter(x => x > 0).length / a.length * 100
    const rb = b.filter(x => x > 0).length / b.length * 100
    const delta = rb - ra
    console.log(`  ${d.padEnd(6)} ${ra.toFixed(1).padStart(9)}% ${rb.toFixed(1).padStart(9)}% ${(delta >= 0 ? '+' : '') + delta.toFixed(1).padStart(9)}%`)
  }
  console.log(`  ${'总体'.padEnd(6)} ${sOff.recall * 100 | 0}%`.padEnd(30) + ` ${(sOn.recall * 100).toFixed(1)}%`)

  fs.rmSync(SB, { recursive: true, force: true })

  const out = {
    when: new Date().toISOString(),
    cases: CASES.length,
    off: { total: sOff.total, hit: sOff.hit, recall: sOff.recall, mrr: sOff.mrr,
           byDiff: Object.fromEntries(Object.entries(off).map(([k, v]) => [k, { n: v.length, hit: v.filter(x => x > 0).length }])) },
    on: { total: sOn.total, hit: sOn.hit, recall: sOn.recall, mrr: sOn.mrr,
          byDiff: Object.fromEntries(Object.entries(on).map(([k, v]) => [k, { n: v.length, hit: v.filter(x => x > 0).length }])) },
  }
  const p = 'E:/DSHN/build/DSH-memory-nebula/scripts/cross-50-results.json'
  fs.writeFileSync(p, JSON.stringify(out, null, 2))
  console.log(`\n结果: ${p}`)
}

main().catch(e => { console.error(e); process.exit(1) })
