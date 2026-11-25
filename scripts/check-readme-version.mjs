#!/usr/bin/env node
/**
 * 发版前检查：README 里手写的版本表是否与 package.json 一致。
 *
 * 背景：README 有两张手写的版本表（开头「版本线」和「版本说明」章节的概览表），
 * release-it 不会更新它们。2.0.1 和 2.0.2 两次发版后两张表都还停在 2.0.0，
 * 直到有人翻 README 才发现。只靠文档里写「记得改」不够，这里做成检查。
 *
 * 用法：
 *   node scripts/check-readme-version.mjs          只提示（默认，不阻断）
 *   node scripts/check-readme-version.mjs --strict 不一致即非零退出（阻断发版）
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const STRICT = process.argv.includes('--strict')
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(file) {
  try {
    return readFileSync(path.join(REPO_ROOT, file), 'utf8')
  } catch {
    return null
  }
}

const pkg = JSON.parse(read('package.json'))
const version = pkg.version
const readme = read('README.md')

if (!readme) {
  console.log('[readme-version] 找不到 README.md，跳过')
  process.exit(0)
}

// 只匹配「DSH 插件」那一行：另外三条版本线各不相同，不能一起比对。
const rowRe = /^\|\s*1\s*\|\s*\*\*DSH 插件\*\*\s*`dsh-nebula-memory`\s*\|\s*\*\*([^*]+)\*\*/gm
const found = [...readme.matchAll(rowRe)].map((m) => m[1].trim())

if (found.length === 0) {
  console.log('[readme-version] README 里没有找到「DSH 插件」版本行，跳过')
  process.exit(0)
}

const stale = found.filter((v) => v !== version)
const count = found.length

if (stale.length === 0) {
  console.log(`[readme-version] README 的 ${count} 处版本表均为 ${version}，与 package.json 一致`)
  process.exit(0)
}

const lines = [
  '',
  `[readme-version] README 版本表与 package.json 不一致：`,
  `  package.json: ${version}`,
  ...stale.map((v, i) => `  README 第 ${i + 1} 处: ${v}`),
  '',
  'README 的版本表是手写的，release-it 不会更新。发版后请手动同步',
  '（两处都要改，见 CONTRIBUTING.md「发版时必须同步 README 的版本表」）。',
  '',
]
console.log(lines.join('\n'))

if (STRICT) {
  console.error('[readme-version] --strict 模式下阻断。')
  process.exit(1)
}
console.log('[readme-version] 仅提示，不阻断。')
