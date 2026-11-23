/**
 * gen-fast.mjs — 快速批量生成合成记忆库（用于超大规模压测）
 *
 * 与 gen-synthetic.mjs 的区别：不走 memory.remember() 的逐条去重/索引重建，
 * 而是直接批量 append JSONL + 最后一次性建索引，速度提升 ~100 倍。
 * 数据格式与真实库完全一致（同 _publicNode 结构），可被引擎正常加载。
 *
 * 用法：
 *   node scripts/gen-fast.mjs <输出目录> --nodes=500000 [--long=0.1] [--seed=42]
 */
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const outDir = args.find((a) => !a.startsWith('--'))
if (!outDir) { console.error('用法: node gen-fast.mjs <目录> --nodes=N'); process.exit(1) }
const opt = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.split('=')[1] : d }
const NODES = Number(opt('nodes', 100000))
const LONG_RATIO = Number(opt('long', 0.1))
const SEED = Number(opt('seed', 42))

let s = SEED >>> 0
const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
const pick = (a) => a[Math.floor(rnd() * a.length)]

const SUBJ = ['用户','老板','客户','团队','项目','系统','服务','数据库','接口','模型','面板','插件','记忆库','检索层','部署','容器','进程','日志','缓存','索引']
const VERB = ['偏好','决定','要求','发现','确认','记录了','遇到','解决了','部署了','重构了','优化了','排查了','迁移到','升级到']
const OBJ = ['手冲咖啡','深色主题','Postgres 数据库','记忆星云面板','四臂召回','向量检索','容器报错','冷启动慢','索引膨胀','内存泄漏','API 密钥轮换','Docker Compose','GitHub Actions','MCP 协议','namespace 隔离','自动压缩','赫布边漂移','中文 bigram 分词','FSRS 遗忘曲线','RRF 融合排序']
const TECH = ['PostgreSQL','ONNX','HNSW','BM25','TF-IDF','MMR','JSONL','SQLite','Electron','CUDA','GGUF','LoRA','tokenizer','embedding','reranker']
const FAQ = [
  '这条记忆记录了什么原因导致的报错，以及当时是怎么解决的。',
  '我们讨论了方案 A 和方案 B 的取舍，最后选了资源和维护成本更低的那个。',
  '需要注意：这个配置改完之后必须重启服务才会生效。',
  '实测结果比预期好，延迟从 120ms 降到了 30ms 左右。',
  '约定：以后所有新功能都要先写测试再提交。',
  '客户反馈说希望支持导出为 Markdown 格式。',
]
const KINDS = ['episode','fact','note','profile']
const DAY = 86400000

function sentence() {
  const t = rnd()
  if (t < 0.5) return `${pick(SUBJ)}${pick(VERB)}${pick(OBJ)}。`
  if (t < 0.75) return `${pick(SUBJ)}用 ${pick(TECH)} 处理${pick(OBJ)}，${pick(VERB)}问题。`
  if (t < 0.9) return pick(FAQ)
  return `${pick(OBJ)}相关：${pick(TECH)} 与 ${pick(TECH)} 的对比，${pick(SUBJ)}最后${pick(VERB)}。`
}
function para(n) { const o = []; for (let i = 0; i < n; i++) o.push(sentence()); return o.join('') }
function longDoc(target) { const p = []; let len = 0; while (len < target) { const x = para(3 + ((rnd() * 4) | 0)); p.push(x); len += x.length } return p.join('\n\n') }

// 与 store.cjs _publicNode 对齐的最小结构
function makeNode(id, text, kind, ts, importance, tags) {
  return {
    id, text, kind, tags: tags || [], importance,
    ts,
    stability: 1,
    lastAccessAt: ts,
    access: 0,
    layer: 'event',
    dormant: false,
    archived: false,
    act: 0,
    meta: {},
  }
}

function main() {
  fs.mkdirSync(outDir, { recursive: true })
  const t0 = Date.now()
  const now = Date.now()
  const ids = []
  const chunk = []
  const lines = []
  const BUF = 5000
  const out = path.join(outDir, 'nodes.jsonl')
  fs.writeFileSync(out, '')

  let totalChars = 0
  let maxLen = 0
  for (let i = 0; i < NODES; i++) {
    // id 格式与真实引擎一致：mmw + base36 时间戳 + 随机
    const id = 'mmw' + (now / 1000 | 0).toString(36) + Math.random().toString(36).slice(2, 10)
    ids.push(id)
    const isLong = rnd() < LONG_RATIO
    const text = isLong ? longDoc(800 + ((rnd() * 1200) | 0)) : sentence()
    totalChars += text.length
    if (text.length > maxLen) maxLen = text.length
    const ts = now - Math.floor(rnd() * 180) * DAY   // 过去 180 天内
    const kind = pick(KINDS)
    const imp = rnd() < 0.05 ? 1 : Math.round(rnd() * 100) / 100
    const tags = rnd() < 0.3 ? [pick(SUBJ), pick(TECH)] : []
    lines.push(JSON.stringify(makeNode(id, text, kind, ts, imp, tags)))
    if (lines.length >= BUF) {
      fs.appendFileSync(out, lines.join('\n') + '\n')
      lines.length = 0
    }
    if ((i + 1) % 100000 === 0) {
      const el = (Date.now() - t0) / 1000
      console.log(`  ${(i + 1).toLocaleString()} / ${NODES.toLocaleString()}  (${el.toFixed(0)}s, ${((i + 1) / el).toFixed(0)}/s)`)
    }
  }
  if (lines.length) fs.appendFileSync(out, lines.join('\n') + '\n')

  // 边：随机连一部分（模拟赫布边，平均度 ~4）
  const edgeLines = []
  const nEdges = Math.floor(NODES * 2)
  for (let i = 0; i < nEdges; i++) {
    const a = ids[(rnd() * ids.length) | 0]
    const b = ids[(rnd() * ids.length) | 0]
    if (a === b) continue
    const [lo, hi] = a < b ? [a, b] : [b, a]
    edgeLines.push(JSON.stringify({ a: lo, b: hi, w: Math.round((0.1 + rnd() * 0.9) * 1000) / 1000, kind: 'hebbian', ts: now, lastFired: now, fireCount: 1 }))
    if (edgeLines.length >= BUF) { fs.appendFileSync(path.join(outDir, 'edges.jsonl'), edgeLines.join('\n') + '\n'); edgeLines.length = 0 }
  }
  if (edgeLines.length) fs.appendFileSync(path.join(outDir, 'edges.jsonl'), edgeLines.join('\n') + '\n')

  const size = fs.statSync(out).size
  const el = (Date.now() - t0) / 1000
  console.log('─'.repeat(52))
  console.log(`节点: ${NODES.toLocaleString()}`)
  console.log(`边:   ~${nEdges.toLocaleString()}`)
  console.log(`nodes.jsonl: ${(size / 1048576).toFixed(1)} MB`)
  console.log(`平均文本长度: ${(totalChars / NODES).toFixed(0)} 字  最长: ${maxLen.toLocaleString()} 字`)
  console.log(`耗时: ${el.toFixed(1)}s  (${(NODES / el).toFixed(0)}/s)`)
  console.log(`目录: ${outDir}`)
}
main()
