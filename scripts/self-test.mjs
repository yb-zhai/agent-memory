#!/usr/bin/env node
/**
 * self-test.mjs —— 验证 check-hindsight-compat.mjs 自身是否可靠
 *
 * CI 里没有真实的 Hindsight 服务，所以这里用本地 mock 服务模拟四种场景，
 * 断言检查器能给出正确结论：
 *   1. 完全合规的服务     → 退出码 0，无失败项
 *   2. 缺一个端点         → 退出码 1，且明确指出是哪个端点
 *   3. 端点在但缺字段     → 退出码 1，且明确指出缺哪个字段
 *   4. 服务不可达         → 退出码 2
 *
 * 这样能防止「检查器坏了但一直报绿」——比什么都不测更有意义。
 *
 * 用法：node scripts/self-test.mjs
 */

import http from 'node:http'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CHECKER = path.join(__dirname, 'check-hindsight-compat.mjs')

// ── mock 服务：按场景返回不同内容 ────────────────────────────────────────
function makeServer(scenario) {
  const specPaths = {
    '/health': { get: {} },
    '/version': { get: {} },
    '/v1/default/banks': { get: {} },
    '/v1/default/banks/{bank_id}/stats': { get: {} },
    '/v1/default/banks/{bank_id}/graph': { get: {} },
    '/v1/default/banks/{bank_id}/operations': { get: {} },
    '/v1/default/banks/{bank_id}/memories/dry-run-extract': { post: {} },
  }
  // 场景 2：删掉一个端点
  if (scenario === 'missing-endpoint') {
    delete specPaths['/v1/default/banks/{bank_id}/memories/dry-run-extract']
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const p = url.pathname
    const send = (obj, code = 200) => {
      const body = JSON.stringify(obj)
      res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
      res.end(body)
    }

    if (p === '/health') return send({ status: 'healthy', database: 'connected', db_acquire_ms: 1 })
    if (p === '/version') return send({ api_version: '9.9.9-test', features: { worker: true } })
    if (p === '/openapi.json') return send({ openapi: '3.0.0', paths: specPaths })
    if (p === '/v1/default/banks') return send({ banks: [{ bank_id: 'test-bank', fact_count: 1 }] })
    if (p.endsWith('/stats')) {
      // 场景 3：缺 total_links 字段
      if (scenario === 'missing-field') return send({ total_nodes: 10 })
      return send({ total_nodes: 10, total_links: 20 })
    }
    if (p.endsWith('/graph')) return send({ nodes: [], edges: [] })
    if (p.includes('/operations')) return send({ total: 0 })
    return send({}, 404)
  })
}

function runChecker(url) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CHECKER, '--url', url, '--timeout', '5000'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('close', (code) => resolve({ code, out }))
  })
}

async function withServer(scenario, fn) {
  const server = makeServer(scenario)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  try {
    return await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((r) => server.close(r))
  }
}

const results = []
function assert(name, cond, detail = '') {
  results.push({ name, ok: cond, detail })
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${detail ? '  ' + detail : ''}`)
}

async function main() {
  console.log('check-hindsight-compat 自检')
  console.log('')

  // 1. 合规服务 → 0
  await withServer('ok', async (url) => {
    const r = await runChecker(url)
    assert('合规服务应退出 0', r.code === 0, `实际 ${r.code}`)
    assert('应报告全部通过', /全部通过/.test(r.out))
    assert('不应有失败项', !/✗/.test(r.out))
  })

  // 2. 缺端点 → 1，且点名
  await withServer('missing-endpoint', async (url) => {
    const r = await runChecker(url)
    assert('缺端点应退出 1', r.code === 1, `实际 ${r.code}`)
    assert('应指出缺失的是 dry-run-extract', /dry-run-extract/.test(r.out) && /端点缺失/.test(r.out))
  })

  // 3. 缺字段 → 1，且点名
  await withServer('missing-field', async (url) => {
    const r = await runChecker(url)
    assert('缺字段应退出 1', r.code === 1, `实际 ${r.code}`)
    assert('应指出 total_links 缺失', /total_links/.test(r.out))
  })

  // 4. 不可达 → 2
  {
    const r = await runChecker('http://127.0.0.1:1')
    assert('不可达应退出 2', r.code === 2, `实际 ${r.code}`)
    assert('应提示服务不可达', /不可达/.test(r.out))
  }

  const failed = results.filter((x) => !x.ok)
  console.log('')
  if (failed.length) {
    console.log(`自检失败：${failed.length}/${results.length} 项不通过`)
    for (const f of failed) console.log(`  - ${f.name} ${f.detail}`)
    process.exit(1)
  }
  console.log(`自检通过：${results.length}/${results.length} 项`)
}

main().catch((e) => {
  console.error('自检脚本自身出错：' + e.message)
  process.exit(1)
})
