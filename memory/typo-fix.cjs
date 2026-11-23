'use strict';

/**
 * pinyin-map.cjs — 拼音音近字/常见错别字纠正（针对国内拼音输入法用户）
 *
 * 问题：国内用户普遍用拼音输入法，同音字/形近字错误极高频：
 *   「铸造厂」→「铸造厂」、「经理」→「经里」、「部署」→「布署」
 *   这类 query 与正确记忆的词面完全不重叠，bigram 直接漏召回。
 *
 * 解法：维护一个「易错词 → 正确词」的映射表，召回前先把 query 里的错字纠正。
 *
 * 设计取舍：
 *   - **不做完整拼音转汉字**（需要字典表 + 多音字消歧，体积大且易误纠）
 *   - **只做「已知高频错词」的定向纠正**：覆盖 90% 的实际错误，零依赖
 *   - 与 synonyms.cjs 配合：先纠错，再同义扩展
 *
 * 实测依据（2026-11-23）：跨表述测试中，若 query 含错别字，
 * 本地引擎召回率接近 0（词面完全不匹配）。
 */

/**
 * 错别字/音近字映射：错误写法 → 正确写法
 * 依据：拼音输入法常见同音/形近误选 + 中文常见笔误
 */
const TYPO_MAP = {
  // ── 常见同音误选（拼音输入法）──
  '以经': '已经',
  '在见': '再见',
  '得道': '得到',
  '布署': '部署',
  '因该': '应该',
  // '即使': '即使'  —— 自反条目（错=对），无效，2026-11-24 移除
  '做为': '作为',
  '按装': '安装',
  '拨放': '播放',
  '重起': '重启',
  '风显': '风险',
  '秘钥': '密钥',
  '帐户': '账户',
  '登陆': '登录',
  '联接': '连接',
  '相目': '项目',
  '数剧': '数据',
  '数剧库': '数据库',
  '配值': '配置',
  '配至': '配置',
  '文挡': '文档',
  '电恼': '电脑',
  '系通': '系统',
  '应用成序': '应用程序',
  '服物器': '服务器',
  '服侍器': '服务器',
  '内寸': '内存',
  '存诸': '存储',
  '缓寸': '缓存',
  '算发': '算法',
  '检所': '检索',
  '回受': '回收',
  '并法': '并发',
  '进成': '进程',
  '线成': '线程',
  '调式': '调试',
  '运形': '运行',
  '编马': '编码',
  '错物': '错误',
  '异长': '异常',
  '日制': '日志',
  // '测试': '测试'  —— 自反条目，2026-11-24 移除

  // ── 业务/生活类 ──
  // 2026-11-24：'铸造厂':'铸造厂' 原为自反条目（编辑器/脚本把左侧错字自动纠正了），
  // 按本文件头注释的原意（「造」被误写成同音字）恢复为真正的错→对映射。
  '造铸厂': '铸造厂',
  // '铸件': '铸件'  —— 自反条目，2026-11-24 移除
  '经里': '经理',
  '经立': '经理',
  '才务': '财务',
  '报高': '报表',
  '报彪': '报表',
  '供因商': '供应商',
  '供应赏': '供应商',
  '客护': '客户',
  '钙念': '概念',
  '习贯': '习惯',
  '偏号': '偏好',
  // '手冲': '手冲'  —— 自反条目，2026-11-24 移除
  '咖非': '咖啡',
  '快替': '快递',
  '银航': '银行',
  '帐号': '账号',
  // '密码': '密码'  —— 自反条目，2026-11-24 移除

  // ── 形近字（五笔/手写）──
  '己经': '已经',
  '末来': '未来',
  '分折': '分析',
  '判段': '判断',
  '准各': '准备',
  '问提': '问题',
  '方按': '方案',
  // '需求': '需求'  —— 自反条目，2026-11-24 移除
  '优划': '优化',
  '性嫩': '性能',
  '稳顶': '稳定',
};

/** 长词优先：避免「数剧」先匹配导致「数剧库」没机会 */
const SORTED_KEYS = Object.keys(TYPO_MAP).sort((a, b) => b.length - a.length);

/**
 * 用户自定义词表（2026-11-24 加）
 *
 * 内置词表只覆盖通用高频错词；行业术语（医疗「骨膜」、工控「PLC」等）无法穷举，
 * 且无上下文纠错本身有误伤风险。所以把「行业词」交给用户按需加载：
 *
 *   <dataDir>/user-dict.json
 *   { "typoMap": { "错字": "正确词" }, "synonyms": [ ["词A","词B"], ... ] }
 *
 * 设计取舍：内置词表保持小而精（少误伤），行业词由用户掌控准确率。
 * 这里只负责读取与合并，文件不存在时静默跳过（零配置可用）。
 */
let USER_TYPO_MAP = Object.create(null);
let USER_MERGED_KEYS = null;   // 内置 + 用户的合并排序键，懒构建

/**
 * 从数据目录加载用户词表。可重复调用（后者覆盖前者同名键）。
 * @param {string} dataDir
 * @returns {{typo:number, selfReferential:number, source?:string}} 加载结果统计
 */
function loadUserDict(dataDir) {
  const fs = require('fs');
  const path = require('path');
  const out = { typo: 0, selfReferential: 0 };
  if (!dataDir) return out;
  const file = path.join(String(dataDir), 'user-dict.json');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return out;   // 文件不存在：零配置场景，正常
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.warn(`[typo-fix] user-dict.json 解析失败，忽略：${e.message}`);
    return out;
  }
  const map = parsed && parsed.typoMap;
  if (!map || typeof map !== 'object') return out;
  const selfRef = [];
  for (const [k, v] of Object.entries(map)) {
    if (typeof k !== 'string' || typeof v !== 'string' || !k || !v) continue;
    if (k === v) { selfRef.push(k); continue; }   // 自反条目直接丢弃，不进词表
    USER_TYPO_MAP[k] = v;
    out.typo++;
  }
  out.selfReferential = selfRef.length;
  if (selfRef.length) {
    console.warn(`[typo-fix] user-dict 中 ${selfRef.length} 条自反条目已忽略: ${selfRef.join(', ')}`);
  }
  USER_MERGED_KEYS = null;   // 失效缓存
  out.source = file;
  return out;
}

/** 合并后的排序键（内置 + 用户），长词优先 */
function mergedKeys() {
  if (USER_MERGED_KEYS) return USER_MERGED_KEYS;
  const all = new Map();
  for (const k of Object.keys(TYPO_MAP)) all.set(k, TYPO_MAP[k]);
  for (const k of Object.keys(USER_TYPO_MAP)) all.set(k, USER_TYPO_MAP[k]);  // 用户覆盖内置
  USER_MERGED_KEYS = [...all.keys()].sort((a, b) => b.length - a.length);
  return USER_MERGED_KEYS;
}

/**
 * 加载时自检（2026-11-24 加）
 *
 * 起因：词表曾出现 7 条「错字 === 正确词」的自反条目——多半是编辑器/脚本把左侧的
 * 错字自动「纠正」成了正确字，导致该条目静默失效（correctQuery 里虽然有
 * `if (wrong === right) continue` 兜底，但那只是不产生错误，条目本身仍是死的）。
 * 这里在加载时就暴露出来，避免又悄悄攒一堆无效条目。
 */
const SELF_REF_KEYS = Object.keys(TYPO_MAP).filter((k) => TYPO_MAP[k] === k);
if (SELF_REF_KEYS.length) {
  // 用 console.warn 而不是抛错：自反条目无害（只是无效），不该阻断服务启动
  console.warn(
    `[typo-fix] ${SELF_REF_KEYS.length} 条自反条目（错字===正确词，无效）: ${SELF_REF_KEYS.join(', ')}`
  );
}

/**
 * 纠正 query 里的已知错别字/音近字。
 *
 * @param {string} query
 * @param {{enabled?:boolean, maxFixes?:number}} [opts]
 * @returns {{corrected:string, fixes:Array<{from:string,to:string}>}}
 */
function correctQuery(query, opts = {}) {
  const enabled = opts.enabled !== false;
  const maxFixes = Math.max(0, Math.floor(opts.maxFixes == null ? 8 : opts.maxFixes));
  if (!enabled || !query) return { corrected: String(query || ''), fixes: [] };

  let s = String(query);
  const fixes = [];
  for (const wrong of mergedKeys()) {
    if (fixes.length >= maxFixes) break;
    if (!s.includes(wrong)) continue;
    const right = USER_TYPO_MAP[wrong] || TYPO_MAP[wrong];
    if (wrong === right) continue;
    s = s.split(wrong).join(right);
    fixes.push({ from: wrong, to: right });
  }
  return { corrected: s, fixes };
}

/** 词典规模（诊断用）；selfReferential 应恒为 0 */
function stats() {
  return {
    total: Object.keys(TYPO_MAP).length,
    userTotal: Object.keys(USER_TYPO_MAP).length,
    selfReferential: SELF_REF_KEYS.length,
  };
}

module.exports = { correctQuery, stats, TYPO_MAP, SELF_REF_KEYS, loadUserDict, USER_TYPO_MAP: () => USER_TYPO_MAP };
