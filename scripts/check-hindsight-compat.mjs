#!/usr/bin/env node
/**
 * check-hindsight-compat.mjs —— Hindsight 上游 API 兼容性检查
 *
 * 为什么需要这个：上游发版很快（1.0.0 → 1.3.0 只用了 24 天），我们却只依赖
 * 它的一小撮接口。一旦上游删端点、改字段名、改 method，本插件会在某个用户
 * 机器上静默坏掉 —— 表现为「面板全绿但语义增强没数据」，极难排查。
 *
 * 检查分两层：
 *   A. 静态契约：拉运行中服务的 /openapi.json，核对我们依赖的端点与字段是否还在
 *   B. 在线冒烟：实调只读端点，确认响应里真的有我们要读的字段
 *
 * 用法：
 *   node scripts/check-hindsight-compat.mjs
 *   node scripts/check-hindsight-compat.mjs --url http://127.0.0.1:8888
 *   node scripts/check-hindsight-compat.mjs --json      # 机器可读输出
 *   node scripts/check-hindsight-compat.mjs --strict    # 有警告也返回非 0
 *
 * 退出码：0 = 全部通过；1 = 有失败；2 = 服务不可达
 */

const args = process.argv.slice(2)
const getArg = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt
}
const BASE = String(getArg('--url', process.env.HINDSIGHT_URL || 'http://127.0.0.1:8888')).replace(/\/+$/, '')
const JSON_OUT = args.includes('--json')
const STRICT = args.includes('--strict')
const TIMEOUT = Number(getArg('--timeout', '10000')) || 10000

// ── 我们依赖的契约（改这里之前先确认真的是刚需）────────────────────────────
// 每条 path 用 OpenAPI 的模板写法；fields 是我们在代码里实际读取的响应字段。
const CONTRACT = [
  { path: '/health', method: 'get', fields: ['database'], note: '端口探测 + 数据库状态' },
  { path: '/version', method: 'get', fields: ['api_version', 'features'], note: '版本与特性开关' },
  { path: '/v1/default/banks', method: 'get', fields: [], note: 'bank 列表（元素含 bank_id/fact_count）' },
  { path: '/v1/default/banks/{bank_id}/stats', method: 'get', fields: ['total_nodes', 'total_links'], note: '记忆层统计' },
  { path: '/v1/default/banks/{bank_id}/graph', method: 'get', fields: ['nodes', 'edges'], note: '星图节点与边' },
  { path: '/v1/default/banks/{bank_id}/operations', method: 'get', fields: [], note: 'worker 运行状态' },
  // dry-run-extract 是 LLM 探测的关键，单独标注
  { path: '/v1/default/banks/{bank_id}/memories/dry-run-extract', method: 'post', fields: ['usage'], note: 'LLM 可用性探测（向导第③步）' },
]

const results = []
function record(level, name, detail) {
  results.push({ level, name, detail })
}

async function fetchJson(path, opts = {}) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT)
  try {
    const r = await fetch(`${BASE}${path}`, { ...opts, signal: ctl.signal, headers: { accept: 'application/json', ...(opts.headers || {}) } })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  if (!JSON_OUT) {
    console.log(`Hindsight 兼容性检查 · ${BASE}`)
    console.log('')
  }

  // ── 0. 服务可达？──────────────────────────────────────────────────────
  let health
  try {
    health = await fetchJson('/health')
  } catch (error) {
    if (JSON_OUT) {
      console.log(JSON.stringify({ ok: false, error: 'unreachable', detail: error.message, url: BASE }, null, 2))
    } else {
      console.error(`✗ 服务不可达：${BASE}（${error.message}）`)
      console.error('  请先确认 Hindsight 已启动。检查本身不需要本插件运行。')
    }
    process.exit(2)
  }
  record('pass', '服务可达', `${BASE}/health`)

  // ── A. 静态契约：openapi.json 里端点和 method 是否还在 ────────────────
  let spec = null
  try {
    spec = await fetchJson('/openapi.json')
    record('pass', 'OpenAPI 规范可取', `${Object.keys(spec.paths || {}).length} 个路径`)
  } catch (error) {
    record('warn', 'OpenAPI 规范不可取', `${error.message}（跳过静态契约检查，只做在线冒烟）`)
  }

  if (spec && spec.paths) {
    for (const c of CONTRACT) {
      const entry = spec.paths[c.path]
      if (!entry) {
        record('fail', `端点缺失 ${c.path}`, c.note)
        continue
      }
      const methods = Object.keys(entry)
      if (!methods.includes(c.method)) {
        record('fail', `method 变更 ${c.path}`, `期望 ${c.method.toUpperCase()}，实际 ${methods.map((m) => m.toUpperCase()).join('/')}`)
        continue
      }
      record('pass', `端点存在 ${c.path}`, `${c.method.toUpperCase()}`)
    }
  }

  // ── B. 在线冒烟：实调只读端点，确认字段真的有 ────────────────────────
  // 先拿一个 bank（没有 bank 就跳过需要 bank 的检查）
  let bankId = ''
  try {
    const banks = await fetchJson('/v1/default/banks')
    const list = Array.isArray(banks) ? banks : (banks.banks || [])
    if (Array.isArray(list) && list.length) {
      bankId = list[0].bank_id || ''
      const hasId = Object.prototype.hasOwnProperty.call(list[0], 'bank_id')
      const hasCount = Object.prototype.hasOwnProperty.call(list[0], 'fact_count')
      if (hasId && hasCount) record('pass', 'banks 列表字段', `bank_id + fact_count（共 ${list.length} 个 bank）`)
      else record('fail', 'banks 列表字段缺失', `bank_id=${hasId} fact_count=${hasCount}`)
    } else {
      record('warn', 'banks 列表为空', '无法做需要 bank 的冒烟检查')
    }
  } catch (error) {
    record('fail', 'banks 列表不可取', error.message)
  }

  // /version 的 features（我们用它判断行为差异）
  try {
    const ver = await fetchJson('/version')
    if (ver.api_version) {
      const feats = ver.features && typeof ver.features === 'object' ? Object.keys(ver.features).length : 0
      record('pass', 'version 响应', `api_version=${ver.api_version}，features ${feats} 项`)
    } else {
      record('fail', 'version 缺 api_version', JSON.stringify(ver).slice(0, 120))
    }
  } catch (error) {
    record('fail', 'version 不可取', error.message)
  }

  if (bankId) {
    const enc = encodeURIComponent(bankId)
    // stats
    try {
      const st = await fetchJson(`/v1/default/banks/${enc}/stats`)
      const okNodes = 'total_nodes' in st
      const okLinks = 'total_links' in st
      if (okNodes && okLinks) record('pass', 'stats 字段', `total_nodes + total_links`)
      else record('fail', 'stats 字段缺失', `total_nodes=${okNodes} total_links=${okLinks}`)
    } catch (error) {
      record('fail', 'stats 不可取', error.message)
    }
    // graph（限 1 条，只要结构）
    try {
      const g = await fetchJson(`/v1/default/banks/${enc}/graph?limit=1`)
      const keys = Object.keys(g || {})
      if (keys.includes('nodes') && keys.includes('edges')) record('pass', 'graph 结构', `nodes + edges`)
      else record('fail', 'graph 结构变化', `实际键：${keys.join(',') || '（空）'}`)
    } catch (error) {
      record('fail', 'graph 不可取', error.message)
    }
    // operations（worker 状态用）
    try {
      await fetchJson(`/v1/default/banks/${enc}/operations?status=processing&limit=1`)
      record('pass', 'operations 可取', 'worker 状态可用')
    } catch (error) {
      record('warn', 'operations 不可取', `${error.message}（worker 状态会显示未知）`)
    }
    // dry-run-extract：这个会真的调 LLM，默认不做；显式 --probe-llm 才跑
    if (args.includes('--probe-llm')) {
      try {
        const r = await fetch(`${BASE}/v1/default/banks/${enc}/memories/dry-run-extract`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content: 'compat probe', context: 'contract check' }),
        })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = await r.json()
        if (j && j.usage) record('pass', 'dry-run-extract', `usage 存在（total_tokens=${j.usage.total_tokens ?? '?'}）`)
        else record('fail', 'dry-run-extract 缺 usage', '第③步 LLM 探测依赖它')
      } catch (error) {
        record('warn', 'dry-run-extract 失败', `${error.message}（可能是 LLM 未配置）`)
      }
    } else {
      record('skip', 'dry-run-extract 实测', '默认跳过（会真的调 LLM）；需检查时加 --probe-llm')
    }
  }

  // ── 汇总 ─────────────────────────────────────────────────────────────
  const fails = results.filter((r) => r.level === 'fail')
  const warns = results.filter((r) => r.level === 'warn')
  const passes = results.filter((r) => r.level === 'pass')
  const ok = fails.length === 0 && (!STRICT || warns.length === 0)

  if (JSON_OUT) {
    console.log(JSON.stringify({ ok, url: BASE, passes: passes.length, fails: fails.length, warns: warns.length, results }, null, 2))
  } else {
    const icon = { pass: '✓', fail: '✗', warn: '!', skip: '·' }
    for (const r of results) {
      const tail = r.detail ? `  ${r.detail}` : ''
      console.log(`  ${icon[r.level] || '?'} ${r.name}${tail}`)
    }
    console.log('')
    if (fails.length) {
      console.log(`${fails.length} 项失败 —— 上游接口与契约不符，本插件对应功能会失效。`)
      console.log('处理建议：')
      console.log('  1) 确认上游版本：curl ' + BASE + '/version')
      console.log('  2) 对照 https://hindsight.vectorize.io/api-reference 看变更')
      console.log('  3) 若是上游改字段名，改 lib/engine.mjs 与 server.js 里对应的读取处')
    } else if (warns.length) {
      console.log(`无失败，但有 ${warns.length} 项警告（多为可选能力，不影响核心）。`)
    } else {
      console.log(`全部通过（${passes.length} 项）。`)
    }
  }

  process.exit(ok ? 0 : 1)
}

main().catch((error) => {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: 'internal', detail: error.message }, null, 2))
  else console.error('检查脚本自身出错：' + error.message)
  process.exit(1)
})
