/**
 * gen-synthetic.mjs — 生成超量合成记忆库（用于规模压测）
 *
 * 两种维度：
 *   - 节点规模：10 万 / 50 万条记忆
 *   - 文本长度：单条 1k / 5k / 20k / 50k 字
 *
 * 内容形态贴近真实：短句为主（80%），夹杂技术笔记/长文档（20%），
 * 带专业名词与中英混合，让分词与倒排索引的负载接近真实。
 *
 * 用法：
 *   node scripts/gen-synthetic.mjs <输出目录> --nodes=100000 [--long=0.2] [--seed=42]
 *   node scripts/gen-synthetic.mjs <输出目录> --docs=200 --doclen=20000
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)
const { NebulaMemory } = require(path.join(ROOT, 'memory', 'store.cjs'))

// ── 参数 ──
const args = process.argv.slice(2)
const outDir = args.find((a) => !a.startsWith('--'))
if (!outDir) {
  console.error('用法: node gen-synthetic.mjs <输出目录> --nodes=N [--docs=N --doclen=N]')
  process.exit(1)
}
const opt = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=')[1] : def
}
const NODES = Number(opt('nodes', 0))
const DOCS = Number(opt('docs', 0))
const DOCLEN = Number(opt('doclen', 20000))
const LONG_RATIO = Number(opt('long', 0.2))
const SEED = Number(opt('seed', 42))

// ── 确定性随机（可复现）──
let s = SEED >>> 0
const rnd = () => {
  s = (s * 1664525 + 1013904223) >>> 0
  return s / 4294967296
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]

// ── 词库（贴近真实记忆内容）──
const SUBJ = ['用户', '老板', '客户', '团队', '项目', '系统', '服务', '数据库', '接口', '模型', '面板', '插件', '记忆库', '检索层', '部署', '容器', '进程', '日志', '缓存', '索引']
const VERB = ['偏好', '决定', '要求', '发现', '确认', '记录了', '遇到', '解决了', '部署了', '重构了', '优化了', '排查了', '迁移到', '升级到']
const OBJ = ['手冲咖啡', '深色主题', 'Postgres 数据库', '记忆星云面板', '四臂召回', '向量检索', '容器报错', '冷启动慢', '索引膨胀', '内存泄漏', 'API 密钥轮换', 'Docker Compose', 'GitHub Actions', 'MCP 协议', 'namespace 隔离', '自动压缩', '赫布边漂移', '中文 bigram 分词', 'FSRS 遗忘曲线', 'RRF 融合排序']
const TECH = ['PostgreSQL', 'ONNX', 'HNSW', 'BM25', 'TF-IDF', 'MMR', 'JSONL', 'SQLite', 'Electron', 'CUDA', 'GGUF', 'LoRA', 'tokenizer', 'embedding', 'reranker']
const FAQ = [
  '这条记忆记录了什么原因导致的报错，以及当时是怎么解决的。',
  '我们讨论了方案 A 和方案 B 的取舍，最后选了资源和维护成本更低的那个。',
  '需要注意：这个配置改完之后必须重启服务才会生效。',
  '实测结果比预期好，延迟从 120ms 降到了 30ms 左右。',
  '约定：以后所有新功能都要先写测试再提交。',
  '客户反馈说希望支持导出为 Markdown 格式。',
]

function sentence() {
  const tpl = rnd()
  if (tpl < 0.5) return `${pick(SUBJ)}${pick(VERB)}${pick(OBJ)}。`
  if (tpl < 0.75) return `${pick(SUBJ)}用 ${pick(TECH)} 处理${pick(OBJ)}，${pick(VERB)}问题。`
  if (tpl < 0.9) return pick(FAQ)
  return `${pick(OBJ)}相关：${pick(TECH)} 与 ${pick(TECH)} 的对比，${pick(SUBJ)}最后${pick(VERB)}。`
}

function paragraph(n = 5) {
  const out = []
  for (let i = 0; i < n; i++) out.push(sentence())
  return out.join('')
}

/** 生成长度约 target 字的文档（按句拼接，避免切断词） */
function longDoc(target) {
  const parts = []
  let len = 0
  while (len < target) {
    const p = paragraph(3 + Math.floor(rnd() * 4))
    parts.push(p)
    len += p.length
  }
  return parts.join('\n\n')
}

const KIND_POOL = ['episode', 'fact', 'note', 'profile']

async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  const mem = new NebulaMemory({ dir: outDir, log: () => {} })
  await mem.init()

  const t0 = Date.now()
  let written = 0

  // 维度一：节点规模（短句为主 + 一定比例长文本）
  if (NODES > 0) {
    console.log(`生成 ${NODES.toLocaleString()} 条记忆（长文本占比 ${LONG_RATIO}）...`)
    for (let i = 0; i < NODES; i++) {
      const isLong = rnd() < LONG_RATIO
      const text = isLong
        ? longDoc(800 + Math.floor(rnd() * 1200))   // 长记忆：0.8k~2k 字
        : sentence()
      await mem.remember({
        text,
        kind: pick(KIND_POOL),
        importance: rnd() < 0.05 ? 1 : Math.round(rnd() * 100) / 100,
        tags: rnd() < 0.3 ? [pick(SUBJ), pick(TECH)] : undefined,
      })
      written++
      if (written % 10000 === 0) {
        const el = (Date.now() - t0) / 1000
        console.log(`  ${written.toLocaleString()} / ${NODES.toLocaleString()}  (${el.toFixed(0)}s, ${(written / el).toFixed(0)}/s)`)
      }
    }
  }

  // 维度二：超长文档（少量，但单条极大）
  if (DOCS > 0) {
    console.log(`生成 ${DOCS} 篇超长文档（每篇约 ${DOCLEN.toLocaleString()} 字）...`)
    for (let i = 0; i < DOCS; i++) {
      const text = longDoc(DOCLEN)
      await mem.remember({ text, kind: 'note', importance: 0.8, tags: ['长篇文档'] })
      written++
      if (written % 20 === 0) console.log(`  ${i + 1} / ${DOCS}`)
    }
  }

  await mem.close()
  const dirs = fs.readdirSync(outDir)
  const nodesFile = path.join(outDir, 'nodes.jsonl')
  const size = fs.existsSync(nodesFile) ? fs.statSync(nodesFile).size : 0
  console.log('─'.repeat(52))
  console.log(`完成: ${written.toLocaleString()} 条写入`)
  console.log(`nodes.jsonl: ${(size / 1048576).toFixed(1)} MB`)
  console.log(`存活节点: ${mem.nodes.size.toLocaleString()}`)
  console.log(`耗时: ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  console.log(`目录: ${outDir}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
