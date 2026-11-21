/**
 * key-vault.mjs — 用 Windows DPAPI 加密保存 Hindsight API Key。
 *
 * 为什么不明文存：key 是凭据，明文落盘后一旦目录被同步/打包/截图就会泄露。
 * DPAPI（CurrentUser 作用域）让密文只有**同一台机器的同一个 Windows 用户**能解开：
 * 拷到别的机器或别的用户下解密会失败，等于自动失效。
 *
 * 实现方式：调用系统自带 PowerShell 的 ProtectedData（无需第三方依赖、
 * 无需编译原生模块），密文以 base64 存在插件自己的配置文件里。
 *
 * 非 Windows 平台：marker 文件不生成，读写都安全降级为"不可持久化"。
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'

const IS_WIN = process.platform === 'win32'

/** 密文文件路径：放在 DSH_HOME 下，与 memory-nebula.json 同级但独立文件 */
export function vaultPath(home) {
  return path.join(home || process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'memory-nebula.key')
}

function runPowerShell(script, payload) {
  // 用 stdin 传数据：-Command 的剩余参数会被当成命令的一部分，不能可靠当 argv 用。
  const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    input: String(payload == null ? '' : payload),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
  })
  if (res.error) throw res.error
  if (res.status !== 0) throw new Error((res.stderr || 'powershell failed').trim().slice(0, 300))
  return (res.stdout || '').trim()
}

const ENC_SCRIPT = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$in = [Console]::In.ReadToEnd()
$plain = [Text.Encoding]::UTF8.GetBytes($in)
$cipher = [Security.Cryptography.ProtectedData]::Protect($plain, $null, 'CurrentUser')
[Convert]::ToBase64String($cipher)
`

const DEC_SCRIPT = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$b64 = [Console]::In.ReadToEnd().Trim()
$cipher = [Convert]::FromBase64String($b64)
$plain = [Security.Cryptography.ProtectedData]::Unprotect($cipher, $null, 'CurrentUser')
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))
`

/** 加密并写入。返回 true 表示已持久化；非 Windows 返回 false。 */
export function saveKey(home, plainKey) {
  if (!IS_WIN) return false
  const key = String(plainKey || '').trim()
  const file = vaultPath(home)
  if (!key) {
    try { if (fs.existsSync(file)) fs.unlinkSync(file) } catch { /* ignore */ }
    return false
  }
  const b64 = runPowerShell(ENC_SCRIPT, key)
  if (!b64) throw new Error('DPAPI encrypt returned empty')
  // 密文是 base64，可直接存文本；目录权限保持默认（DSH_HOME 用户私有）
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, b64 + '\n', 'utf8')
  return true
}

/** 读取并解密。文件不存在返回 ''；解密失败（换了机器/用户）返回 '' 且不抛错。 */
export function loadKey(home) {
  if (!IS_WIN) return ''
  const file = vaultPath(home)
  try {
    if (!fs.existsSync(file)) return ''
    const b64 = fs.readFileSync(file, 'utf8').trim()
    if (!b64) return ''
    const plain = runPowerShell(DEC_SCRIPT, b64)
    return String(plain || '').trim()
  } catch {
    // 换机器/换用户后 DPAPI 解不开，属于预期：当成没配置，让用户重新输入
    return ''
  }
}

/** 是否已有可用的加密记录（不解密，只判断文件存在且非空） */
export function hasSavedKey(home) {
  if (!IS_WIN) return false
  try {
    const file = vaultPath(home)
    return fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim().length > 0
  } catch { return false }
}

/** 删除已保存的 key */
export function clearKey(home) {
  try {
    const file = vaultPath(home)
    if (fs.existsSync(file)) fs.unlinkSync(file)
    return true
  } catch { return false }
}

export const supported = IS_WIN
