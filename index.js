/**
 * DSH-memory-nebula — host half.
 *
 * 面板由内置零依赖 server.js 提供。host 只负责确保服务在跑；
 * 面板 URL 由 client half 探测同一端口范围获得，端口冲突不破坏 iframe。
 *
 * 服务模式（server.js 内 MemoryEngine）：
 *   local      纯本地 JSONL 记忆引擎（NebulaMemory，零依赖，默认）
 *   hybrid     探测到 Hindsight 则叠加其 HTTP API 数据（检索增强 + 可视化）
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-nebula-memory'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER = path.join(__dirname, 'server.js')
const PORT_BASE = 8898
const PORT_TRIES = 13
const PREFIX = 'MEMORY_NEBULA_'

function resolveHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

function readConfig(home) {
  const file = process.env[`${PREFIX}CONFIG`] || path.join(home, 'memory-nebula.json')
  try {
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    console.warn(`[memory-nebula] cannot read ${file}: ${error.message}`)
  }
  return {}
}

function candidatePorts(configured) {
  const ports = []
  const preferred = Number(process.env[`${PREFIX}PORT`] || configured) || PORT_BASE
  ports.push(preferred)
  for (let i = 0; i < PORT_TRIES; i += 1) ports.push(PORT_BASE + i)
  return [...new Set(ports.filter((p) => Number.isInteger(p) && p > 0 && p < 65536))]
}

async function probe(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1200) })
    if (!res.ok) return false
    const json = await res.json()
    return json && json.service === 'dsh-nebula-memory'
  } catch {
    return false
  }
}

export function apply(ctx) {
  ctx.effect(() => {
    let cancelled = false
    const home = resolveHome()
    const cfg = readConfig(home)
    const ports = candidatePorts(cfg.port)
    // 防止看门狗与首次 ensure 同时拉起两个 sidecar（间隔内只允许一次 spawn）
    let lastSpawnAt = 0

    const ensure = async () => {
      for (const port of ports) {
        if (await probe(port)) return
        if (cancelled) return
      }

      if (!existsSync(SERVER)) {
        console.warn('[memory-nebula] server.js is missing; panel will show a connection error')
        return
      }

      if (Date.now() - lastSpawnAt < 20000) return
      lastSpawnAt = Date.now()
      try {
        mkdirSync(home, { recursive: true })
        const log = openSync(path.join(home, 'memory-nebula.log'), 'a')
        const env = {
          ...process.env,
          // process.execPath is the DeepSeek Harness Electron binary when the
          // plugin runs inside the app; this flag makes it execute as Node.
          ELECTRON_RUN_AS_NODE: '1',
          [`${PREFIX}PORT`]: String(ports[0]),
          [`${PREFIX}DATA_DIR`]: String(process.env[`${PREFIX}DATA_DIR`] || cfg.dataDir || path.join(home, 'memory-nebula-data')),
          // 安装器把真实 Hindsight 根目录写入用户级 memory-nebula.json；
          // 环境变量优先，空值保持空值，让 server 明确降级为「未知」。
          [`${PREFIX}HINDSIGHT_DIR`]: String(process.env[`${PREFIX}HINDSIGHT_DIR`] || cfg.hindsightDir || ''),
          DSH_HOME: home,
        }
        const child = spawn(process.execPath || 'node', [SERVER], {
          cwd: __dirname,
          env,
          detached: true,
          stdio: ['ignore', log, log],
          windowsHide: true,
        })
        child.on('error', (error) => console.warn('[memory-nebula] cannot start server:', error.message))
        child.unref()
      } catch (error) {
        console.warn('[memory-nebula] cannot start server:', error.message)
      }
    }

    const safeEnsure = () => ensure().catch((error) => console.warn('[memory-nebula] ensure failed:', error.message))
    safeEnsure()

    // 看门狗：sidecar 是 detached 子进程，被结束（或崩溃）之后 host 原先不会再管它，
    // 面板就一直打不开、还看不到任何报错 —— 只能重启 DSH 才行。
    // 这里每 20s 复查一次：probe 探不到就重新拉起（幂等，活着时只是一次健康探测）。
    const timer = setInterval(() => { if (!cancelled) safeEnsure() }, 20000)
    if (timer.unref) timer.unref()

    return () => {
      // Keep the detached server alive across panel reloads; uninstall.ps1
      // stops it explicitly.
      cancelled = true
      clearInterval(timer)
    }
  }, 'memory-nebula: ensure local server')
}
