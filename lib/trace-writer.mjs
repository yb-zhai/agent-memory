/**
 * trace-writer.mjs — 把 Hindsight 召回写回 brain.recall_trace（补齐 legacy 链路断掉的赫布数据源）。
 *
 * 背景：brain.recall_trace 原先只由 legacy live_server（E:\harness\scripts\brain_engine.py）写入；
 * 11-05 面板切到 Hindsight API(8888) 后该表再无写入，导致：
 *   recall_trace 停更 → brain_dynamics.py 的 hebb 无共激活数据 → synapse_state 冻结 → prune 空转。
 *
 * 本模块在每次召回成功后异步补写一行，字段格式对齐 legacy 原表（seeds/activated/results/meta），
 * 让 brain_dynamics.py 的 hebb / prune 立刻恢复工作。**失败绝不影响召回主链路**。
 *
 * 依赖：psql 客户端（Hindsight 自带 PostgreSQL 的 bin）。无 psql 时静默降级。
 */

import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

/** 默认 psql 路径（Hindsight 自带 PostgreSQL）。可用环境变量覆盖。 */
const PSQL_CANDIDATES = [
  process.env.MEMORY_NEBULA_PSQL,
  'E:\\hindsight\\pg0\\bin\\psql.exe',
  'E:\\hindsight\\pgsql\\bin\\psql.exe',
].filter(Boolean)

/** pg0 的 psql 带版本号目录（installation/<ver>/bin/psql.exe），运行时探测，避免升级后失效。 */
function findPsql() {
  for (const p of PSQL_CANDIDATES) if (existsSync(p)) return p
  const root = process.env.MEMORY_NEBULA_PG0 || 'E:\\hindsight\\pg0\\installation'
  try {
    const vers = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse() // 新版本优先
    for (const v of vers) {
      const p = path.join(root, v, 'bin', 'psql.exe')
      if (existsSync(p)) return p
    }
  } catch { /* 忽略 */ }
  return null
}

const DSN = process.env.MEMORY_NEBULA_PG_DSN || 'postgresql://hindsight:hindsight@127.0.0.1:5432/hindsight'

/** 写一行 trace。fn 调用方不要 await，本函数自带并发与错误吸收。 */
export class TraceWriter {
  constructor(cfg = {}, log = () => {}) {
    this.enabled = cfg.traceWrite !== false
    this.log = log
    this.psql = findPsql()
    this.inflight = 0
    this.maxInflight = 2
    this.failures = 0
    this.written = 0
    if (this.enabled && !this.psql) {
      this.log('[trace] psql not found; recall_trace writing disabled')
      this.enabled = false
    }
  }

  get status() {
    return {
      enabled: this.enabled,
      psql: this.psql || null,
      written: this.written,
      failures: this.failures,
      inflight: this.inflight,
    }
  }

  /**
   * Hindsight 召回结果 → 一行 recall_trace。
   * @param {string} query
   * @param {any} hs  Hindsight /memories/recall 的响应 {results:[{id,scores:{final,...}}]}
   * @param {number} latencyMs
   * @param {any} [localFragments] 本地召回片段（写入 results 便于对比）
   */
  write(query, hs, latencyMs, localFragments = null) {
    if (!this.enabled || !hs) return
    const rows = Array.isArray(hs.results) ? hs.results : []
    if (!rows.length) return
    if (this.inflight >= this.maxInflight) return // 背压：宁可丢 trace 也不堆积

    // activated：hebb 就是读这个字段算共激活（{id, act}）
    const activated = rows.map((r) => ({
      id: r?.id,
      act: Number(r?.scores?.final ?? r?.scores?.reranker ?? 0) || 0,
    })).filter((x) => x.id)

    // seeds：取 final 最高的前 8 条（legacy 口径）
    const seeds = activated.slice().sort((a, b) => b.act - a.act).slice(0, 8).map((x) => ({ id: x.id, sim: x.act }))

    const results = rows.slice(0, 30).map((r) => ({
      id: r?.id,
      score: Number(r?.scores?.final ?? 0) || 0,
      sim: Number(r?.scores?.semantic ?? 0) || 0,
      ce: Number(r?.scores?.reranker ?? 0) || 0,
      text: String(r?.text ?? '').slice(0, 200),
    }))

    const meta = {
      source: 'dsh-nebula-memory',
      arm: 'hindsight',
      latencyMs: Math.round(Number(latencyMs) || 0),
      candidates: rows.length,
      localFragments: Array.isArray(localFragments) ? localFragments.length : 0,
      weights: null, // Hindsight 侧权重由它自己管，这里不伪造
    }

    this._exec(query, seeds, activated, results, meta)
  }

  _exec(query, seeds, activated, results, meta) {
    this.inflight++
    const latencyMs = Math.round(Number(meta.latencyMs) || 0)
    const sql =
      'INSERT INTO brain.recall_trace (query, seeds, activated, latency_ms, results, meta) VALUES (' +
      [
        q(query),
        `${q(JSON.stringify(seeds))}::jsonb`,
        `${q(JSON.stringify(activated))}::jsonb`,
        String(latencyMs),
        `${q(JSON.stringify(results))}::jsonb`,
        `${q(JSON.stringify(meta))}::jsonb`,
      ].join(', ') +
      ');'

    let child
    try {
      child = spawn(this.psql, [DSN, '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql], {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      })
    } catch (e) {
      this.inflight--
      this.failures++
      this.log(`[trace] spawn failed: ${e.message}`)
      return
    }
    let err = ''
    child.stderr.on('data', (b) => { err += b.toString('utf8') })
    child.on('error', (e) => {
      this.inflight--
      this.failures++
      this.log(`[trace] error: ${e.message}`)
    })
    child.on('close', (code) => {
      this.inflight--
      if (code === 0) {
        this.written++
      } else {
        this.failures++
        if (this.failures <= 3) this.log(`[trace] psql exit=${code}: ${err.slice(0, 200)}`)
      }
    })
  }
}

/** Postgres 字符串字面量转义（单引号 doubling）。 */
function q(s) {
  return `'${String(s).replace(/'/g, "''")}'`
}
