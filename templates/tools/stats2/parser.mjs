// stats2/parser.mjs — ticket-consistency-parser 实现（契约=templates/stats/ticket-consistency-parser.md，冻结）
// 只解析结构列（attempt rN 规范化/角色变体列/结果/日期）+ 显式声明短语枚举；不做词典推断。
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/** §1.1 2.1.0 追加：段序标记白名单（classifier-v2.1 ②——词典 §3 登记；仅已知段名入段序标记，
 *  免疫开放垃圾值〔TBC/待定/n/a 等〕；增补段名=词典变更+版本递增）。 */
export const SEGMENT_NAME_WHITELIST = new Set(['live']);

/** §2 显式声明短语枚举（冻结）。 */
export const EXPLICIT_PHRASES = [
  { phrase: '网络中断', declares: 'infra_failure_declared' },
  { phrase: '限流', declares: 'infra_failure_declared' },
  { phrase: 'provider unavailable', declares: 'infra_failure_declared' },
  { phrase: '环境事件', declares: 'infra_failure_declared' },
  { phrase: '断电续跑', declares: 'infra_failure_declared' },
  { phrase: '非返工', declares: 'non_rework_declared' },
  { phrase: '非缺陷', declares: 'non_rework_declared' },
  { phrase: '时序', declares: 'non_rework_declared' },
  { phrase: '多 attempt 合写', declares: 'multi_attempt_declared' },
];

const norm = s => String(s ?? '').trim();
const lower = s => norm(s).toLowerCase();

// ── attempt 列规范化 v2（ticket-consistency-parser.md §1.1 规则三件套——classifier-v2 2026-10-11）──
/** 剥离白名单：实义子任务名（限定语照常剥离出序号，但保留为 attempt_subtask 段标识——"不剥离"）。 */
export const ATTEMPT_STRIP_WHITELIST = new Set(['离线部', 'harness', 'v3 离线面', '窗口后机判']);
/** 限定语净化：剥 markdown 强调包裹（成对星号、成对反引号）后 trim。 */
const cleanQualifier = q => norm(String(q ?? '')).replace(/^\*+|\*+$/g, '').replace(/^`+|`+$/g, '').trim();

/**
 * attempt 列值 → {attempt_no, qualifier, subtask, findings_no, gt1, segment_marker}。
 * v1 冻结形（纯数字/rN/RN/空/复合）零改动；v2 三件套=模式类主规则+枚举例外表（F-n）+
 * 无序号限定后缀（段序标记——仅无数字成分形态）；守卫=序号域 1–3 位（日期形/叠加形诚实降级）。
 */
export function normalizeAttemptCell(attemptRaw) {
  const cell = lower(attemptRaw);
  const out = { attempt_no: null, attempt_qualifier: null, attempt_subtask: null, attempt_findings_no: null, attempt_gt1: false, segment_marker: false };
  // D7' 台账非适用占位（—/-）＝无信号（阶段三预检 ②——不得判段序标记）
  if (cell === '' || cell === '—' || cell === '-' || cell === '–') return out;
  const compound = /^\d+\s*[+＋]\s*\d+$/.test(cell) || /^r\d+\s*[+＋]\s*r?\d+$/.test(cell);
  if (compound) return out;   // 复合形（D6 面）：不作结构信号（v1 冻结）
  const mPlain = /^r(\d+)$/.exec(cell) ?? /^(\d+)$/.exec(cell);   // v1 冻结形（纯数字/rN——序号域不设界，零改动）
  if (mPlain) { out.attempt_no = parseInt(mPlain[1], 10); return out; }
  // 枚举例外表：F-n 系（findings 编号）→ attempt>1 结构语义（非 attempt 序号）
  const mF = /^f[-−](\d{1,3})\b\s*(.*)$/.exec(cell);
  if (mF) {
    out.attempt_findings_no = parseInt(mF[1], 10);
    out.attempt_gt1 = true;
    out.attempt_qualifier = cleanQualifier(mF[2]) || null;
    return out;
  }
  // 模式类主规则：r?数字（1–3 位）+尾部限定语（括号形/连字符形）→ 序号提取+限定语剥离
  const mParen = /^r?(\d{1,3})\s*[（(]([^（）()]*)[)）]$/.exec(cell);
  const mHyphen = /^r?(\d{1,3})\s*[-–—]\s*(\S.*)$/.exec(cell);
  const mq = mParen ?? mHyphen;
  if (mq) {
    out.attempt_no = parseInt(mq[1], 10);
    const q = cleanQualifier(mq[2]);
    out.attempt_qualifier = q || null;
    if (q && ATTEMPT_STRIP_WHITELIST.has(q)) out.attempt_subtask = q;   // 白名单：实义子任务名保留段标识
    return out;
  }
  // 无序号限定后缀：非空且无数字成分 → 段序标记（2.1.0 ②：白名单制——仅已知段名如 live 入标记，
  // 白名单外垃圾值无任何结构信号）；含数字成分（日期形/叠加形）不作结构信号
  if (cell !== '' && !/\d/.test(cell) && SEGMENT_NAME_WHITELIST.has(cell)) {
    out.segment_marker = true;
    out.attempt_qualifier = norm(attemptRaw);
  }
  return out;
}

/** 角色列限定语提取（词典 2.0.0 secondary 标注族匹配面：括号内限定语，如「developer（执行段编排器轮）」）。 */
export function extractRoleQualifier(roleRaw) {
  const m = /[（(]([^（）()]*)[)）]/.exec(norm(roleRaw));
  return m ? norm(m[1]) || null : null;
}

// ── §1.1 2.1.0 追加：骨架事件文本兜底（classifier-v2.1 ①c——追加式，不改既有行）──
/** 骨架表=整表无 attempt/备注结构列（表级形态；行级空串不触发）。事件列交付语义形提取规则：
 *  仅「交付轮 attempt=n」字面前缀命中——引用形（修复 attempt=n/针对 attempt=n）无该前缀=显式排除。 */
export const SKELETON_EVENT_ATTEMPT_RE = /交付轮\s*attempt\s*=\s*(\d{1,3})/;

/** 执行会话标识列判据（契约 §1.2——D7' 消费，宿主中立四分支）。 */
export function parseSessionCell(raw) {
  const v = norm(raw);
  if (v === '' || v === '—' || v === '-') return { session_id: null, session_host_na: false, session_host_marker: null };
  if (/^host:n\/a$/i.test(v)) return { session_id: null, session_host_na: true, session_host_marker: null };   // 归因上限 DIRECT 不升 EXPLICIT
  if (/^host:/i.test(v)) return { session_id: null, session_host_na: false, session_host_marker: v };          // 宿主标记（非 childSessionId 形态）
  return { session_id: v, session_host_na: false, session_host_marker: null };                                  // 真实会话标识（EXPLICIT 锚）
}

/** 解析「运行记录」表格行 → 结构列对象。行序=文档序。
 *  stats-3 阶段三追加输出：`line`（1-based 文件行号——snapshot source_refs.line_range 锚；
 *  不改任何规范化规则——契约 §1 冻结面零改动）。 */
export function parseTicketRunLog(markdown) {
  const rows = [];
  const lines = String(markdown).split(/\r?\n/);
  let inRunLog = false;
  let headerCells = null;
  let skeletonTable = false;   // §1.1 2.1.0：表级骨架形态（整表无 attempt/备注结构列）
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln];
    if (/^#{1,6}\s*运行记录/.test(norm(line))) { inRunLog = true; headerCells = null; continue; }
    if (inRunLog && /^#{1,6}\s/.test(norm(line))) { inRunLog = false; continue; }   // 小节结束
    if (!inRunLog) continue;
    const cells = line.split('|').map(c => c.trim()).filter((c, i, a) => !(i === 0 && c === '') && !(i === a.length - 1 && c === ''));
    if (cells.length < 2) continue;
    if (/^[-: ]+$/.test(cells.join(''))) continue;   // 分隔行
    if (headerCells === null) {
      headerCells = cells.map(lower);
      // §1.1 2.1.0 追加：表级骨架判定（整表无 attempt/备注结构列——列名定位，与列序无关）
      skeletonTable = !headerCells.some(h => h === 'attempt' || h === '尝试')
        && !headerCells.some(h => h === '备注' || h === 'note');
      continue;
    }
    const row = {};
    headerCells.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    // 结构列提取
    const attemptRaw = norm(row['attempt'] ?? row['尝试'] ?? '');
    const normAttempt = normalizeAttemptCell(attemptRaw);
    let attemptNo = normAttempt.attempt_no;
    // §1.1 2.1.0 追加：骨架表事件文本兜底（表级触发；交付语义形提取+引用形显式排除——字面前缀制）
    const skeletonEvent = skeletonTable
      ? SKELETON_EVENT_ATTEMPT_RE.exec(norm(row['事件'] ?? row['event'] ?? '')) : null;
    if (skeletonEvent) attemptNo = parseInt(skeletonEvent[1], 10);
    const compound = /^\d+\s*[+＋]\s*\d+$/.test(lower(attemptRaw)) || /^r\d+\s*[+＋]\s*r?\d+$/.test(lower(attemptRaw));
    // 角色列：角色 / 角色/变体（D7' 宪法 4a 列集规范名——阶段三预检 ①）/ role 三别名
    const roleRaw = norm(row['角色'] ?? row['角色/变体'] ?? row['role'] ?? '');
    const roleLower = lower(roleRaw);
    const isDeveloper = roleLower === 'developer';
    const isDeveloperRerun = roleLower === 'developer-rerun';
    const note = norm(row['备注'] ?? row['note'] ?? '');
    const result = norm(row['结果'] ?? row['result'] ?? '');   // 照录不据此判定（契约 §1；审查 P2-7）
    const date = norm(row['日期'] ?? row['date'] ?? '');
    // 执行会话标识列（v2 §1.2——D7' 末位列；列缺席=无字段语义）
    // 列名三别名（契约 §1.2 修复轮 P3-2 冻结——禁删防破台账面）：执行会话标识（D7' 规范名）/会话标识（缩形）/childSessionId（宿主技术名——表头经小写化为 childsessionid 键）
    const session = parseSessionCell(row['执行会话标识'] ?? row['会话标识'] ?? row['childsessionid'] ?? '');
    // 显式声明只扫 note/备注列（契约 §2 冻结；result 列不参与——防结果措辞误触发声明）
    const declarations = EXPLICIT_PHRASES.filter(p => lower(note).includes(p.phrase)).map(p => p.declares);
    rows.push({
      attempt_raw: attemptRaw, attempt_no: attemptNo, attempt_compound: compound,
      attempt_from_event: skeletonEvent ? skeletonEvent[0] : null,   // §1.1 2.1.0：骨架事件提取留痕（追加字段）
      attempt_qualifier: normAttempt.attempt_qualifier, attempt_subtask: normAttempt.attempt_subtask,
      attempt_findings_no: normAttempt.attempt_findings_no, attempt_gt1: normAttempt.attempt_gt1,
      segment_marker: normAttempt.segment_marker,
      role: roleLower, is_developer: isDeveloper || isDeveloperRerun, is_rerun: isDeveloperRerun,
      role_qualifier: extractRoleQualifier(roleRaw),
      result, date, note, line: ln + 1, declarations: [...new Set(declarations)],
      session_id: session.session_id, session_host_na: session.session_host_na, session_host_marker: session.session_host_marker,
    });
  }
  return rows;
}

/** 七类差异逐条精确谓词（契约 §3）。返回 [{class, ticket_slug, source_key, detail}]。 */
export function diffTicket(slug, rows, dispatchEvents, { sha8 }) {
  const out = [];
  const devRows = rows.filter(r => r.is_developer);
  const devDispatch = dispatchEvents.filter(e => e.role === 'developer');
  if (devDispatch.length > 0 && devRows.length === 0) {
    out.push({ class: 'missing_ticket_row', ticket_slug: slug, source_key: sha8(devDispatch[0].entity_id), detail: `dispatch×${devDispatch.length} 而运行记录无 developer 行` });
  }
  if (devRows.length > 0 && devDispatch.length === 0) {
    out.push({ class: 'orphan_dispatch', ticket_slug: slug, source_key: sha8(slug), detail: `运行记录 developer 行×${devRows.length} 而无 DIRECT dispatch` });
  }
  const nos = devRows.map(r => r.attempt_no).filter(n => Number.isInteger(n));
  const seen = new Set();
  for (const n of nos) {
    if (seen.has(n)) out.push({ class: 'duplicate_attempt', ticket_slug: slug, source_key: sha8(`${slug}#${n}`), detail: `attempt ${n} 重复` });
    seen.add(n);
  }
  for (let i = 1; i < nos.length; i++) {
    if (nos[i] <= nos[i - 1]) out.push({ class: 'non_monotonic_attempt', ticket_slug: slug, source_key: sha8(`${slug}#${nos[i]}`), detail: `attempt 序列 ${nos.join(',')} 非严格递增` });
  }
  for (const r of devRows) {
    if (r.attempt_no === 1 && r.declarations.includes('infra_failure_declared')) {
      out.push({ class: 'attempt1_but_infra_failure', ticket_slug: slug, source_key: sha8(`${slug}#1`), detail: `attempt=1 且显式环境失败声明（${r.declarations.join(',')}）` });
    }
    if (r.attempt_compound || r.declarations.includes('multi_attempt_declared')) {
      out.push({ class: 'one_row_multi_attempt', ticket_slug: slug, source_key: sha8(`${slug}#${r.attempt_raw}`), detail: `单行复合 attempt（${r.attempt_raw}）` });
    }
  }
  const dispatchVariants = new Set(devDispatch.map(e => e.variant || 'base'));
  const rowVariants = new Set(devRows.map(r => (r.is_rerun ? 'rerun' : 'base')));
  if (devDispatch.length > 0 && devRows.length > 0 && (dispatchVariants.size !== rowVariants.size || [...dispatchVariants].some(v => !rowVariants.has(v)))) {
    out.push({ class: 'variant_kind_conflict', ticket_slug: slug, source_key: sha8(slug), detail: `dispatch variant 集 {${[...dispatchVariants]}} ≠ 运行记录角色面 {${[...rowVariants]}}` });
  }
  return out;
}

export const sha8 = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 8);

export function readTicketFromBundle(bundleDir, slug) {
  return readFileSync(join(bundleDir, 'tickets', `${slug}.md`), 'utf8');
}