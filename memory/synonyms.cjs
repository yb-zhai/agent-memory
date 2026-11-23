'use strict';

/**
 * synonyms.cjs — 中文同义词/上下位词扩展（本地引擎的语义补偿）
 *
 * 定位：本地引擎是 bigram 词面匹配，做不到跨表述联想（「供应商」↔「铸造厂」）。
 * 完整的语义检索是 Hindsight 的职责，但**固定的词级对应关系**不值得动用 LLM ——
 * 用一份小而精的词典就能补上，且不破坏「零依赖」。
 *
 * 实测依据（2026-11-23，22 题跨表述测试）：
 *   near（词面重叠） 87.5% → 同义词对其影响小
 *   mid （同义/上下位）37.5% → 主要受益者
 *   far （纯语义）   33.3% → 部分受益
 *
 * 设计原则：
 *   - 双向映射：A→B 与 B→A 同时生效（「供应商」和「铸造厂」互扩）
 *   - 只扩一级：不做传递闭包，避免语义漂移（A→B→C 会发散）
 *   - 可关闭：options.expandSynonyms === false 时不扩展
 *   - 可追加：用户可通过 setUserSynonyms() 加自己的行业词
 */

/** 内置词典：按「概念组」组织，同组内互相扩展 */
const CONCEPT_GROUPS = [
  // 商业关系
  ['供应商', '客户', '厂家', '厂商', '铸造厂', '工厂', '合作方'],
  // 凭据
  ['凭据', '密码', '口令', '密钥', 'key', 'token', '凭证'],
  // 部署
  ['上线', '部署', '发布', 'deploy', 'deliver', '投产'],
  // 人物
  ['孩子', '小朋友', '儿子', '女儿', '娃', '小孩'],
  // 学习/教育
  ['上学', '就读', '学校', '小学', '中学', '大学'],
  // 饮品
  ['咖啡', '手冲', '意式', '拿铁', '美式', '冲煮'],
  // 数据存储
  ['数据库', 'DB', 'PG', 'PostgreSQL', 'MySQL', '存储'],
  // 问题/故障
  ['故障', '报错', '异常', '问题', 'bug', '错误', '崩溃'],
  // 解决
  ['解决', '修复', '处理', '搞定', '修好', '排查'],
  // 任务/待办
  ['任务', '待办', 'todo', '事项', '安排'],
  // 计划/日程
  ['下周', '下星期', '下礼拜'],
  ['截止', '到期', 'deadline', '交付'],
  // 位置
  ['地址', '位置', '地点', '在哪'],
  // 时间感知
  ['之前', '上次', '刚才', '以前', '上次那个'],
  ['现在', '当前', '目前', '如今'],
  // 偏好
  ['偏好', '喜欢', '倾向', '喜好', '习惯'],
  // 说明/记录
  ['记录', '记下', '备忘', '笔记', 'notes'],
];

/** 词 → 同组其他词（不含自身），构建时展开 */
function buildIndex(groups) {
  const idx = new Map();
  for (const g of groups) {
    for (const w of g) {
      const key = String(w).toLowerCase();
      if (!idx.has(key)) idx.set(key, new Set());
      for (const other of g) {
        if (other !== w) idx.get(key).add(other);
      }
    }
  }
  return idx;
}

let INDEX = buildIndex(CONCEPT_GROUPS);
let USER_GROUPS = [];

/**
 * 从 query 中找出可扩展的词，返回扩展后的词列表（含原 query 词）。
 * 注意：不修改原 query 字符串，而是返回「额外要检索的 token」。
 *
 * @param {string} query
 * @param {{maxExpansions?:number, enabled?:boolean}} [opts]
 * @returns {{query:string, expansions:string[], matched:string[]}}
 */
function expandQuery(query, opts = {}) {
  const enabled = opts.enabled !== false;
  const maxExp = Math.max(0, Math.floor(opts.maxExpansions == null ? 24 : opts.maxExpansions));
  if (!enabled || !query || maxExp === 0) {
    return { query, expansions: [], matched: [] };
  }

  const q = String(query);
  const qLower = q.toLowerCase();
  /** @type {string[]} */
  const expansions = [];
  /** @type {string[]} */
  const matched = [];
  const seen = new Set();

  for (const [key, alts] of INDEX) {
    // 用 includes 做子串匹配（中文词短，避免分词差异导致漏配）
    if (!qLower.includes(key)) continue;
    matched.push(key);
    for (const alt of alts) {
      const a = String(alt);
      if (seen.has(a) || qLower.includes(a.toLowerCase())) continue;  // 已在原 query 里就不重复加
      seen.add(a);
      expansions.push(a);
      if (expansions.length >= maxExp) return { query: q, expansions, matched };
    }
  }

  return { query: q, expansions, matched };
}

/**
 * 用户自定义同义词组（如行业术语）。追加到内置词典之上。
 * @param {string[][]} groups
 */
function setUserSynonyms(groups) {
  if (!Array.isArray(groups)) return;
  USER_GROUPS = groups.filter((g) => Array.isArray(g) && g.length >= 2);
  INDEX = buildIndex([...CONCEPT_GROUPS, ...USER_GROUPS]);
}

/** 当前词典规模（诊断用） */
function stats() {
  return {
    concepts: CONCEPT_GROUPS.length + USER_GROUPS.length,
    keys: INDEX.size,
    userGroups: USER_GROUPS.length,
  };
}

module.exports = { expandQuery, setUserSynonyms, stats, CONCEPT_GROUPS };
