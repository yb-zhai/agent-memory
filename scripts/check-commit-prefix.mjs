#!/usr/bin/env node
/**
 * 发版前检查：检测「加了开关/配置项」却用了 feat: 前缀的提交。
 *
 * 背景：按本项目的版本规则，给已有功能加开关属于 Patch，应使用 fix: 前缀。
 * 若写成 feat:，release-it 会推出 Minor，与实际发布意图不符（1.4.1 遇到过）。
 *
 * 用法：
 *   node scripts/check-commit-prefix.mjs          只提示（默认，不阻断）
 *   node scripts/check-commit-prefix.mjs --strict 命中即非零退出（阻断发版）
 *
 * 在 .release-it.json 的 hooks.before:init 中调用。
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const STRICT = process.argv.includes('--strict')

// 脚本位于 <repo>/scripts/，仓库根是上一级。
// 显式指定，避免依赖调用方的当前工作目录；也便于在别的仓库上测试。
const repoArgIdx = process.argv.indexOf('--repo')
const REPO_ROOT = path.resolve(
  repoArgIdx > -1 && process.argv[repoArgIdx + 1]
    ? process.argv[repoArgIdx + 1]
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
)

/** 判定为「给已有功能加开关/配置项」的关键词 */
const FEATURE_TOGGLE_WORDS = [
  '开关',
  '配置项',
  '配置开关',
  '可选参数',
  'toggle',
  'switch',
  'feature flag',
  'option',
  'env var',
  '环境变量',
]

function git(args) {
  try {
    return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

/** 上一个 tag；没有 tag 时返回空（表示全历史） */
function lastTag() {
  return git(['describe', '--tags', '--abbrev=0'])
}

/** 取待发布提交：上一 tag..HEAD；无 tag 则取最近 50 条 */
function commitsToCheck() {
  const tag = lastTag()
  const range = tag ? [`${tag}..HEAD`] : ['-50']
  const out = git(['log', '--format=%H%x1f%s', ...range])
  if (!out) return []
  return out
    .split('\n')
    .map((line) => {
      const [hash, subject] = line.split('\x1f')
      return { hash: (hash || '').trim(), subject: (subject || '').trim() }
    })
    .filter((c) => c.hash)
}

/** 是否用了 feat: 前缀（含 feat(scope): 与 feat!:） */
function isFeat(subject) {
  return /^feat(\([^)]*\))?!?:/i.test(subject)
}

/** 标题是否包含开关/配置类关键词 */
function looksLikeToggle(subject) {
  const lower = subject.toLowerCase()
  return FEATURE_TOGGLE_WORDS.some((w) => lower.includes(w.toLowerCase()))
}

function main() {
  const commits = commitsToCheck()
  const tag = lastTag()
  const scope = tag ? `${tag}..HEAD` : '最近 50 条提交'

  if (commits.length === 0) {
    console.log(`[commit-prefix] 检查范围 ${scope}：没有待发布提交，跳过`)
    return 0
  }

  const offenders = commits.filter((c) => isFeat(c.subject) && looksLikeToggle(c.subject))

  if (offenders.length === 0) {
    console.log(`[commit-prefix] 检查范围 ${scope}（${commits.length} 条）：未发现前缀误用`)
    return 0
  }

  const lines = [
    '',
    `[commit-prefix] 发现 ${offenders.length} 条可能用错前缀的提交：`,
    '',
    ...offenders.map((c) => `  ${c.hash.slice(0, 8)}  ${c.subject}`),
    '',
    '这些提交包含「开关 / 配置项」类关键词，但用了 feat: 前缀。',
    '按本项目的版本规则，给已有功能加开关属于 Patch，应使用 fix: 前缀 ——',
    '否则 release-it 会推出 Minor，与实际发布意图不符。',
    '',
    '处理方式（任选其一）：',
    '  1. 确认是 Patch：把提交信息改成 fix: 前缀（未推送时用 git commit --amend）',
    '  2. 确认确实是新增功能：忽略本提示，继续发版',
    '',
  ]
  console.log(lines.join('\n'))

  if (STRICT) {
    console.error('[commit-prefix] --strict 模式下阻断发版。')
    return 1
  }
  console.log('[commit-prefix] 仅提示，不阻断发版。')
  return 0
}

process.exit(main())
