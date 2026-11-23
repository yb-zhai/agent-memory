/**
 * cross-paraphrase-local.mjs — 跨表述语义召回测试 · 本地引擎（与 Hindsight 同题对比）
 * 题库与 cross-paraphrase.py 完全一致。
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const require = createRequire(import.meta.url)
const { NebulaMemory } = require('E:/DSHN/build/DSH-memory-nebula/memory/store.cjs')

const CASES = [
  // near
  ["邯郸永年县有一家铸造厂，是我们最大的铸件客户，年产三万吨。", "邯郸那个铸造厂年产多少？", "三万吨", "near"],
  ["周末在家用 V60 手冲，埃塞俄比亚耶加雪菲，水温 92 度。", "手冲咖啡用多少度水温？", "92", "near"],
  ["服务器的 PostgreSQL 端口被占了，改成 5434 才正常。", "PostgreSQL 改成了哪个端口？", "5434", "near"],
  ["小朋友今年上二年级，在实验小学，喜欢恐龙和乐高。", "孩子在哪个学校上学？", "实验小学", "near"],
  ["下周三要交季度报表给财务部张经理。", "报表交给谁？", "张经理", "near"],
  ["项目用 Docker Compose 部署，不用 K8s。", "项目用的什么部署方式？", "Docker", "near"],
  ["数据库密码放在 1Password 的「工作」保险库里。", "密码存在哪个工具？", "1Password", "near"],
  ["团队的代码规范是先写测试再提交 PR。", "提交代码前要先做什么？", "测试", "near"],
  // mid
  ["邯郸永年县有一家铸造厂，是我们最大的铸件客户，年产三万吨。", "我们最大的供应商是哪家？", "铸造厂", "mid"],
  ["周末在家用 V60 手冲，埃塞俄比亚耶加雪菲，水温 92 度。", "我周末有什么放松方式？", "手冲", "mid"],
  ["服务器的 PostgreSQL 端口被占了，改成 5434 才正常。", "上次那个数据库问题怎么解决的？", "5434", "mid"],
  ["小朋友今年上二年级，在实验小学，喜欢恐龙和乐高。", "我孩子有什么爱好？", "恐龙", "mid"],
  ["下周三要交季度报表给财务部张经理。", "最近有什么要赶的事情？", "报表", "mid"],
  ["项目用 Docker Compose 部署，不用 K8s。", "为什么没用容器编排平台？", "K8s", "mid"],
  ["数据库密码放在 1Password 的「工作」保险库里。", "重要凭据怎么保管的？", "1Password", "mid"],
  ["团队的代码规范是先写测试再提交 PR。", "我们对代码质量有什么要求？", "测试", "mid"],
  // far
  ["邯郸永年县有一家铸造厂，是我们最大的铸件客户，年产三万吨。", "上次那个铸件的客户是哪家？", "铸造厂", "far"],
  ["周末在家用 V60 手冲，埃塞俄比亚耶加雪菲，水温 92 度。", "我平时喝咖啡有什么讲究？", "手冲", "far"],
  ["服务器的 PostgreSQL 端口被占了，改成 5434 才正常。", "数据库连不上那次是怎么修的？", "5434", "far"],
  ["小朋友今年上二年级，在实验小学，喜欢恐龙和乐高。", "我孩子多大了？", "二年级", "far"],
  ["项目用 Docker Compose 部署，不用 K8s。", "我们怎么上线服务的？", "Docker", "far"],
  ["数据库密码放在 1Password 的「工作」保险库里。", "我账号密码放在哪来着？", "1Password", "far"],
]

const SB = path.join(os.tmpdir(), `xp-local-${Date.now()}`)
fs.mkdirSync(SB, { recursive: true })

const rankOf = (hits, needle, limit = 20) => {
  for (let i = 0; i < Math.min(hits.length, limit); i++) {
    if ((hits[i].text || '').includes(needle)) return i + 1
  }
  return 0
}

async function main() {
  console.log('='.repeat(70))
  console.log('跨表述语义召回测试 · 本地引擎')
  console.log('='.repeat(70))

  const mem = new NebulaMemory({ dir: SB, log: () => {} })
  await mem.init()

  // 去重写入
  const facts = [...new Set(CASES.map(c => c[0]))]
  console.log(`\n[1/2] 写入 ${facts.length} 条事实 ...`)
  for (const f of facts) {
    await mem.remember({ text: f })
    console.log(`  ✅ ${f.slice(0, 32)}`)
  }

  console.log(`\n[2/2] 逐题召回（${CASES.length} 题）...`)
  const byDiff = { near: [], mid: [], far: [] }
  const results = []
  for (const [fact, query, needle, diff] of CASES) {
    const hits = await mem.recall(query, { limit: 20 })
    const r = rankOf(hits, needle, 20)
    byDiff[diff].push(r)
    results.push({ query, needle, diff, rank: r })
    console.log(`  ${r ? '✅' : '❌'} [${diff.padEnd(4)}] ${query.slice(0, 26).padEnd(28)} ${r ? 'rank=' + r : '未中'}`)
  }

  await mem.close()
  fs.rmSync(SB, { recursive: true, force: true })

  console.log('\n' + '='.repeat(70))
  console.log('汇总（Recall@20 / MRR）')
  console.log('='.repeat(70))
  console.log(`  ${'难度'.padEnd(8)} ${'n'.padStart(3)} ${'命中'.padStart(5)} ${'Recall'.padStart(8)} ${'MRR'.padStart(8)}`)
  let tn = 0, th = 0, tm = 0
  for (const d of ['near', 'mid', 'far']) {
    const ranks = byDiff[d]
    const n = ranks.length
    const hit = ranks.filter(x => x > 0).length
    const mrr = ranks.filter(x => x > 0).reduce((s, x) => s + 1 / x, 0) / n
    tn += n; th += hit; tm += ranks.filter(x => x > 0).reduce((s, x) => s + 1 / x, 0)
    console.log(`  ${d.padEnd(8)} ${String(n).padStart(3)} ${String(hit).padStart(5)} ${(hit / n * 100).toFixed(1).padStart(7)}% ${mrr.toFixed(3).padStart(8)}`)
  }
  console.log(`  ${'总体'.padEnd(8)} ${String(tn).padStart(3)} ${String(th).padStart(5)} ${(th / tn * 100).toFixed(1).padStart(7)}% ${(tm / tn).toFixed(3).padStart(8)}`)

  const out = {
    when: new Date().toISOString(), engine: 'local', results,
    summary: { near: { n: byDiff.near.length, hit: byDiff.near.filter(x => x > 0).length },
               mid: { n: byDiff.mid.length, hit: byDiff.mid.filter(x => x > 0).length },
               far: { n: byDiff.far.length, hit: byDiff.far.filter(x => x > 0).length } },
  }
  const p = 'E:/DSHN/build/DSH-memory-nebula/scripts/cross-paraphrase-local.json'
  fs.writeFileSync(p, JSON.stringify(out, null, 2))
  console.log(`\n结果: ${p}`)
}

main().catch(e => { console.error(e); process.exit(1) })
