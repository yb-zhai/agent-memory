#!/usr/bin/env node
/**
 * 编码自检：检查文件是「UTF-8 带 BOM」还是「无 BOM」，并报告行尾。
 *
 * 为什么需要它：
 *   本项目有一类**必须带 BOM** 的文件 —— `*.ps1`。原因是 PowerShell 5.1 读
 *   无 BOM 的 UTF-8 脚本时会按系统 ANSI 代码页（中文 Windows 上是 GBK）解析，
 *   脚本里的中文注释会变乱码，进而吃掉后面的括号，报出「Unexpected token '}'」
 *   这种和注释毫无关系的语法错误。
 *
 *   实测过：给 install.ps1 加几行中文注释，编辑器把 BOM 去掉后，
 *   `powershell -File install.ps1 -DryRun` 直接语法报错，而
 *   PSParser::Tokenize 却报 0 错误 —— 两个工具结论相反，很容易误判成「没问题」。
 *
 *   所以判断标准是「文件首字节」，不是语法检查，也不是肉眼看代码。
 *
 * 用法：
 *   node scripts/check-encoding.mjs            检查仓库内应受管的文件（默认）
 *   node scripts/check-encoding.mjs --strict   有违规就非零退出（可用于提交前 / CI）
 *   node scripts/check-encoding.mjs --all      连行尾一起严格校验
 *
 * 退出码：0 = 通过；1 = 有违规（仅 --strict 时）
 */
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const STRICT = process.argv.includes('--strict')
const CHECK_EOL = process.argv.includes('--all')

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)

/**
 * 编码约定：BOM 期望值 + 行尾期望值。
 * 行尾以「仓库内存储格式」为准（工作区受 core.autocrlf 影响会是 CRLF，不作为判据）。
 */
const RULES = [
  // PowerShell 脚本：必须带 BOM，否则中文注释会让 PowerShell 5.1 解析失败
  { glob: /\.ps1$/i, bom: true, eol: 'LF', why: 'PowerShell 5.1 无 BOM 会按 GBK 解析中文，导致语法错误' },
  // 其余源码与文档：无 BOM
  { glob: /\.(mjs|cjs|js|html)$/i, bom: false, eol: 'LF', why: '源码统一无 BOM + LF' },
  { glob: /\.md$/i, bom: false, eol: null, why: '文档统一无 BOM（行尾不强制：Markdown 渲染与行尾无关）' },
  { glob: /\.cmd$/i, bom: false, eol: 'LF', why: '批处理统一无 BOM + LF' },
  { glob: /(^|\/)package\.json$/, bom: false, eol: 'LF', why: 'package.json 无 BOM，否则部分工具解析失败' },
]

/** 是否受管（只看仓库里的这些路径） */
function shouldCheck(rel) {
  if (rel.includes('node_modules/')) return false
  if (rel.startsWith('.')) return false
  for (const r of RULES) if (r.glob.test(rel)) return r
  return null
}

function listTrackedFiles() {
  try {
    const out = execFileSync('git', ['-C', REPO_ROOT, 'ls-files'], { encoding: 'utf8' })
    return out.split('\n').map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

function detectEol(buf) {
  let crlf = 0
  let lf = 0
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) {
      if (i > 0 && buf[i - 1] === 0x0d) crlf++
      else lf++
    }
  }
  if (crlf === 0 && lf === 0) return 'NONE'
  if (crlf === 0) return 'LF'
  if (lf === 0) return 'CRLF'
  return 'MIXED'
}

function hasBom(buf) {
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
}

function main() {
  const files = listTrackedFiles()
  if (!files.length) {
    console.error('无法读取 git 文件列表（是否在仓库根目录下运行？）')
    process.exit(2)
  }

  const problems = []
  let checked = 0

  for (const rel of files) {
    const rule = shouldCheck(rel)
    if (!rule) continue
    const abs = path.join(REPO_ROOT, rel)
    if (!existsSync(abs)) continue

    // BOM 必须查**工作区**文件：编辑器去 BOM 影响的就是工作区，这正是要拦的问题。
    // 行尾则以仓库存储格式为准（工作区受 core.autocrlf 影响会是 CRLF，不作为判据）。
    const workBuf = readFileSync(abs)
    if (!workBuf.length) continue

    checked++

    const bom = hasBom(workBuf)
    if (bom !== rule.bom) {
      problems.push({
        rel,
        kind: rule.bom ? '缺少 BOM' : '多余 BOM',
        detail: rule.bom
          ? `应为 UTF-8 BOM，实际无 BOM —— ${rule.why}`
          : `${rule.why}`,
        fix: rule.bom
          ? `用带 BOM 的 UTF-8 重写：${rel}`
          : `去掉文件开头的 3 字节 BOM：${rel}`,
      })
    }

    if (CHECK_EOL && rule.eol) {
      // 行尾判据取「仓库内格式」；新文件尚未提交时 HEAD 里没有它，
      // 这时退回工作区内容，并跳过该文件的判断，避免把工作区 CRLF 误报成问题。
      let repoBuf = null
      try {
        repoBuf = execFileSync('git', ['-C', REPO_ROOT, 'show', `HEAD:${rel}`], {
          maxBuffer: 64 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'ignore'],
        })
      } catch {
        repoBuf = null
      }
      if (!repoBuf) continue // 新文件未入库：跳过行尾检查（BOM 已查过）

      const eol = detectEol(repoBuf)
      if (eol !== rule.eol) {
        problems.push({
          rel,
          kind: `仓库内行尾为 ${eol}`,
          detail: `期望 ${rule.eol}（查的是 git 里存的格式，工作区 CRLF 属正常）`,
          fix: `统一为 ${rule.eol}：${rel}`,
        })
      }
    }
  }

  if (!problems.length) {
    console.log(`编码自检通过：${checked} 个文件${CHECK_EOL ? '（含行尾）' : ''}符合约定。`)
    return
  }

  console.error(`编码自检发现 ${problems.length} 处问题：\n`)
  for (const p of problems) {
    console.error(`  ${p.rel}`)
    console.error(`    问题：${p.kind}`)
    console.error(`    说明：${p.detail}`)
    console.error(`    修法：${p.fix}\n`)
  }

  if (STRICT) process.exit(1)
  console.error('（未加 --strict，仅提示，不阻断）')
}

main()
