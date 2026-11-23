'use strict';

/**
 * profile-recall.cjs — 画像反哺查询（个人化问题的语义补偿）
 *
 * 问题：用户问「我孩子多大了？」，答案在画像记忆里（「孩子上二年级」），
 *       但 query 与记忆的词面几乎不重叠，bigram 召不回。
 *
 * 解法：**用已有的画像/摘要节点反哺 query** ——
 *   1. 找出库里的 profile 层节点（kind=profile 或 layer=summary）
 *   2. 检查 query 是否命中「个人化询问」模式（我/我的/孩子/偏好/习惯…）
 *   3. 命中则把画像节点的关键词拼进检索 token，让相关记忆浮上来
 *
 * 实测依据（2026-11-23）：far 档（纯语义）本地只有 33.3%，
 * 其中「我孩子多大了」「我平时喝咖啡有什么讲究」这类个人问题占比高。
 *
 * 设计原则：
 *   - 只对**个人化提问**生效，避免污染普通查询
 *   - 反哺词有上限（默认 12 个），防止 query 被画像淹没
 *   - 可关闭：options.profileBoost === false
 */

/** 个人化询问的触发模式（问「关于我」的事） */
const PERSONAL_PATTERNS = [
  /我(的)?(孩子|儿子|女儿|小朋友|娃|小孩)/,
  /我(平时|平常|周末|日常)/,
  /我(喜欢|偏好|习惯|爱好)/,
  /我(用|在|住|去)/,
  /我(的)?(账号|密码|凭据|密钥|key)/,
  /我(有|要|得)(什么|哪些)/,
  /(孩子|儿子|女儿|小朋友|娃)(多大|几岁|在哪|喜欢什么)/,
  /(我的)?(偏好|习惯|爱好)(是什么|有哪些)/,
  /(我家|公司|团队)(的)?/,
];

/** 判断 query 是否是个人化提问 */
function isPersonalQuery(query) {
  if (!query) return false;
  const q = String(query);
  return PERSONAL_PATTERNS.some((re) => re.test(q));
}

/**
 * 收集库里的画像/摘要节点文本（最多 N 条，按 importance 降序）。
 * @param {any} mem NebulaMemory 实例
 * @param {number} [maxNodes=3]
 */
function collectProfileNodes(mem, maxNodes = 3) {
  const out = [];
  for (const node of mem.nodes.values()) {
    if (!node || node.deleted) continue;
    const isProfile = node.kind === 'profile' || node.layer === 'summary'
      || (node.meta && node.meta.summary)
      || (node.kind === 'fact' && Number(node.importance) >= 0.9);
    if (!isProfile) continue;
    out.push(node);
  }
  out.sort((a, b) => Number(b.importance || 0) - Number(a.importance || 0) || b.ts - a.ts);
  return out.slice(0, maxNodes);
}

/**
 * 为个人化 query 生成反哺词。
 *
 * @param {any} mem
 * @param {string} query
 * @param {{maxTokens?:number, maxNodes?:number, enabled?:number}} [opts]
 * @returns {{boosted:boolean, reason:string, tokens:string[]}}
 */
function boostPersonalQuery(mem, query, opts = {}) {
  const enabled = opts.enabled !== false;
  const maxTokens = Math.max(1, Math.floor(opts.maxTokens == null ? 12 : opts.maxTokens));
  const maxNodes = Math.max(1, Math.floor(opts.maxNodes == null ? 3 : opts.maxNodes));

  if (!enabled) return { boosted: false, reason: 'disabled', tokens: [] };
  if (!isPersonalQuery(query)) return { boosted: false, reason: 'not-personal', tokens: [] };

  const nodes = collectProfileNodes(mem, maxNodes);
  if (!nodes.length) return { boosted: false, reason: 'no-profile', tokens: [] };

  // 从画像节点文本里抽关键词（用简单的二元切分 + 过滤停用词）
  const STOP = new Set(['的', '了', '是', '在', '有', '和', '与', '我', '你', '他', '她', '这', '那', '就', '也', '都', '很', '个', '上', '下', '中', '为', '对', '从', '到', '把', '被', '让', '给', '但', '而', '或', '如果', '因为', '所以', '一个', '我们', '你们', '他们']);
  const tokens = [];
  const seen = new Set();
  for (const node of nodes) {
    const text = String(node.text || '');
    // 中文按 2-4 字滑窗取词组（比单字有区分度，比整句更可匹配）
    for (const seg of text.split(/[，。；：、\s\n|（）()\[\]【】"'"'']+/)) {
      if (seg.length < 2) continue;
      // 取 2 字、3 字、4 字片段（去重）
      for (const len of [4, 3, 2]) {
        for (let i = 0; i + len <= seg.length; i++) {
          const tk = seg.slice(i, i + len);
          if (STOP.has(tk) || seen.has(tk)) continue;
          // 过滤纯数字/纯标点
          if (!/[\u4e00-\u9fa5A-Za-z]/.test(tk)) continue;
          seen.add(tk);
          tokens.push(tk);
          if (tokens.length >= maxTokens) {
            return { boosted: true, reason: 'personal', tokens };
          }
        }
      }
    }
  }
  return { boosted: tokens.length > 0, reason: 'personal', tokens };
}

module.exports = { isPersonalQuery, collectProfileNodes, boostPersonalQuery, PERSONAL_PATTERNS };
