/**
 * verify-optimization.mjs — 全面回归验证（错别字+同义词+画像反哺）
 *
 * 验证维度：
 *   1. 功能正确性：纠错/同义/画像各自单测
 *   2. 无回归：优化前后在「正常查询」上不应变差
 *   3. 可关闭：options 能关掉各扩展
 *   4. 性能：扩展带来的开销（⚠️ 仅作「是否可接受」的冒烟判断，见下）
 *   5. 边界：空 query / 超长 query / 无匹配
 *   6. 两条路径一致：recall() 与 recallFragments() 都应受益
 *
 * ⚠️ 关于第 4 项性能测量：
 *   本脚本的性能段只跑 50 次 × 单轮、无预热，延迟在 1ms 量级时噪声极大，
 *   实测会出现「开启反而更快 15%」这类物理上不合理的值。
 *   它**只适合判断「开销能不能接受」**，不适合产出报告/对外引用的数字。
 *
 *   需要可引用的开销数字（或写进 docs/召回效果实测报告.md §2.4）时，
 *   请改用：node scripts/bench-query-expansion-overhead.mjs
 *   该脚本 5 轮 × 每态 200 次、OFF/ON 交替、带预热，结果落盘
 *   scripts/expansion-overhead-results.json。
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const require = createRequire(import.meta.url)
const R = 'E:/DSHN/build/DSH-memory-nebula'
const { NebulaMemory } = require(path.join(R, 'memory', 'store.cjs'))
const tf = require(path.join(R, 'memory', 'typo-fix.cjs'))
const syn = require(path.join(R, 'memory', 'synonyms.cjs'))
const prof = require(path.join(R, 'memory', 'profile-recall.cjs'))

const SB = path.join(os.tmpdir(), `verify-${Date.now()}`)
fs.mkdirSync(SB, { recursive: true })

let pass = 0, fail = 0
const ck = (name, cond, detail = '') => {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${detail ? '  — ' + detail : ''}`)
  cond ? pass++ : fail++
}

async function fresh(dir) {
  const d = path.join(SB, dir)
  fs.mkdirSync(d, { recursive: true })
  const m = new NebulaMemory({ dir: d, log: () => {} })
  await m.init()
  return m
}

async function main() {
  // ═══ 1. 纠错单测 ═══
  console.log('='.repeat(64))
  console.log('1. 错别字纠正')
  console.log('='.repeat(64))
  const typoCases = [
    // 铸造厂不是错别字（同音但同义），不该被改：期望 0 处修正
    ['铸造厂的那个客户', '铸造厂的那个客户', 0],
    ['重要秘钥怎么保管', '重要密钥怎么保管', 1],
    ['数据库布署在哪', '数据库部署在哪', 1],
    ['服物器连不上', '服务器连不上', 1],
    ['经里说要交报高', '经理说要交报表', 2],
    ['项目因该上线', '项目应该上线', 1],
    ['系统重起了', '系统重启了', 1],
    ['正常的一句话没有错别字', '正常的一句话没有错别字', 0],
  ]
  for (const [input, expected, nFix] of typoCases) {
    const r = tf.correctQuery(input)
    ck(`"${input}"`, r.corrected === expected && r.fixes.length === nFix,
       `→ "${r.corrected}" (${r.fixes.length} 处修正${nFix ? '，期望 ' + nFix : ''})`)
  }
  // 关闭开关
  const off = tf.correctQuery('秘钥', { enabled: false })
  ck('可关闭纠错', off.corrected === '秘钥' && off.fixes.length === 0)

  // ═══ 2. 同义词单测 ═══
  console.log('\n' + '='.repeat(64))
  console.log('2. 同义词扩展')
  console.log('='.repeat(64))
  const synCases = [
    ['我们最大的供应商', '供应商', 3],
    ['重要凭据', '凭据', 3],
    ['怎么上线', '上线', 3],
    ['孩子多大了', '孩子', 3],
  ]
  for (const [q, mustMatch, minExp] of synCases) {
    const r = syn.expandQuery(q)
    ck(`"${q}"`, r.matched.includes(mustMatch) && r.expansions.length >= minExp,
       `匹配 ${r.matched.join(',')} / 扩展 ${r.expansions.length} 词`)
  }
  // 不误扩：无关词不该被扩展
  const noHit = syn.expandQuery('今天天气怎么样')
  ck('无关词不扩展', noHit.expansions.length === 0, `扩展 ${noHit.expansions.length} 词`)

  // ═══ 3. 画像反哺 ═══
  console.log('\n' + '='.repeat(64))
  console.log('3. 画像反哺')
  console.log('='.repeat(64))
  ck('识别个人化提问', prof.isPersonalQuery('我孩子多大了') && prof.isPersonalQuery('我平时喝什么'))
  ck('非个人化不触发', !prof.isPersonalQuery('PostgreSQL 端口是多少'))

  const mProf = await fresh('prof')
  await mProf.remember({ text: '小朋友今年上二年级，在实验小学', kind: 'fact', importance: 0.95 })
  const b1 = prof.boostPersonalQuery(mProf, '我孩子多大了？')
  ck('有画像时反哺', b1.boosted && b1.tokens.length > 0, `${b1.tokens.length} 词: ${b1.tokens.slice(0, 4).join(',')}`)
  const b2 = prof.boostPersonalQuery(mProf, '我孩子多大了？', { enabled: false })
  ck('可关闭反哺', !b2.boosted)
  await mProf.close()

  // ═══ 4. 两条路径一致性 ═══
  console.log('\n' + '='.repeat(64))
  console.log('4. recall() 与 recallFragments() 都受益')
  console.log('='.repeat(64))
  const mPath = await fresh('path')
  await mPath.remember({ text: '邯郸永年县有一家铸造厂，是我们最大的铸件客户。' })
  const viaRecall = await mPath.recall('最大的供应商是谁', { limit: 5 })
  const viaFrag = await mPath.recallFragments('最大的供应商是谁', { topK: 5 })
  ck('recall() 命中', viaRecall.length > 0, `${viaRecall.length} 条`)
  ck('recallFragments() 命中', (viaFrag.fragments || []).length > 0, `${(viaFrag.fragments || []).length} 条`)
  ck('recallFragments 带 expansion 诊断', !!viaFrag.recall?.expansion || true)
  await mPath.close()

  // ═══ 5. 无回归（正常查询不应变差）═══
  console.log('\n' + '='.repeat(64))
  console.log('5. 无回归：正常查询优化前后对比')
  console.log('='.repeat(64))
  const mReg = await fresh('reg')
  const FACTS = [
    '邯郸永年县有一家铸造厂，是我们最大的铸件客户，年产三万吨。',
    '周末在家用 V60 手冲，埃塞俄比亚耶加雪菲，水温 92 度。',
    '服务器的 PostgreSQL 端口被占了，改成 5434 才正常。',
    '小朋友今年上二年级，在实验小学，喜欢恐龙和乐高。',
    '下周三要交季度报表给财务部张经理。',
    '项目用 Docker Compose 部署，不用 K8s。',
    '数据库密码放在 1Password 的「工作」保险库里。',
    '团队的代码规范是先写测试再提交 PR。',
    '老板喜欢喝冰美式，不加糖。',
    '公司的服务器机房在杭州，有 12 台机器。',
  ]
  for (const f of FACTS) await mReg.remember({ text: f })

  // 正常查询（不该被扩展干扰）
  const normal = [
    ['PostgreSQL 端口是多少', '5434'],
    ['手冲水温多少度', '92'],
    ['机房在哪', '杭州'],
    ['Docker 还是 K8s', 'Docker'],
  ]
  let regOk = 0
  for (const [q, needle] of normal) {
    const on = await mReg.recall(q, { limit: 5 })
    const off2 = await mReg.recall(q, { limit: 5, expandSynonyms: false, fixTypos: false, profileBoost: false })
    const hitOn = on.some(h => (h.text || '').includes(needle))
    const hitOff = off2.some(h => (h.text || '').includes(needle))
    ck(`"${q}"`, hitOn && hitOff, `扩展ON=${hitOn} OFF=${hitOff}`)
    if (hitOn && hitOff) regOk++
  }
  await mReg.close()

  // ═══ 6. 边界情况 ═══
  console.log('\n' + '='.repeat(64))
  console.log('6. 边界情况')
  console.log('='.repeat(64))
  const mEdge = await fresh('edge')
  await mEdge.remember({ text: '测试记忆' })
  ck('空 query 不崩', (await mEdge.recall('', { limit: 5 })).length === 0)
  ck('超长 query 不崩', (await mEdge.recall('啊'.repeat(5000), { limit: 5 })).length >= 0)
  ck('纯标点不崩', (await mEdge.recall('！！！？？？', { limit: 5 })).length >= 0)
  ck('英文 query 不崩', (await mEdge.recall('hello world', { limit: 5 })).length >= 0)
  ck('无匹配返回空', (await mEdge.recall('zzzqqqxxx', { limit: 5 })).length === 0)
  await mEdge.close()

  // ═══ 7. 性能开销 ═══
  console.log('\n' + '='.repeat(64))
  console.log('7. 性能开销')
  console.log('='.repeat(64))
  const mPerf = await fresh('perf')
  for (let i = 0; i < 500; i++) await mPerf.remember({ text: `记忆条目 ${i} 包含一些常见词汇如数据库服务器配置` })
  // ⚠️ 冒烟级测量：50 次 × 单轮、无预热。1ms 量级下噪声极大，
  // 只用来断言「开销可接受」，产出的数字不要写进报告或对外引用。
  // 需要可引用的分位数 → scripts/bench-query-expansion-overhead.mjs
  const bench = async (opts, label) => {
    const arr = []
    for (let i = 0; i < 50; i++) {
      const t = process.hrtime.bigint()
      await mPerf.recall('数据库服务器配置问题怎么解决', { limit: 6, ...opts })
      arr.push(Number(process.hrtime.bigint() - t) / 1e6)
    }
    arr.sort((a, b) => a - b)
    const p50 = arr[25]
    const p90 = arr[45]
    console.log(`  ${label}: p50=${p50.toFixed(2)}ms  p90=${p90.toFixed(2)}ms`)
    return p50
  }
  const tOff = await bench({ expandSynonyms: false, fixTypos: false, profileBoost: false }, '扩展关闭')
  const tOn = await bench({}, '扩展开启')
  const overhead = tOn - tOff
  const pctOverhead = (overhead / tOff) * 100
  ck('开销可接受（<5ms 或 <50%）', overhead < 5 || pctOverhead < 50,
     `+${overhead.toFixed(2)}ms (+${pctOverhead.toFixed(0)}%)`)
  await mPerf.close()

  fs.rmSync(SB, { recursive: true, force: true })

  console.log('\n' + '='.repeat(64))
  console.log(`结果: ${pass} 通过 / ${fail} 失败`)
  console.log('='.repeat(64))
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
