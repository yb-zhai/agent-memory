/**
 * bench-3groups.mjs — 三组召回对比（100 题）
 *
 * 组别：
 *   G1 本地引擎（扩展开）
 *   G2 Hindsight
 *   G3 RRF 融合（本地 + Hindsight，项目现有逻辑）
 *
 * 注：原「G3 两阶段（Hindsight 召回 → 本地重排）」已移除——它属于重排实验，
 * 不属双引擎项目范围，仅作历史参考，不再计算也不落盘。
 *
 * 设计：共享事实库（20 条），100 个查询，避免每题写库导致 LLM 成本爆炸。
 * Hindsight 侧预先灌库并等待 worker 清零，之后所有查询复用。
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const R = 'E:/DSHN/build/DSH-memory-nebula'
const { NebulaMemory } = require(path.join(R, 'memory', 'store.cjs'))

// ── 20 条事实（覆盖 8 个业务域）──
const FACTS = {
  A: '邯郸永年县有一家铸造厂，是我们最大的铸件客户，年产三万吨，合作了八年。',
  B: '周末在家用 V60 手冲，埃塞俄比亚耶加雪菲，水温 92 度，研磨度中细。',
  C: '服务器的 PostgreSQL 端口被占了，改成 5434 才正常，记得同步改防火墙。',
  D: '小朋友今年上二年级，在实验小学，喜欢恐龙和乐高，数学特别好。',
  E: '下周三要交季度报表给财务部张经理，需要提前准备三个月的流水。',
  F: '项目用 Docker Compose 部署，不用 K8s，因为团队规模小运维成本高。',
  G: '数据库密码放在 1Password 的「工作」保险库里，主密码只有我知道。',
  H: '团队的代码规范是先写测试再提交 PR，不接受直接推主干，CI 必须绿。',
  I: '老板喜欢喝冰美式，不加糖，每天早上九点一杯，加班时喝第二杯。',
  J: '公司的服务器机房在杭州，有 12 台机器，UPS 只能撑 30 分钟。',
  K: '客服系统的响应时间是 2 小时内，超时要扣绩效，投诉率高会被约谈。',
  L: '产品路线图 Q4 重点是移动端，Web 端只做维护不再加新功能。',
  M: '财务报销要三个工作日内提交，超过需要在系统里写说明。',
  N: '设计稿放在 Figma 的「DSHN」项目里，切图规格是 2 倍图。',
  O: '周会时间改成每周一上午十点，地点在三楼会议室。',
  P: '客户投诉最多的是加载慢，我们已经上了 CDN 但效果一般。',
  Q: '新人入职要配 MacBook Pro，开发环境用 Docker 统一镜像。',
  R: '数据备份每天凌晨三点跑，保留最近 30 天，异地存一份。',
  S: '项目二期预算 80 万，需要在下个月底前报批。',
  T: '文档统一用飞书，代码注释必须写清楚参数和返回值。',
}

// ── 100 个查询（每事实 5 个：near/mid/far × 难度梯度）──
const QUERIES = []
const addQ = (q, key, diff) => QUERIES.push({ q, key, diff })

// A 铸造厂
addQ('邯郸那个铸造厂年产多少？', 'A', 'near')
addQ('我们最大的供应商是哪家？', 'A', 'mid')
addQ('上次那个铸件的客户是哪家？', 'A', 'far')
addQ('合作最久的那家工厂？', 'A', 'far')
addQ('永年县那个客户合作几年了？', 'A', 'mid')
// B 咖啡
addQ('手冲用多少度水温？', 'B', 'near')
addQ('我周末有什么爱好？', 'B', 'mid')
addQ('我平时喝咖啡有什么讲究？', 'B', 'far')
addQ('耶加雪菲怎么冲？', 'B', 'mid')
addQ('那个豆子研磨度多少？', 'B', 'far')
// C PostgreSQL
addQ('PostgreSQL 改成哪个端口了？', 'C', 'near')
addQ('上次数据库问题怎么解决的？', 'C', 'mid')
addQ('连接失败那次怎么修的？', 'C', 'far')
addQ('5434 是干什么用的？', 'C', 'mid')
addQ('防火墙要同步改什么？', 'C', 'far')
// D 孩子
addQ('孩子在哪个学校？', 'D', 'near')
addQ('我孩子有什么爱好？', 'D', 'mid')
addQ('我孩子多大了？', 'D', 'far')
addQ('小朋友喜欢玩什么？', 'D', 'mid')
addQ('那个孩子哪门功课好？', 'D', 'far')
// E 报表
addQ('报表交给谁？', 'E', 'near')
addQ('最近有什么要赶的事情？', 'E', 'mid')
addQ('下周三要交什么？', 'E', 'near')
addQ('财务那边要准备什么材料？', 'E', 'far')
addQ('季度汇报要准备多久的流水？', 'E', 'mid')
// F Docker
addQ('项目用的什么部署方式？', 'F', 'near')
addQ('为什么没用容器编排？', 'F', 'mid')
addQ('我们怎么上线服务的？', 'F', 'far')
addQ('运维成本高的原因是什么？', 'F', 'far')
addQ('团队规模影响了什么技术选型？', 'F', 'far')
// G 密码
addQ('密码存在哪个工具？', 'G', 'near')
addQ('重要凭据怎么保管的？', 'G', 'mid')
addQ('我账号密码放在哪来着？', 'G', 'far')
addQ('主密码有谁知道？', 'G', 'mid')
addQ('工作保险库在哪个应用里？', 'G', 'far')
// H 代码规范
addQ('提交代码前要做什么？', 'H', 'near')
addQ('我们对代码质量有什么要求？', 'H', 'mid')
addQ('能直接推主干吗？', 'H', 'far')
addQ('CI 必须是什么状态？', 'H', 'mid')
addQ('团队的技术规范是什么？', 'H', 'far')
// I 老板
addQ('老板喝什么咖啡？', 'I', 'near')
addQ('老板有什么习惯？', 'I', 'mid')
addQ('早上九点老板会做什么？', 'I', 'far')
addQ('老板加班时喝什么？', 'I', 'near')
addQ('那个不加糖的饮品是什么？', 'I', 'far')
// J 机房
addQ('服务器机房在哪？', 'J', 'near')
addQ('公司有多少台机器？', 'J', 'mid')
addQ('UPS 能撑多久？', 'J', 'near')
addQ('算力设施放在哪个城市？', 'J', 'far')
addQ('断电了能应急多久？', 'J', 'far')
// K 客服
addQ('客服响应时间要求多久？', 'K', 'near')
addQ('客服超时会怎么样？', 'K', 'mid')
addQ('投诉太多会有什么后果？', 'K', 'far')
addQ('客服绩效怎么考核？', 'K', 'far')
addQ('用户反馈多久要回复？', 'K', 'mid')
// L 路线图
addQ('Q4 产品重点是什么？', 'L', 'near')
addQ('Web 端还会加功能吗？', 'L', 'mid')
addQ('移动端什么时候做？', 'L', 'far')
addQ('产品规划的重点方向？', 'L', 'far')
addQ('接下来做什么功能？', 'L', 'far')
// M 报销
addQ('报销要几个工作日提交？', 'M', 'near')
addQ('报销超时怎么办？', 'M', 'mid')
addQ('费用怎么报？', 'M', 'far')
addQ('财务流程有什么时限？', 'M', 'far')
addQ('报销需要在系统里写什么？', 'M', 'mid')
// N 设计稿
addQ('设计稿放在哪里？', 'N', 'near')
addQ('切图规格是多少？', 'N', 'mid')
addQ('设计师的文件在哪看？', 'N', 'far')
addQ('Figma 项目叫什么名字？', 'N', 'mid')
addQ('UI 资源从哪里拿？', 'N', 'far')
// O 周会
addQ('周会什么时候开？', 'O', 'near')
addQ('周会在哪个会议室？', 'O', 'mid')
addQ('每周一上午要做什么？', 'O', 'far')
addQ('例会时间改了吗？', 'O', 'far')
addQ('十点有什么安排？', 'O', 'mid')
// P 加载慢
addQ('客户投诉最多的是什么？', 'P', 'near')
addQ('加载慢的问题解决了吗？', 'P', 'mid')
addQ('CDN 效果怎么样？', 'P', 'near')
addQ('用户抱怨什么最多？', 'P', 'far')
addQ('性能优化做了什么？', 'P', 'far')
// Q 新人
addQ('新人入职配什么电脑？', 'Q', 'near')
addQ('开发环境怎么统一？', 'Q', 'mid')
addQ('新同事的装备是什么？', 'Q', 'far')
addQ('用什么镜像做开发环境？', 'Q', 'mid')
addQ('入职流程有哪些？', 'Q', 'far')
// R 备份
addQ('数据备份什么时候跑？', 'R', 'near')
addQ('备份保留多久？', 'R', 'mid')
addQ('凌晨三点会做什么？', 'R', 'far')
addQ('备份有异地副本吗？', 'R', 'mid')
addQ('数据安全怎么保障？', 'R', 'far')
// S 预算
addQ('项目二期预算多少？', 'S', 'near')
addQ('什么时候要报批？', 'S', 'mid')
addQ('80 万是做什么的？', 'S', 'mid')
addQ('下一阶段的资金计划？', 'S', 'far')
addQ('月底前要完成什么？', 'S', 'far')
// T 文档
addQ('文档用什么工具？', 'T', 'near')
addQ('代码注释要写什么？', 'T', 'mid')
addQ('团队协作平台是什么？', 'T', 'far')
addQ('注释规范有什么要求？', 'T', 'mid')
addQ('知识库放在哪？', 'T', 'far')

const HS = 'http://127.0.0.1:8888'
const BANK = `bench::four${Date.now()}`
const BANK_Q = encodeURIComponent(BANK)
const SB = path.join(os.tmpdir(), `four-${Date.now()}`)

// ── Hindsight 调用（用临时文件传 JSON，彻底规避 curl 引号转义问题）──
let tmpCounter = 0
function hsCall(method, p, body) {
  const url = HS + p
  let args
  if (body) {
    // 写临时文件传参，避免 shell 引号转义破坏 JSON
    const tmp = path.join(os.tmpdir(), `hsbody-${process.pid}-${tmpCounter++}.json`)
    fs.writeFileSync(tmp, JSON.stringify(body), 'utf8')
    args = ['-s', '-X', method, '-H', 'Content-Type: application/json',
            '--data-binary', '@' + tmp, '--max-time', '180', url]
    try {
      const out = execFileSync('curl.exe', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      return out ? JSON.parse(out) : null
    } finally {
      try { fs.unlinkSync(tmp) } catch { /* ignore */ }
    }
  }
  args = ['-s', '-X', method, '-H', 'Content-Type: application/json', '--max-time', '180', url]
  const out = execFileSync('curl.exe', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return out ? JSON.parse(out) : null
}

async function main() {
  fs.mkdirSync(SB, { recursive: true })
  console.log('='.repeat(72))
  console.log('三组召回对比 · 100 题（20 条共享事实）')
  console.log('='.repeat(72))
  console.log(`事实数: ${Object.keys(FACTS).length}  查询数: ${QUERIES.length}`)

  // ══ 准备：本地库 ══
  const mem = new NebulaMemory({ dir: SB, log: () => {} })
  await mem.init()
  for (const k of Object.keys(FACTS)) await mem.remember({ text: FACTS[k], kind: 'fact' })
  console.log(`\n[准备] 本地库: ${mem.nodes.size} 节点`)

  // ══ 准备：Hindsight 库 ══
  console.log(`[准备] Hindsight 库: ${BANK}`)
  for (const k of Object.keys(FACTS)) {
    try {
      hsCall('POST', `/v1/default/banks/${BANK_Q}/memories`,
             { items: [{ role: 'user', content: FACTS[k] }] })
    } catch (e) {
      console.log(`  写入 ${k} 失败: ${String(e.message).slice(0, 60)}`)
    }
  }
  console.log('  等待 worker 消化 ...')
  const t0 = Date.now()
  const MAX_WAIT = 480000   // 8 分钟上限，超时就继续（如实标注）
  let settled = false
  let lastN = -1
  while (Date.now() - t0 < MAX_WAIT) {
    try {
      const s = hsCall('GET', `/v1/default/banks/${BANK_Q}/stats`)
      const n = s?.pending_operations ?? -1
      const el = ((Date.now() - t0) / 1000).toFixed(0)
      process.stdout.write(`\r  pending=${n} (${el}s)          `)
      if (n === 0) { console.log(' ✅ 已清空'); settled = true; break }
      // 连续 3 次不变且 > 60s，判断卡住，提前退出
      if (n === lastN && Date.now() - t0 > 60000) {
        console.log(`\n  ⚠️ pending 停滞在 ${n}，继续执行（结果如实标注）`)
        break
      }
      lastN = n
    } catch (e) { /* ignore */ }
    await new Promise(r => setTimeout(r, 15000))
  }
  if (!settled) console.log('  ⚠️ 未在时限内清空，Hindsight 组结果可能偏低')

  // 拉取 Hindsight 全量记忆（用于 RRF 融合）
  // 办法：用宽泛查询拉大池子
  const hsPool = []
  const seenHs = new Set()
  for (const k of Object.keys(FACTS)) {
    try {
      const j = hsCall('POST', `/v1/default/banks/${BANK_Q}/memories/recall`,
                       { query: FACTS[k].slice(0, 10) })
      for (const r of (j?.results || [])) {
        if (r.id && !seenHs.has(r.id)) { seenHs.add(r.id); hsPool.push(r) }
      }
    } catch { /* ignore */ }
  }
  console.log(`[准备] Hindsight 可召回池: ${hsPool.length} 条`)

  // ══ 三组评测 ══
  const groups = {
    G1_local: [], G2_hindsight: [], G3_rrf: [],
  }
  const detail = []

  for (let qi = 0; qi < QUERIES.length; qi++) {
    const { q, key, diff } = QUERIES[qi]
    const factText = FACTS[key]
    // 判定 needle：取事实的前 8 字和中间 8 字
    const needles = [factText.slice(0, 8), factText.slice(10, 18)]

    const rankOf = (texts, limit = 20) => {
      for (let i = 0; i < Math.min(texts.length, limit); i++) {
        if (needles.some(n => (texts[i] || '').includes(n))) return i + 1
      }
      return 0
    }

    // G1: 本地
    const localHits = await mem.recall(q, { limit: 20 })
    const r1 = rankOf(localHits.map(h => h.text))

    // G2: Hindsight
    let hsHits = []
    try {
      const j = hsCall('POST', `/v1/default/banks/${BANK_Q}/memories/recall`, { query: q })
      hsHits = (j?.results || []).slice(0, 20)
    } catch { /* ignore */ }
    const r2 = rankOf(hsHits.map(h => h.text || ''))

    // G3: RRF 融合（本地 + Hindsight）
    const RRF_K = 60
    const fusion = new Map()
    const keyOf = (t) => (t || '').slice(0, 40)
    localHits.slice(0, 20).forEach((h, i) => {
      const k = keyOf(h.text)
      fusion.set(k, (fusion.get(k) || 0) + 1 / (RRF_K + i))
    })
    hsHits.slice(0, 20).forEach((h, i) => {
      const k = keyOf(h.text || '')
      fusion.set(k, (fusion.get(k) || 0) + 1 / (RRF_K + i))
    })
    const fused = [...fusion.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
    const r3 = rankOf(fused)

    groups.G1_local.push(r1)
    groups.G2_hindsight.push(r2)
    groups.G3_rrf.push(r3)
    detail.push({ q, key, diff, r1, r2, r3 })

    if ((qi + 1) % 10 === 0) {
      process.stdout.write(`\r  进度 ${qi + 1}/${QUERIES.length}`)
    }
  }
  console.log()

  await mem.close()

  // ══ 汇总 ══
  const stat = (ranks) => {
    const n = ranks.length
    const hit = ranks.filter(x => x > 0).length
    const mrr = ranks.filter(x => x > 0).reduce((s, x) => s + 1 / x, 0) / n
    return { n, hit, recall: hit / n, mrr }
  }

  console.log('\n' + '='.repeat(72))
  console.log('总体结果（Recall@20 / MRR）')
  console.log('='.repeat(72))
  console.log(`  ${'组别'.padEnd(22)} ${'Recall'.padStart(10)} ${'MRR'.padStart(10)}`)
  const labels = {
    G1_local: 'G1 本地引擎',
    G2_hindsight: 'G2 Hindsight',
    G3_rrf: 'G3 RRF 融合',
  }
  const summary = {}
  for (const g of Object.keys(groups)) {
    const s = stat(groups[g])
    summary[g] = s
    console.log(`  ${labels[g].padEnd(22)} ${(s.recall * 100).toFixed(1).padStart(9)}% ${s.mrr.toFixed(4).padStart(10)}`)
  }

  // 按难度分组
  console.log('\n按难度：')
  console.log(`  ${'难度'.padEnd(6)} ${'n'.padStart(4)} ${'G1'.padStart(8)} ${'G2'.padStart(8)} ${'G3'.padStart(8)}`)
  for (const d of ['near', 'mid', 'far']) {
    const idxs = detail.map((x, i) => x.diff === d ? i : -1).filter(i => i >= 0)
    if (!idxs.length) continue
    const cells = ['G1_local', 'G2_hindsight', 'G3_rrf'].map(g => {
      const rs = idxs.map(i => groups[g][i])
      return (rs.filter(x => x > 0).length / rs.length * 100).toFixed(1)
    })
    console.log(`  ${d.padEnd(6)} ${String(idxs.length).padStart(4)} ${cells.map(c => (c + '%').padStart(8)).join(' ')}`)
  }

  const out = { when: new Date().toISOString(), facts: Object.keys(FACTS).length, queries: QUERIES.length, summary, groups, detail }
  fs.writeFileSync(path.join(R, 'scripts', 'bench-4groups.json'), JSON.stringify(out, null, 2))
  console.log(`\n结果: ${path.join(R, 'scripts', 'bench-4groups.json')}`)
  fs.rmSync(SB, { recursive: true, force: true })
}

main().catch(e => { console.error(e); process.exit(1) })
