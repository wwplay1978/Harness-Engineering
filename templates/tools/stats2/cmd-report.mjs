// stats2/cmd-report.mjs — stats-4：report 子命令（常设 M1/M2 报告——docs/22 §4/§5.6；票面 D1-D5/D8）
// 语料与参数面（P1-1 冻结）：默认=全仓 closed segments（generation 快照读——读代指针一次后只读该代
// closed segment；非 bundle 锚定）；--project <id>（可重复）/--since/--until <RFC3339-UTC> 过滤；
// manifest 复用 report-manifest-v1.json（bundle_id 哨兵=all-store），仅 --out 模式产出
// （P2-7：stdout 默认不产 manifest——--json 体含 manifest 所需全部信息的规范形）。
// canonical JSON 恒等面（D3/P1-6）：恒等适用面=report JSON 体（--json stdout 与 --out 文件体字节恒等）；
// 体禁时钟依赖字段；时间桶 UTC 钉死（P2-5——TZ 变体不影响体）；revision_watermark=数据派生
// （store 最新事件 RFC3339，非报告时刻）；manifest 工件（含 generated_at）不在恒等面。
// --out 白名单（D5）：仅 <storeRoot>/reports/ 下相对名；周桶=watermark 的 ISO week-year（UTC，
// 数据派生——⑧跨年三日点名）；append 禁覆写（OUT_FILE_EXISTS）。
// M2 三层门红态（D2/P1-3/P1-4）：①门状态行=最新 reports/heldout-planner-final-<sha8>.json 工件
// 双门终值（classifier-acceptance.md=阈值契约非状态载体）；工件版本≠当前 CLASSIFIER_VERSION→过期红
// （版本差注记）；缺席→默认红。②门红版本 derivation 不入 M2 分子分母（守 classifier-acceptance:19
// 阻断语义）——auto 派生面指标行 null+blocked-classifier-gate-red。③MANUAL_RECONCILED 人工归因
// 子集照常出数（manual>auto——非 classifier 派生不在阻断面）。
// 口径注记（消费面操作化定义——04 号为定义权威，本文件为事件仓可复算口径）：
//   - merged 票（三 pass 分母）=terminal_completed developer 派发所在票（git merge 面=M3/stats-5）；
//   - 质量性返工率分母=terminal_completed+terminal_failed 派发所在票（cancelled 单列不入）；
//   - reviewer-first=存在 code-reviewer 派发且首个 reviewer 派发后无质量性返工 attempt 派发（序 join）；
//   - pipeline-clean=reviewer-first ∧ 存在 qa-tester 派发且首个 qa 派发后无质量性返工 attempt 派发；
//   - 返工花费 join=developer 派发（created_at 序）↔行序（pilot-report 先例）+后续复审/复测派发
//     （review 族角色，同票 created_at 晚于返工 attempt 派发）；
//   - QA 缺陷密度=qa 触发（trigger_stage=qa）的质量性返工 attempt 数 / merged 票数（metrics.md 台账
//     「QA 缺陷」列的事件仓操作化——台账无冻结公式，此为可复算口径）。
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, openSync, closeSync, fsyncSync, linkSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EXIT, RFC3339_UTC_RE } from './cli.mjs';
import * as EE from './events-engine.mjs';
import { ensureStoreLayout } from './store.mjs';
import { sha256Hex, fsyncDir } from './util.mjs';
import { effectiveDerivations } from './cmd-mine.mjs';
import { manualAttributionArchives } from './cmd-phase4.mjs';
import { CLASSIFIER_VERSION } from './classifier.mjs';
import { validateFixture } from './contract-validator.mjs';
import { sha8 } from './parser.mjs';

const EXCLUDED_SECONDARY = ['non_defect', 'staged_delivery', 'upstream_sync'];   // classifier-v2 裁决 A（M2 分子剔除集）
const EXCLUDED_SET = new Set(EXCLUDED_SECONDARY);
/** 质量性返工 attempt 判定（剔除集外——secondary=null 入分子）。 */
const isQualityRework = d => d?.attempt_kind === 'quality_rework' && !EXCLUDED_SET.has(d.secondary_cause ?? null);
const REVIEW_FAMILY = new Set(['code-reviewer', 'qa-tester', 'red-teamer']);
const TERMINAL_COUNTED = new Set(['terminal_completed', 'terminal_failed', 'missing_child']);   // 失败率分母（stats-1 gap-5 已裁）
const TOKEN_LANES = ['input', 'output', 'reasoning', 'cache_read', 'cache_write'];

/** 事件主时戳（派发=created_at / 模型请求=started_at / 观察=collected_at；无主时戳=null）。 */
function primaryTs(e) {
  if (e.event_kind === 'dispatch') return e.created_at ?? null;
  if (e.event_kind === 'model-request') return e.started_at ?? null;
  if (e.event_kind === 'observation') return e.collected_at ?? null;
  return null;
}

const isDevDispatch = e => e.event_kind === 'dispatch' && (e.role === 'developer' || e.role === 'developer-rerun');
const roleVariantKey = e => e.role + (e.variant && !e.role.endsWith('-' + e.variant) ? '-' + e.variant : '');
const rateOf = (num, den) => den > 0 ? +(num / den).toFixed(4) : null;

/** ISO week-year 周桶（UTC——thursday 法：week-year=该周周四所在年；§5.7/H6）。 */
export function isoWeekBucket(ms) {
  const d = new Date(ms);
  const dow = d.getUTCDay() || 7;   // Mon=1..Sun=7
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 4 - dow));
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / 604_800_000) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** 门状态行（D2 三层之一）：最新 planner-final 工件双门终值+版本匹配。 */
function classifierGateRow(storeRoot) {
  const reportsDir = join(storeRoot, 'reports');
  const cur = { state: 'red', blocking: true, source_artifact: null, classifier_version_current: CLASSIFIER_VERSION,
    classifier_version_artifact: null, version_match: null, gates_final: null,
    note: 'planner-final 工件缺席——默认红态（P1-3/P1-4：无在档双门终值即红，不冒充绿）' };
  if (!existsSync(reportsDir)) return cur;
  const candidates = [];
  for (const f of readdirSync(reportsDir).filter(f => f.startsWith('heldout-planner-final-') && f.endsWith('.json')).sort()) {
    try {
      const j = JSON.parse(readFileSync(join(reportsDir, f), 'utf8'));
      if (j?.artifact_kind === 'heldout-planner-final') candidates.push({ file: f, j });
    } catch { /* 损坏工件不入候选（fail-open 限于门状态行——数字面已由 blocked 态保守处置） */ }
  }
  if (candidates.length === 0) return cur;
  // 最新=generated_at 最大（并列取文件名逆序——确定性选择）
  candidates.sort((a, b) => (a.j.generated_at ?? '') < (b.j.generated_at ?? '') ? -1
    : (a.j.generated_at ?? '') > (b.j.generated_at ?? '') ? 1 : b.file < a.file ? -1 : 1);
  const latest = candidates[candidates.length - 1];
  cur.source_artifact = `reports/${latest.file}`;
  cur.classifier_version_artifact = latest.j.classifier_version ?? null;
  cur.version_match = cur.classifier_version_artifact === CLASSIFIER_VERSION;
  cur.gates_final = latest.j.gates_final ?? null;
  if (!cur.version_match) {
    cur.note = `工件 classifier_version=${JSON.stringify(cur.classifier_version_artifact)} ≠ 当前 ${CLASSIFIER_VERSION}——工件视为过期（门红+版本差注记；重验批双门绿工件落位后转绿）`;
    return cur;
  }
  const wrongGate = cur.gates_final?.wrong_label_gate;
  if (typeof wrongGate !== 'string') {
    // P2-2（复审）：版本匹配但工件不完整（gates_final/wrong_label_gate 缺失或非字符串）→ 视红——
    // 与 JSON 解析失败同保守标准，消除伪造/畸形工件放行面（fail-open 洞）
    cur.note = `工件 gates_final 不完整（wrong_label_gate=${JSON.stringify(wrongGate)} 非字符串）——工件视为无效（门红；不完整工件不得放行 auto 面）`;
    return cur;
  }
  if (wrongGate === 'fail') {
    cur.note = `错误门红（wrong_label_gate=fail——wrong_label_rate=${cur.gates_final.wrong_label_rate}）:classifier-acceptance:19 阻断 M2 数字面`;
    return cur;
  }
  cur.state = 'green';
  cur.blocking = false;
  cur.note = `双门终值自最新工件（wrong_label_gate=${wrongGate ?? 'n/a'}，combined_gate=${cur.gates_final?.combined_gate ?? 'n/a'}）——重验批转绿=读工件现值，无触发器`;
  return cur;
}

/** 行面（面二）：每实体最新 ticket_snapshot → {slug→[dev 行]}（attempt_no/角色列；D7' 前票面可缺席）。 */
function rowFace(events) {
  const latestSnap = new Map();
  for (const e of events) {
    if (e.event_kind !== 'observation' || e.observation_subtype !== 'ticket_snapshot') continue;
    const prev = latestSnap.get(e.entity_id);
    if (!prev || e.source_revision > prev.source_revision) latestSnap.set(e.entity_id, e);
  }
  const bySlug = new Map();
  for (const s of latestSnap.values()) {
    const role = String(s.snapshot?.role_column_raw ?? '').trim().toLowerCase();
    if (role !== 'developer' && role !== 'developer-rerun') continue;
    const slug = s.ticket_slug;
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug).push({
      entity_id: s.entity_id, line: Number(String(s.source_primary_key).split('#L')[1] ?? 0),
      attempt_no: Number.isInteger(s.snapshot?.attempt_no) ? s.snapshot.attempt_no : null,
      attempt_column_raw: String(s.snapshot?.attempt_column_raw ?? ''),
    });
  }
  for (const rows of bySlug.values()) rows.sort((a, b) => a.line - b.line || (a.entity_id < b.entity_id ? -1 : 1));
  return bySlug;
}

/** M2 计量（auto 面——门红时调用方以 null+blocked 态替换出仓；本函数恒算供结构面）。
 *  stats-5：internals 收集器（可选）——M4 消费同一 join 面（joinedRework 含 deriv/返工派发实体集/票级计数），
 *  避免 M2/M4 各自重算口径漂移；internals 不入 JSON 体。
 *  attribution-explicit-closure r2：票级面只收 EXPLICIT|DIRECT|MANUAL_RECONCILED（TICKET_FACE）且
 *  slug/标签取共享归因面（attributionFace）post-join 值——CANDIDATE 隔离+EXPLICIT 升级票计入。 */
const TICKET_FACE = new Set(['EXPLICIT', 'DIRECT', 'MANUAL_RECONCILED']);
export { TICKET_FACE };

/**
 * EXPLICIT join 共享归因面（attribution-explicit-closure r2——一处实现三处消费：本文件 m2AutoFace/m3Face
 * +cmd-b9matrix.mjs mergedTicketSlugs）。裁决记录（票面+changes 档承载，22 正文零改动）：collect 侧
 * attribution=单源初步判定（仅 cwd 面）；本面=22:90 EXPLICIT 定义（「票据运行记录行含 childSessionId」）
 * 的消费侧完整实现——跨源身份证据（dispatch.child_session_id ∈ 票 ledger 行快照 execution_session.session_id
 * 集，session_id 非空）不属 22:96「永不自动升级」所指的「无新证据升入」。
 * 语义：单票命中=CANDIDATE→EXPLICIT+slug 回填（唯一物质场景——CANDIDATE 是唯一 null-slug 态）；
 * DIRECT→标签升 EXPLICIT 但 slug 不被 ledger 覆盖（分歧保守保留 worktree 归属+divergence 计数）；
 * 多票命中=拒绝升级（保守——人工代录复制粘贴风险面）+conflict 计数；host:n/a（session_id=null）结构性不可命中。
 * P2-1（红队修复轮）：ledger 面只取每实体最新 ticket_snapshot（与 effectiveDerivations latest 政策同哲学——
 * collected_at 最新者胜、同刻事件序后者胜）；同 entity 多快照并存=票文件变更后重 mine 的 append-only 历史面，
 * 行 session_id 更正后旧快照不再入 join 域（已撤回证据不得完成升级）。
 * @returns {{face: Map, counts: {explicit_conflict, explicit_slug_divergence}, coverage: {covered, total}}}
 *   basis∈{direct-worktree,explicit-ledger,conflict-refused,unattributed}——internals 诊断面（不入 JSON 体；
 *   MANUAL_RECONCILED 行锚=归档工件面非本 join，basis 如实落 unattributed=本面无机器证据承载）。
 */
export function attributionFace(events) {
  // ledger 面：每实体最新快照（P2-1）→ 非空 session_id → slug 集（同 session 出现多票=冲突面）
  const latestSnap = new Map();
  for (const e of events) {
    if (e.event_kind !== 'observation' || e.observation_subtype !== 'ticket_snapshot') continue;
    const prev = latestSnap.get(e.entity_id);
    if (!prev || (e.collected_at ?? '') >= (prev.collected_at ?? '')) latestSnap.set(e.entity_id, e);   // 同刻（>=）：事件序后者胜
  }
  const ledgerSessions = new Map();
  for (const e of latestSnap.values()) {
    const sid = e.snapshot?.execution_session?.session_id;
    if (typeof sid !== 'string' || sid === '') continue;   // host:n-a/宿主标记/列缺席/空=结构性不可命中
    if (!ledgerSessions.has(sid)) ledgerSessions.set(sid, new Set());
    ledgerSessions.get(sid).add(e.ticket_slug);
  }
  const face = new Map();
  let explicitConflict = 0, explicitSlugDivergence = 0, covered = 0, joinTotal = 0;
  for (const e of events) {
    if (e.event_kind !== 'dispatch') continue;
    let { attribution, ticket_slug } = e;
    const child = e.child_session_id;
    let basis;
    if (typeof child === 'string' && child !== '') {
      joinTotal++;
      const hits = ledgerSessions.get(child);
      if (hits && hits.size > 0) covered++;
      if (hits && hits.size === 1) {
        const slug = [...hits][0];
        if (attribution === 'CANDIDATE') {
          attribution = 'EXPLICIT'; ticket_slug = slug; basis = 'explicit-ledger';   // 单票命中回填（唯一物质场景）
        } else if (attribution === 'DIRECT' || attribution === 'EXPLICIT') {
          attribution = 'EXPLICIT';   // 标签升 EXPLICIT
          if (slug === e.ticket_slug) basis = 'explicit-ledger';
          else { basis = 'direct-worktree'; explicitSlugDivergence++; }   // 分歧：slug 保留 worktree 归属
        }
      } else if (hits && hits.size > 1) {
        explicitConflict++;   // 多票命中拒绝升级（保留原 attribution/slug）
        basis = 'conflict-refused';
      }
    }
    if (!basis) basis = (attribution === 'DIRECT' || attribution === 'EXPLICIT') ? 'direct-worktree' : 'unattributed';
    face.set(e.entity_id, { attribution, ticket_slug, basis });
  }
  return { face, counts: { explicit_conflict: explicitConflict, explicit_slug_divergence: explicitSlugDivergence }, coverage: { covered, total: joinTotal } };
}

function m2AutoFace(events, internals = null, attrFaceResult = null) {
  // attrFaceResult（红队修复轮 P1-1）：调用方已算好的 attributionFace 结果可收参复用（消同报告重算）；
  // 缺席时本函数自算（:775 untruncated 面与 :625 scoped 面两消费形并存——m3Face 传参模式同法）。
  const { face: attrFace } = attrFaceResult ?? attributionFace(events);
  const faceOf = (e) => attrFace.get(e.entity_id) ?? { attribution: e.attribution, ticket_slug: e.ticket_slug, basis: null };
  const devDispatches = events.filter(isDevDispatch)
    .sort((a, b) => (a.created_at ?? '') < (b.created_at ?? '') ? -1 : (a.created_at ?? '') > (b.created_at ?? '') ? 1 : a.entity_id < b.entity_id ? -1 : 1);
  const mergedTickets = new Set(devDispatches.filter(e => e.state === 'terminal_completed' && TICKET_FACE.has(faceOf(e).attribution)).map(e => faceOf(e).ticket_slug));
  const reworkDenominatorTickets = new Set(devDispatches.filter(e => (e.state === 'terminal_completed' || e.state === 'terminal_failed') && TICKET_FACE.has(faceOf(e).attribution)).map(e => faceOf(e).ticket_slug));

  // 行派生 join（面一 join 面二）：行实体 → 有效 derivation（manual>auto；§5.2 读取语义）
  const eff = effectiveDerivations(events);
  const rows = rowFace(events);
  const rowDeriv = new Map();   // entity_id → 有效 derivation（null=无派生在档）
  for (const rs of rows.values()) for (const r of rs) rowDeriv.set(r.entity_id, eff.get(r.entity_id)?.derivation ?? null);

  // 逐票：质量性返工行（剔除集外）+any quality_rework 行（pass·no-quality-rework 面——04 号口径不剔 secondary）
  const reworkRowsBySlug = new Map();       // slug → [{entity, deriv, joinedDispatch}]
  const anyQualityBySlug = new Map();       // slug → bool
  const devDispatchesBySlug = new Map();
  for (const d of devDispatches) {
    const slug = faceOf(d).ticket_slug;   // post-join slug（CANDIDATE 升级票挂 ledger 票下 join）
    if (!devDispatchesBySlug.has(slug)) devDispatchesBySlug.set(slug, []);
    devDispatchesBySlug.get(slug).push(d);
  }
  for (const [slug, rs] of rows) {
    const list = [];
    let anyQuality = false;
    rs.forEach((r, i) => {
      const d = rowDeriv.get(r.entity_id);
      if (d?.attempt_kind === 'quality_rework') anyQuality = true;
      if (isQualityRework(d)) list.push({ row: r, deriv: d, ordinal: i });
    });
    if (list.length > 0) reworkRowsBySlug.set(slug, list);
    anyQualityBySlug.set(slug, anyQuality);
  }
  // join：dev 派发（created_at 序）↔行序（pilot-report 先例——同票 attempt 序近似）
  const joinedRework = [];   // {slug, dispatch, deriv}
  for (const [slug, list] of reworkRowsBySlug) {
    const ds = devDispatchesBySlug.get(slug) ?? [];
    for (const item of list) joinedRework.push({ slug, dispatch: ds[item.ordinal] ?? null, deriv: item.deriv });
  }
  // 全角色派发面（review/qa 时点+返工花费的后续复审派发均取自此）——票级面准入=TICKET_FACE（r2）
  const allBySlug = new Map();
  for (const e of events) {
    if (e.event_kind !== 'dispatch') continue;
    if (!TICKET_FACE.has(faceOf(e).attribution)) continue;   // CANDIDATE/UNATTRIBUTED null 面不入票级
    const slug = faceOf(e).ticket_slug;
    if (!allBySlug.has(slug)) allBySlug.set(slug, []);
    allBySlug.get(slug).push(e);
  }

  // 三 pass（分列禁合并——D10'/H2）；review/qa 时点取自全角色派发面（allBySlug）
  const firstDispTime = (slug, role) => {
    const ds = (allBySlug.get(slug) ?? []).filter(e => e.role === role).sort((a, b) => (a.created_at ?? '') < (b.created_at ?? '') ? -1 : 1);
    return ds.length > 0 ? ds[0].created_at ?? null : null;
  };
  const reworkAfter = (slug, t) => t == null ? true : joinedRework.some(x => x.slug === slug && x.dispatch && (x.dispatch.created_at ?? '') > t);
  const reviewerFirstTickets = [...mergedTickets].filter(slug => {
    const t = firstDispTime(slug, 'code-reviewer');
    return t !== null && !reworkAfter(slug, t);
  });
  const pipelineCleanTickets = reviewerFirstTickets.filter(slug => {
    const t = firstDispTime(slug, 'qa-tester');
    return t !== null && !reworkAfter(slug, t);
  });
  const noReworkTickets = [...mergedTickets].filter(slug => !anyQualityBySlug.get(slug));

  // 质量性返工率（票级）
  const reworkTickets = new Set(joinedRework.map(x => x.slug));

  // 返工花费：质量性返工 attempt 派发+其后同票 review 族派发墙钟；token=挂链 model-request 五路
  const spendDispatches = new Set();
  let wall = 0;
  for (const x of joinedRework) {
    if (!x.dispatch) continue;
    spendDispatches.add(x.dispatch.entity_id);
    wall += x.dispatch.wall_clock_ms ?? 0;
    for (const d of allBySlug.get(x.slug) ?? []) {
      if (REVIEW_FAMILY.has(d.role) && (d.created_at ?? '') > (x.dispatch.created_at ?? '')) { spendDispatches.add(d.entity_id); wall += d.wall_clock_ms ?? 0; }
    }
  }
  const tokens = Object.fromEntries(TOKEN_LANES.map(k => [k, 0]));
  for (const e of events) {
    if (e.event_kind !== 'model-request' || !spendDispatches.has(e.parent_entity_id)) continue;
    for (const k of TOKEN_LANES) if (Number.isFinite(e.usage?.[k])) tokens[k] += e.usage[k];
  }

  // attempt 分布（票 × max attempt 直方图；compound/无序号行票单列不入分布）
  const buckets = {};
  let unparseable = 0;
  for (const slug of new Set([...rows.keys(), ...mergedTickets])) {
    const rs = rows.get(slug) ?? [];
    const nos = rs.filter(r => Number.isInteger(r.attempt_no)).map(r => r.attempt_no);
    if (nos.length === 0) {
      if (rs.some(r => r.attempt_column_raw !== '')) unparseable++;
      else if (!mergedTickets.has(slug)) continue;   // 无行面且非 merged——不入分布
      else buckets['1'] = (buckets['1'] ?? 0) + 1;   // merged 票无行面：无返工证据→max attempt 1（回退面一推数，口径注记）
      continue;
    }
    const max = Math.max(...nos);
    const key = max >= 4 ? '4+' : String(max);
    buckets[key] = (buckets[key] ?? 0) + 1;
  }

  // QA 缺陷密度（qa 触发的质量性返工 attempt 数 / merged 票数）
  const qaTriggered = [...eff.values()].filter(e => isQualityRework(e.derivation) && e.derivation.trigger_stage === 'qa').length;

  if (internals) {
    internals.joinedRework = joinedRework;
    internals.reworkDispatchIds = new Set(joinedRework.filter(x => x.dispatch).map(x => x.dispatch.entity_id));
    internals.reworkAttemptsBySlug = new Map();
    for (const x of joinedRework) internals.reworkAttemptsBySlug.set(x.slug, (internals.reworkAttemptsBySlug.get(x.slug) ?? 0) + 1);
  }

  return {
    three_pass: {
      reviewer_first: { numerator: reviewerFirstTickets.length, denominator: mergedTickets.size, rate: rateOf(reviewerFirstTickets.length, mergedTickets.size) },
      pipeline_clean: { numerator: pipelineCleanTickets.length, denominator: mergedTickets.size, rate: rateOf(pipelineCleanTickets.length, mergedTickets.size) },
      no_quality_rework: { numerator: noReworkTickets.length, denominator: mergedTickets.size, rate: rateOf(noReworkTickets.length, mergedTickets.size) },
    },
    quality_rework_rate: {
      numerator: reworkTickets.size, denominator: reworkDenominatorTickets.size,
      rate: rateOf(reworkTickets.size, reworkDenominatorTickets.size), excluded_secondary: [...EXCLUDED_SECONDARY],
    },
    rework_spend: { wall_clock_ms: wall, tokens, join_note: '面一 join 面二：dev 派发（created_at 序）↔行序+后续 review 族派发；token=挂链 model-request 五路' },
    attempt_distribution: { buckets, unparseable_excluded_tickets: unparseable, note: '票 × max attempt（行面 snapshot）；compound/无序号行票单列不入分布' },
    qa_defect_density: { qa_triggered_rework_attempts: qaTriggered, merged_tickets: mergedTickets.size, density: rateOf(qaTriggered, mergedTickets.size) },
  };
}

/** M2 人工归因子集（三层之三——不受门红阻断：manual>auto，非 classifier 派生）。 */
function manualSubset(storeRoot, events) {
  const { manualByEntity } = manualAttributionArchives(storeRoot);
  const eff = effectiveDerivations(events);
  let entities = 0, qualityRework = 0;
  const tickets = new Set();
  for (const [eid, rec] of manualByEntity) {
    if (rec.attribution_level !== 'MANUAL_RECONCILED') continue;
    const e = eff.get(eid);
    if (!e || e.derivation_origin !== 'manual') continue;   // 仓内无 manual 有效派生=归档未入语料（如实不计数）
    entities++;
    tickets.add(rec.ticket_slug);
    if (isQualityRework(e.derivation)) qualityRework++;
  }
  return {
    entities, tickets: tickets.size, quality_rework_entities: qualityRework,
    note: 'MANUAL_RECONCILED 人工归因子集照常出数（policy manual>auto——人工归因非 classifier 派生，不在 classifier-acceptance:19 阻断面）',
  };
}

/** M3 流动计量（stats-5 交付物 1；dispatch 面——不受分类器门阻）。
 *  attribution-explicit-closure r2：attrFaceMap=共享归因面（attributionFace().face）——票级桶只收
 *  TICKET_FACE 且 slug 取 post-join 值（CANDIDATE null 面不入票级指标——22:94 消费权限）。 */
function m3Face(scopedDispatches, attrFaceMap) {
  // ticket cycle time：merge 锚物化面停该子面呈报（票面交付物 1 实现约束）——诚实骨架 blocked 非 0。
  // 停摆根因：事件 schema observation_subtype 枚举 {ticket_snapshot,derived}+两载荷字段级 allowlist
  // （VR-S29/VR-S30，additionalProperties:false）冻结，{slug,merge_oid,merge_ts} 锚无既有事件形态可承载
  // （承载需 event schema 变更→回方案门 §5.2 ④）；bundle 侧 ticket_merges 观察面已交付（P1-1(a)）。
  const ticket_cycle_time = {
    state: 'blocked',
    reason: 'merge 锚物化面停该子面呈报：事件 schema 枚举+载荷 allowlist 冻结，锚承载需 schema 变更（stats-5 交付物 1 实现约束——回方案门 §5.2 ④）；bundle 侧 ticket_merges 观察面已交付（P1-1(a) 取数面裁断）',
    p50_ms: null, coverage: null, denominator: null,
    note: '锚面落位后输出 p50+覆盖率（n=有锚票/语料票数；非 dogfood merge 形态票=n/a 不入分母，覆盖率披露）',
  };
  // agent/空闲分桶（面一时间线；空闲含人闸+排队——估算标注义务）：
  // 票周期端点=首次派发→末次派发完成（merge 锚面停摆——周期上界估算，estimation=true 如实）
  const bySlug = new Map();
  for (const d of scopedDispatches) {
    if (!d.created_at) continue;
    const f = attrFaceMap.get(d.entity_id) ?? { attribution: d.attribution, ticket_slug: d.ticket_slug };
    if (!TICKET_FACE.has(f.attribution)) continue;   // CANDIDATE/UNATTRIBUTED null 面不入票级桶
    if (!bySlug.has(f.ticket_slug)) bySlug.set(f.ticket_slug, []);
    bySlug.get(f.ticket_slug).push(d);
  }
  let tickets = 0, activeMs = 0, idleMs = 0;
  for (const ds of bySlug.values()) {
    let first = Infinity, lastEnd = -Infinity, act = 0;
    for (const d of ds) {
      const c = Date.parse(d.created_at);
      if (Number.isFinite(c) && c < first) first = c;
      const e = d.completed_at ? Date.parse(d.completed_at) : c;
      if (Number.isFinite(e) && e > lastEnd) lastEnd = e;
      if (Number.isFinite(d.wall_clock_ms)) act += d.wall_clock_ms;
    }
    if (!Number.isFinite(first) || !Number.isFinite(lastEnd)) continue;
    tickets++;
    activeMs += act;
    idleMs += Math.max(0, lastEnd - first - act);
  }
  return {
    ticket_cycle_time,
    agent_idle_buckets: {
      estimation: true,
      tickets, active_ms_total: activeMs, idle_ms_total: idleMs,
      note: '空闲含人闸+排队（估算标注义务）；票周期端点=首次派发→末次派发完成（merge 锚面停摆——idle 为上界估算）',
    },
  };
}

/** ISO 周桶 → 该周周一 00:00:00Z epoch ms（jan4 恒属 W1——thursday 法逆推；WB-4 partial 判据用）。 */
function isoWeekStartMs(weekKey) {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!m) return null;
  const jan4 = Date.UTC(Number(m[1]), 0, 4);
  const dow = (new Date(jan4).getUTCDay() || 7);   // Mon=1..Sun=7
  return jan4 - (dow - 1) * 86_400_000 + (Number(m[2]) - 1) * 7 * 86_400_000;
}

/** M4-1 周趋势（week-bucket-rules.md 冻结规则 WB-1..WB-6——规则 ID 追溯）。
 *  事件面桶位=scoped 派发周桶；票级归属=untruncated 首次派发周桶（WB-1 fallback——merge 锚面停摆期全部
 *  fallback+attribution_basis 披露；WB-5 归属不受 --since/--until 截断）。
 *  P1-1（红队修复轮）：票级归属键=post-join 归因面 slug（attrFaceMap 传参——m3Face 同法）且只收
 *  TICKET_FACE（null 跳过，与 m2/m3 同面）——raw slug 下 CANDIDATE/UNATTRIBUTED 行聚 null 幻影桶、
 *  纯升级票（无 DIRECT 派发）缺桶/quality_rework_tickets 漏。 */
function m4WeekTrend({ scoped, untruncated, gateBlocking, attrFaceMap, untruncatedReworkSlugs }) {
  const firstDispMsBySlug = new Map();   // WB-1 fallback 锚：未截断面首次派发（any role）
  for (const e of untruncated) {
    if (e.event_kind !== 'dispatch' || !e.created_at) continue;
    const ms = Date.parse(e.created_at);
    if (!Number.isFinite(ms)) continue;
    const f = attrFaceMap.get(e.entity_id) ?? { attribution: e.attribution, ticket_slug: e.ticket_slug };
    if (!TICKET_FACE.has(f.attribution) || f.ticket_slug == null) continue;   // CANDIDATE/UNATTRIBUTED null 面不入票级（与 m2/m3 同面）
    const prev = firstDispMsBySlug.get(f.ticket_slug);
    if (prev === undefined || ms < prev) firstDispMsBySlug.set(f.ticket_slug, ms);
  }
  const attributionWeekBySlug = new Map();
  for (const [slug, ms] of firstDispMsBySlug) attributionWeekBySlug.set(slug, isoWeekBucket(ms));
  // 桶位=事件面（scoped 派发）
  const dispByWeek = new Map();
  let minMs = Infinity, maxMs = -Infinity;
  for (const e of scoped) {
    if (e.event_kind !== 'dispatch' || !e.created_at) continue;
    const ms = Date.parse(e.created_at);
    if (!Number.isFinite(ms)) continue;
    if (ms < minMs) minMs = ms;
    if (ms > maxMs) maxMs = ms;
    const w = isoWeekBucket(ms);
    dispByWeek.set(w, (dispByWeek.get(w) ?? 0) + 1);
  }
  const weeks = [...dispByWeek.keys()].sort().map(week => ({ week, dispatches: dispByWeek.get(week), tickets: 0, quality_rework_tickets: gateBlocking ? null : 0 }));
  const ticketsByWeek = new Map(weeks.map(w => [w.week, w]));
  for (const [slug, week] of attributionWeekBySlug) {
    const bucket = ticketsByWeek.get(week);
    if (bucket) bucket.tickets++;   // WB-2：票级各自计入（归属桶不在事件面桶集=不显示≠改判——WB-5）
  }
  if (!gateBlocking) {
    for (const slug of untruncatedReworkSlugs) {
      const bucket = ticketsByWeek.get(attributionWeekBySlug.get(slug));
      if (bucket) bucket.quality_rework_tickets++;
    }
  }
  // WB-4 partial：首桶=序列最小主时戳 > 桶起点；末桶=序列最大主时戳 < 桶终点（周中日历覆盖判定——诚实）
  if (weeks.length > 0) {
    const first = weeks[0], last = weeks[weeks.length - 1];
    const fs = isoWeekStartMs(first.week);
    if (fs !== null && minMs > fs) first.partial = true; else first.partial = false;
    const ls = isoWeekStartMs(last.week);
    if (ls !== null) last.partial = last.partial === true || maxMs < ls + 7 * 86_400_000;
    else last.partial = true;
    for (let i = 1; i < weeks.length - 1; i++) weeks[i].partial = false;
  }
  return {
    rules_anchor: 'templates/stats/week-bucket-rules.md',
    attribution_basis: 'first-dispatch-fallback',
    attribution_note: 'WB-1 fallback：merge 锚物化面停该子面呈报（stats-5）——锚面落位前全部票按首次派发周桶归属；WB-5 归属不受 --since/--until 截断（时窗只作用事件面）；票级归属=post-join 归因面 slug（CANDIDATE/UNATTRIBUTED null 面不入票级——与 m2/m3 同面）',
    weeks,
  };
}

/** M4-4 路由变更对照（P1-2 诚实骨架制/D3）：verified 变更点=route_anchor 三锚组（repo commit/local hash/
 *  卡 hash——P3-3 收窄）非 unknown 的变更；<2 → NOT_ENOUGH_CHANGE_POINTS（诚实态非缺陷——生产桩值恒
 *  unknown，锚采集面归后续票 route-anchor-collection，spec-gap 登记）。 */
function m4RouteComparison(scoped) {
  const UNKNOWN = 'unknown';
  const ANCHOR_KEYS = ['repo_models_config_commit', 'local_override_hash', 'generated_role_card_hash'];
  const disp = scoped.filter(e => e.event_kind === 'dispatch' && e.created_at)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.entity_id < b.entity_id ? -1 : 1));
  const groupOf = (d) => ANCHOR_KEYS.map(k => String(d.route_anchor?.[k] ?? UNKNOWN));
  const verified = (g) => g.every(v => v !== UNKNOWN);
  const miss = { dispatches_total: disp.length, repo_commit_unknown: 0, local_override_hash_unknown: 0, generated_role_card_hash_unknown: 0, fully_anchored: 0 };
  for (const d of disp) {
    const g = groupOf(d);
    if (g[0] === UNKNOWN) miss.repo_commit_unknown++;
    if (g[1] === UNKNOWN) miss.local_override_hash_unknown++;
    if (g[2] === UNKNOWN) miss.generated_role_card_hash_unknown++;
    if (verified(g)) miss.fully_anchored++;
  }
  const points = [];
  for (let i = 1; i < disp.length; i++) {
    const prev = disp[i - 1], cur = disp[i];
    const pg = groupOf(prev), cg = groupOf(cur);
    if (pg.join('\u0000') === cg.join('\u0000')) continue;   // 锚组不变=非变更点
    if (!verified(cg)) continue;   // verified-only：变更后锚组三锚齐才入对照
    points.push({
      at: cur.created_at, repo_commit: cg[0], local_hash: cg[1], card_hash: cg[2],
      effective_model_before: prev.route_anchor?.effective_model ?? null,
      effective_model_after: cur.route_anchor?.effective_model ?? null,
    });
  }
  const ok = points.length >= 2;
  return {
    state: ok ? 'ok' : 'NOT_ENOUGH_CHANGE_POINTS',
    verified_change_points: points.length,
    points: ok ? points : [],
    anchor_missing: miss,
    note: 'verified=变更点后锚组三锚（repo models config commit/local override hash/生成角色卡 hash）非 unknown；生产现状如实：routeAnchor 桩值恒 unknown→恒 NOT_ENOUGH（诚实态非缺陷）；锚采集面归后续票 route-anchor-collection（spec-gap 登记）',
  };
}

/** 一屏摘要（stats-5 交付物 3：终端表+--json 同构）。 */
function summaryFace({ scoped, gateBlocking, internals, weekTrend }) {
  const matrix = {};
  for (const e of scoped) {
    if (e.event_kind !== 'dispatch' || !e.created_at) continue;
    const month = String(e.created_at).slice(0, 7);
    const role = roleVariantKey(e);
    const model = e.route_anchor?.effective_model ?? 'unknown';
    if (!matrix[month]) matrix[month] = {};
    if (!matrix[month][role]) matrix[month][role] = {};
    matrix[month][role][model] = (matrix[month][role][model] ?? 0) + 1;
  }
  for (const m of Object.keys(matrix).sort()) {
    matrix[m] = Object.fromEntries(Object.keys(matrix[m]).sort().map(r => [r, Object.fromEntries(Object.keys(matrix[m][r]).sort().map(k => [k, matrix[m][r][k]]))]));
  }
  const qualityList = gateBlocking || !internals
    ? { state: 'blocked', tickets: null, note: '门红态分子源受阻（classifier-acceptance:19）——列表阻断非空' }
    : { state: 'available', tickets: [...internals.reworkAttemptsBySlug.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([slug, n]) => ({ slug, quality_rework_attempts: n })) };
  const bars = '▁▂▃▄▅▆▇█';
  const maxT = Math.max(0, ...weekTrend.weeks.map(w => w.tickets));
  const text = weekTrend.weeks.map(w => `${w.week} ${bars[maxT === 0 ? 0 : Math.round((w.tickets / maxT) * (bars.length - 1))]}${w.partial ? '*' : ''}`).join('  ');
  return {
    role_model_month_matrix: matrix,
    quality_rework_tickets: qualityList,
    week_sparkline: { text, series: weekTrend.weeks.map(w => ({ week: w.week, tickets: w.tickets, dispatches: w.dispatches })), legend: '*=partial 周（WB-4）' },
  };
}

/** 票 C P1-2（成组提交）局部件：独占创建式原子落盘——仅 report --out 路径使用；
 *  util.atomicWriteFile 全局面不动（rename 覆写语义为 segments 等消费面依赖，本路径需独占创建）。
 *  语义：tmp 全量写+fsync → linkSync(tmp, final)（目标在场=EEXIST）→ unlink tmp → 目录 fsync。
 *  取舍：openSync(final,'wx') 直写会在写入窗暴露半成品 final——崩溃残留=截断体，重跑字节比对恒不等
 *  → 伪 OUT_ORPHAN_AMBIGUOUS 歧义；link 挂名原子，final 仅以完整态出现，崩溃残留只会是
 *  「完整 final+缺席 manifest」的可自愈孤儿形态。tmp 与 final 同目录=同卷硬链（无 EXDEV）。
 *  返回 false=输家（EEXIST——目标已被并发对家独占）；其他异常照抛。 */
function exclusiveWrite(finalPath, content) {
  const tmp = `${finalPath}.tmp-${randomUUID().slice(0, 8)}`;
  writeFileSync(tmp, content, 'utf8');
  try {
    const fd = openSync(tmp, 'r+');
    try { fsyncSync(fd); } finally { closeSync(fd); }
    try { linkSync(tmp, finalPath); }
    catch (e) {
      if (e.code === 'EEXIST') return false;
      throw e;
    }
  } finally {
    try { unlinkSync(tmp); } catch { /* 输家 tmp 尽力清理；缺席=无残留 */ }
  }
  fsyncDir(dirname(finalPath));
  return true;
}

export async function cmdReport(opts) {
  const { storeRoot, flags } = opts;
  // 参数面校验（零副作用先于仓访问）
  const projectsRaw = flags.project ?? null;
  const projects = projectsRaw === null ? null : [...[projectsRaw].flat(2)].map(String);
  const parseBound = (v, name) => {
    if (v === undefined || v === true) return null;
    if (typeof v !== 'string' || !RFC3339_UTC_RE.test(v) || !Number.isFinite(Date.parse(v))) {
      console.error(`USAGE：report --${name} 须 RFC3339 UTC 规范形（YYYY-MM-DDTHH:MM:SS[.fff]Z）；实得 ${JSON.stringify(v)}`);
      return { usage: EXIT.USAGE };
    }
    return v;
  };
  const sinceR = parseBound(flags.since, 'since');
  if (sinceR?.usage) return sinceR.usage;
  const untilR = parseBound(flags.until, 'until');
  if (untilR?.usage) return untilR.usage;
  const since = sinceR ?? null;
  const until = untilR ?? null;

  // 布局+ACL preflight（D8：异常目录 → exit≠0，报文 stderr）
  const checks = ensureStoreLayout(storeRoot);
  const aclFail = checks.find(c => !c.ok);
  if (aclFail) { for (const c of checks) if (!c.ok) console.error(`[ACL] ${c.reason}`); return EXIT.ACL; }

  // ── generation 快照读（closed segments only——§5.4-8；partial/进行中态结构性不可见）──
  const gen = EE.currentGeneration(storeRoot);
  const genDir = EE.genDirOf(storeRoot, gen);
  const { events, segments } = EE.loadCorpus(genDir);
  const segmentShas = segments.map(s => s.manifest.sha256);

  // watermark（数据派生）：未过滤快照全事件主时戳最大者原文
  let watermark = null, watermarkMs = -Infinity;
  for (const e of events) {
    const ts = primaryTs(e);
    if (ts == null) continue;
    const ms = Date.parse(ts);
    if (Number.isFinite(ms) && ms > watermarkMs) { watermarkMs = ms; watermark = ts; }
  }

  // ── 过滤（projects/since-until 半开区间）──
  const sinceMs = since === null ? -Infinity : Date.parse(since);
  const untilMs = until === null ? Infinity : Date.parse(until);
  const dispatchProjectBySlug = new Map();
  for (const e of events) if (e.event_kind === 'dispatch' && e.project_id) dispatchProjectBySlug.set(e.ticket_slug, e.project_id);
  const entityProject = new Map();   // dispatch entity_id → project_id（model-request 经 parent 归属）
  for (const e of events) if (e.event_kind === 'dispatch' && e.project_id) entityProject.set(e.entity_id, e.project_id);
  const projectOf = (e) => {
    if (e.event_kind === 'dispatch') return e.project_id ?? null;
    if (e.event_kind === 'model-request') return entityProject.get(e.parent_entity_id) ?? null;
    if (e.event_kind === 'observation') return dispatchProjectBySlug.get(e.ticket_slug) ?? null;
    return null;
  };
  const filtered = projects === null ? events : events.filter(e => projects.includes(projectOf(e)));
  const scoped = filtered.filter(e => {
    const ts = primaryTs(e);
    if (ts == null) return true;   // 无主时戳事件（缺列历史面）不因时窗被剔除
    const ms = Date.parse(ts);
    return ms >= sinceMs && ms < untilMs;
  });

  // ── M1 运行计量（§4 :163-168 全量）──
  const dispatches = scoped.filter(e => e.event_kind === 'dispatch');
  const tally = (list, keyOf) => {
    const t = {};
    for (const x of list) { const k = keyOf(x); if (k != null) t[k] = (t[k] ?? 0) + 1; }
    return Object.fromEntries(Object.keys(t).sort().map(k => [k, t[k]]));
  };
  // 共享归因面（attribution-explicit-closure r2）：EXPLICIT join 消费侧——M1 分布/coverage/candidates/
  // excluded_unattributed 与 m2/m3/B9 票级准入同源（一处实现三处消费）
  const attrFace = attributionFace(scoped);
  const faceOf = (e) => attrFace.face.get(e.entity_id) ?? { attribution: e.attribution, ticket_slug: e.ticket_slug, basis: null };
  const m1 = {
    dispatches_total: dispatches.length,
    dispatches_by_role_variant: tally(dispatches, roleVariantKey),
    dispatches_by_project: tally(dispatches, e => e.project_id ?? null),
    dispatches_by_day_utc: tally(dispatches.filter(e => e.created_at), e => String(e.created_at).slice(0, 10)),
    models_by_adapter: (() => {
      // 票 C P2-3：zcode 行改实源——tally zcode-sqlite model-request 事件的实际 model
      // （project.mjs 投影已载 model 字段），与 kimi/codex 行同源同法；弃 route_anchor.effective_model
      // 桩值 tally（生产桩值恒 unknown——恒 unknown 桶无计量价值）。
      const byAdapter = {};
      for (const adapter of ['zcode-sqlite', 'kimi-wire', 'codex-sessions']) {
        const t = tally(scoped.filter(e => e.event_kind === 'model-request' && e.adapter_id === adapter), e => e.model ?? null);
        if (Object.keys(t).length > 0) byAdapter[adapter] = t;
      }
      return byAdapter;
    })(),
    wall_clock_ms_total: dispatches.reduce((s, e) => s + (Number.isFinite(e.wall_clock_ms) ? e.wall_clock_ms : 0), 0),
    model_duration_ms_total: scoped.filter(e => e.event_kind === 'model-request').reduce((s, e) => s + (Number.isFinite(e.duration_ms) ? e.duration_ms : 0), 0),
    token_five_way_by_model: (() => {
      const acc = {};
      for (const e of scoped) {
        if (e.event_kind !== 'model-request' || !e.model) continue;
        const k = `${e.adapter_id}|${e.model}`;
        if (!acc[k]) acc[k] = Object.fromEntries(TOKEN_LANES.map(x => [x, 0]));
        for (const lane of TOKEN_LANES) if (Number.isFinite(e.usage?.[lane])) acc[k][lane] += e.usage[lane];
      }
      return Object.fromEntries(Object.keys(acc).sort().map(k => [k, acc[k]]));
    })(),
    usage_na_by_model: (() => {
      const acc = {};
      for (const e of scoped) {
        if (e.event_kind !== 'model-request' || !e.model) continue;
        const k = `${e.adapter_id}|${e.model}`;
        if (!acc[k]) acc[k] = Object.fromEntries(TOKEN_LANES.map(x => [x, 0]));
        for (const lane of TOKEN_LANES) if (!Number.isFinite(e.usage?.[lane])) acc[k][lane]++;
      }
      return Object.fromEntries(Object.keys(acc).sort().map(k => [k, acc[k]]));
    })(),
    retry_count_total: scoped.filter(e => e.event_kind === 'model-request').reduce((s, e) => s + (Number.isFinite(e.retry_count) ? e.retry_count : 0), 0),
    terminal_failed: dispatches.filter(e => e.state === 'terminal_failed').length,
    failure_rate: (() => {
      const denominator = dispatches.filter(e => TERMINAL_COUNTED.has(e.state)).length;
      // 分子=terminal_failed+missing_child（票 C P0-4；state-mapping.md:81/:84 冻结——missing_child
      // 终态声明无法核实按失败面处理，计入失败率分子；修复前分子只数 terminal_failed）。
      // 分母=TERMINAL_COUNTED 三态（stats-1 gap-5 已裁）；0/0 沿用 rateOf null 语义。
      const numerator = dispatches.filter(e => e.state === 'terminal_failed' || e.state === 'missing_child').length;
      return { numerator, denominator, rate: rateOf(numerator, denominator) };
    })(),
    // attribution-explicit-closure r2（P2-2 钉死键位=对象尾）：post-join 派生值分布——非 collect 原值
    attribution: (() => {
      const c = { explicit: 0, direct: 0, candidate: 0, unattributed: 0 };
      for (const e of dispatches) {
        const a = faceOf(e).attribution;
        if (a === 'EXPLICIT') c.explicit++;
        else if (a === 'DIRECT') c.direct++;
        else if (a === 'CANDIDATE') c.candidate++;
        else if (a === 'UNATTRIBUTED') c.unattributed++;
      }
      return {
        ...c,
        explicit_conflict: attrFace.counts.explicit_conflict, explicit_slug_divergence: attrFace.counts.explicit_slug_divergence,
        note: 'post-join 派生值（消费侧 EXPLICIT join 归因面——attribution-explicit-closure 裁决记录，非 collect 原值；explicit 含 DIRECT 标签升级〔slug 分歧时归属保留 worktree〕；MANUAL_RECONCILED 行由 m2.manual_reconciled_subset 面承载不入四计数）',
      };
    })(),
    // M1 披露（P1-2 消解）：有 child_session_id 的 dispatch 可 join 面 covered/total——随票龄增长可见
    explicit_join_coverage: {
      covered: attrFace.coverage.covered, total: attrFace.coverage.total,
      rate: rateOf(attrFace.coverage.covered, attrFace.coverage.total),
      note: 'join 面=child_session_id 非空 dispatch；covered=ledger session_id 命中（含冲突拒绝行——ledger 证据在场）；ledger 侧 execution_session 随票文件变更重 mine 回填（mine 存量 dedupe 语义——全量回填不做，VR-F03 冻结）',
    },
  };

  // ── candidates 顶层披露面+排除计数（attribution-explicit-closure r2；键位冻结=m1 之后 m2 之前）──
  // CANDIDATE 票级隔离的披露面（门红不灭——非 classifier 派生，与 manual_reconciled_subset 同哲学）：
  // 实体级标识令 reconcile 工作流可直接组装 target_entity_ids（P1-4 衔接闭合）。
  const candRows = dispatches.filter(e => faceOf(e).attribution === 'CANDIDATE')
    .map(e => ({
      entity_id: e.entity_id, created_at: e.created_at ?? null, role: roleVariantKey(e),
      project_id: e.project_id ?? null, day: e.created_at ? String(e.created_at).slice(0, 10) : null,
    }))
    .sort((a, b) => (a.entity_id < b.entity_id ? -1 : 1));
  const candidates = {
    note: 'join 后仍 CANDIDATE 的 dispatch 实体级清单+聚合上卷（project/日期/角色）——票级面只收 EXPLICIT|DIRECT|MANUAL_RECONCILED；候选清单供人工 reconcile（22:94 消费权限：永不入票级）',
    rows: candRows,
    by_project: tally(candRows, r => r.project_id),
    by_day: tally(candRows, r => r.day),
    by_role: tally(candRows, r => r.role),
  };
  // join 后仍 null-slug 的 dispatch 行数（口径=按 dispatch 行，P3-4）——票级面排除披露
  const excludedUnattributed = dispatches.filter(e => faceOf(e).ticket_slug == null).length;

  // ── M2 质量计量（三层门红态）──
  const gate = classifierGateRow(storeRoot);
  const internals = {};   // stats-5：M4 消费的 join 面（门绿/降级时由 m2AutoFace 填充；不入 JSON 体）
  const m2 = {
    classifier_gate: gate,
    auto_face_state: gate.blocking ? 'blocked-classifier-gate-red' : 'available',
  };
  if (gate.blocking) {
    m2.three_pass = null;
    m2.quality_rework_rate = null;
    m2.rework_spend = null;
    m2.attempt_distribution = null;
    m2.qa_defect_density = null;
  } else {
    Object.assign(m2, m2AutoFace(scoped, internals));
  }
  m2.manual_reconciled_subset = manualSubset(storeRoot, scoped);

  // ── stats-5：M3 流动计量（dispatch 面——不受门阻）──
  const m3 = m3Face(scoped.filter(e => e.event_kind === 'dispatch'), attrFace.face);

  // ── stats-5：M4 趋势与摩擦（两态分层 D2：错误门红→M2 维度行 blocked 非 0；合计门降级→照常+LOW_COVERAGE 标注）──
  const m4Join = gate.blocking ? null : internals;
  const rework_cost_share = m4Join
    ? (() => {
        const lanes = Object.fromEntries(TOKEN_LANES.map(k => [k, { rework: 0, total: 0, share: null }]));
        for (const e of scoped) {
          if (e.event_kind !== 'model-request') continue;
          const isRework = m4Join.reworkDispatchIds.has(e.parent_entity_id);
          for (const lane of TOKEN_LANES) {
            if (!Number.isFinite(e.usage?.[lane])) continue;
            lanes[lane].total += e.usage[lane];
            if (isRework) lanes[lane].rework += e.usage[lane];
          }
        }
        for (const lane of TOKEN_LANES) lanes[lane].share = lanes[lane].total > 0 ? +(lanes[lane].rework / lanes[lane].total).toFixed(4) : null;
        return {
          state: 'available', lanes, excluded_secondary: [...EXCLUDED_SECONDARY],
          note: 'Σ 质量性返工 attempt 派发挂链 token / Σ 全部 token（面一）；五路分列（D1 禁跨模型单值）；剔除集=quality_rework∧secondary∉剔除集（classifier-v2 裁决 A 同口径）',
        };
      })()
    : {
        state: 'blocked', lanes: null, excluded_secondary: [...EXCLUDED_SECONDARY],
        note: '门红态分子源受阻（wrong_label_gate=fail——classifier-acceptance:19 阻断面）——行标 blocked 非 0',
      };
  const TRANSFER_SEMANTICS = '「转移」统一语义=拒因事件后紧邻的 developer 修复 attempt 派发存在性（P2-3 映射：join 面=质量性返工行↔dev 派发序，join 成功=修复链在档）';
  const adjacent_rejections = m4Join
    ? (() => {
        const buckets = { reviewer: 0, qa: 0, red_team: 0, premerge: 0 };
        for (const x of m4Join.joinedRework) {
          if (!x.dispatch) continue;   // 修复派发缺席=转移未发生
          if (x.deriv?.trigger_stage in buckets) buckets[x.deriv.trigger_stage]++;
        }
        return { state: 'available', buckets, transfer_semantics: TRANSFER_SEMANTICS, note: '按 trigger_stage 四桶计数（reviewer/qa/red_team/premerge 拒→dev 修链转移数）' };
      })()
    : { state: 'blocked', buckets: null, transfer_semantics: TRANSFER_SEMANTICS, note: '门红态分子源受阻（wrong_label_gate=fail）——行标 blocked 非 0' };
  // 周趋势归属面=untruncated join（WB-5：票级归属不受 --since/--until 截断）。
  // P1-1（红队修复轮）：untruncated 归因面一次计算两处消费——m4WeekTrend 收参（m3Face 模式同法）+
  // m2AutoFace 收参（消三次重算之一——review 轮 P3-4 部分吸收；门红态 m4WeekTrend 票级计数仍需本面）。
  const untruncatedAttrFace = attributionFace(filtered);
  const untruncatedInternals = gate.blocking ? null : (() => { const it = {}; m2AutoFace(filtered, it, untruncatedAttrFace); return it; })();
  const weekTrend = m4WeekTrend({
    scoped, untruncated: filtered, gateBlocking: gate.blocking, attrFaceMap: untruncatedAttrFace.face,
    untruncatedReworkSlugs: untruncatedInternals ? [...untruncatedInternals.reworkAttemptsBySlug.keys()] : [],
  });
  const m4 = {
    week_trend: weekTrend,
    rework_cost_share,
    adjacent_rejections,
    route_comparison: m4RouteComparison(scoped),
  };
  const summary = summaryFace({ scoped, gateBlocking: gate.blocking, internals: m4Join, weekTrend });
  // D2 映射钉死：combined_gate='downgrade-triggered' → HISTORICAL_CLASSIFICATION_LOW_COVERAGE（classifier-acceptance:18）
  const annotations = gate.gates_final?.combined_gate === 'downgrade-triggered' ? ['HISTORICAL_CLASSIFICATION_LOW_COVERAGE'] : [];

  // ── canonical 体（D3：键构造序冻结/集合稳定排序/禁时钟字段/UTC 钉死）──
  const report = {
    command: 'report',
    report_kind: 'all-store',
    spec_anchor: 'docs/22 §4（M1/M2）/§5.6（输出契约）/stats-4 票面 D1-D5',
    corpus: {
      generation: gen,
      closed_segments: segments.length,
      segment_shas: segmentShas,
      events_total: events.length,
      events_after_filters: scoped.length,
    },
    filters: { projects, since, until },
    revision_watermark: watermark,
    m1,
    // attribution-explicit-closure r2（P2-4 钉死）：candidates/excluded_unattributed=body 顶层新键，
    // 落 m1 之后 m2 之前（构造序冻结面——恒等体键序稳定）
    candidates,
    excluded_unattributed: excludedUnattributed,
    m2,
    m3,
    m4,
    summary,
    annotations,
  };
  const body = JSON.stringify(report, null, 2);

  // ── 输出面：--out（白名单+周桶+manifest） / --json（canonical 体） / 终端表 ──
  if (flags.out !== undefined) {
    const name = String(flags.out).replaceAll('\\', '/');
    const isAbsolute = name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.startsWith('\\\\') || name.startsWith('//');
    const badSegs = name.split('/').filter(s => s === '..' || s === '');
    if (typeof flags.out !== 'string' || name === '' || isAbsolute || badSegs.length > 0) {
      console.error(`OUT_PATH_REJECTED：--out 仅接受 <storeRoot>/reports/ 下相对名（禁绝对路径/../ 逃逸/空段）；实得 ${JSON.stringify(flags.out)}（D5 白名单）`);
      return EXIT.FAIL;
    }
    if (segments.length === 0) {
      console.error('NO_CLOSED_SEGMENTS：空仓（无 closed segment）不可产 report manifest——report-manifest-v1 segment_shas minItems=1 契约不可满足（stdout 模式可出零值报告）');
      return EXIT.FAIL;
    }
    const bucket = isoWeekBucket(watermarkMs);
    const dir = join(storeRoot, 'reports', bucket);
    mkdirSync(dir, { recursive: true });
    const finalPath = join(dir, name);
    const manifestPath = `${finalPath}.manifest.json`;
    // manifest（H8 分层③：--out 模式产物；含 generated_at=报告时刻——不在恒等面）
    const manifest = {
      manifest_kind: 'report-manifest',
      report_id: `report-${sha8(body)}`,
      generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      bundle_id: 'all-store',
      generation: gen,   // 红队修复轮二 P1-1③：世代锚（prune 旧代清理的引用保护消费）
      classifier_version: CLASSIFIER_VERSION,
      derivation_selection_policy: 'latest-valid;manual>auto',
      revision_watermark: watermark,
      segment_shas: segmentShas,
      timezone: 'UTC',
      params: { projects, since, until, corpus: 'all-store-closed-segments' },
    };
    const errs = validateFixture({ fixture_kind: 'report-manifest', ...manifest });
    if (errs.length) {
      console.error(`MANIFEST_CONTRACT_FAIL：\n${errs.map(e => `  ${e.rule} ${e.pointer} — ${e.message}`).join('\n')}`);
      return EXIT.FAIL;
    }
    // ── 票 C P1-2：双文件成组提交（并发同名安全+崩溃孤儿自愈）──
    // 并发：独占挂名（exclusiveWrite=linkSync EEXIST）——两进程同跑同名恰一方成功、零部分混合态
    //   （manifest 对 final 独占成组，输家 fail-loud；body 字节相同时对家 manifest 即本组有效成员）。
    // 自愈：final 在场而 manifest 缺席=前次崩溃孤儿——重算 body 与存量字节恒等 → 补写 manifest 完成
    //   成组；不恒等 → OUT_ORPHAN_AMBIGUOUS fail-loud（成组两文件来源歧义，人工裁定，零静默拼组）。
    // manifest 单在场（final 缺席）非本工具可产形态（final 恒先落）——照 append 禁覆写拒收。
    const bodyBytes = Buffer.from(body + '\n', 'utf8');
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    const orphanAmbiguous = (existing) => {
      console.error(`OUT_ORPHAN_AMBIGUOUS：reports/${bucket}/${name} 在场孤儿与重算 report 体字节不等（存量 ${existing.length}B ≠ 重算 ${bodyBytes.length}B）——成组两文件来源歧义，拒绝静默拼组/改写（人工裁定：核留存档后删孤儿重跑，或另选 --out 名）`);
      return EXIT.FAIL;
    };
    if (existsSync(finalPath) && existsSync(manifestPath)) {
      console.error(`OUT_FILE_EXISTS：reports/${bucket}/${name}(.manifest.json) 成组在场——append 语义禁覆写历史工件`);
      return EXIT.FAIL;
    }
    if (!existsSync(finalPath) && existsSync(manifestPath)) {
      console.error(`OUT_FILE_EXISTS：reports/${bucket}/${name}.manifest.json 在场而 ${name} 缺席（非本工具可产形态——final 恒先落）——append 语义禁覆写，人工核查`);
      return EXIT.FAIL;
    }
    if (existsSync(finalPath)) {
      const existing = readFileSync(finalPath);
      if (!existing.equals(bodyBytes)) return orphanAmbiguous(existing);
      // 字节恒等 → 落入下方 manifest 补写（自愈完成成组）
    } else if (!exclusiveWrite(finalPath, bodyBytes)) {
      // 并发输家（对家已挂名 final）：回到成组语义——同快照恒等则竞逐 manifest（恰一方成功），否则歧义
      const existing = readFileSync(finalPath);
      if (!existing.equals(bodyBytes)) return orphanAmbiguous(existing);
    }
    if (!exclusiveWrite(manifestPath, manifestBytes)) {
      console.error(`OUT_FILE_EXISTS：reports/${bucket}/${name}.manifest.json 已在场——append 语义禁覆写（或并发对家已先完成成组：恰一方成功）`);
      return EXIT.FAIL;
    }
    console.log(JSON.stringify({ command: 'report', out: `reports/${bucket}/${name}`, manifest: `reports/${bucket}/${name}.manifest.json`, revision_watermark: watermark, auto_face_state: m2.auto_face_state }, null, 2));
    return EXIT.OK;
  }
  if (flags.json === true) {
    console.log(body);
    return EXIT.OK;
  }
  // 终端表（默认形态——§5.6「终端表+--json」双形态；本地时区显示面非恒等体）
  const lines = [
    `report（all-store）generation=${gen} closed_segments=${segments.length} events=${events.length} watermark=${watermark ?? 'n/a'}`,
    `[M1] 派发 ${m1.dispatches_total}（失败 ${m1.terminal_failed}，失败率 ${m1.failure_rate.rate ?? 'n/a'}）墙钟 ${m1.wall_clock_ms_total}ms 模型时长 ${m1.model_duration_ms_total}ms retry ${m1.retry_count_total}`,
    `[M2] 分类质量门 ${gate.state}${gate.version_match === false ? '（版本差）' : ''} auto 面 ${m2.auto_face_state}`,
  ];
  if (!gate.blocking) {
    lines.push(`[M2] pass·reviewer-first ${m2.three_pass.reviewer_first.numerator}/${m2.three_pass.reviewer_first.denominator} · pipeline-clean ${m2.three_pass.pipeline_clean.numerator}/${m2.three_pass.pipeline_clean.denominator} · no-quality-rework ${m2.three_pass.no_quality_rework.numerator}/${m2.three_pass.no_quality_rework.denominator}`);
    lines.push(`[M2] 质量性返工率 ${m2.quality_rework_rate.numerator}/${m2.quality_rework_rate.denominator} 返工花费 ${m2.rework_spend.wall_clock_ms}ms QA 缺陷密度 ${m2.qa_defect_density.qa_triggered_rework_attempts}/${m2.qa_defect_density.merged_tickets}`);
  }
  lines.push(`[M2] 人工归因子集 entities=${m2.manual_reconciled_subset.entities} tickets=${m2.manual_reconciled_subset.tickets}`);
  // stats-5：M3/M4/一屏摘要（终端表——本地时区显示面非恒等体）
  lines.push(`[M3] 周期时间 ${m3.ticket_cycle_time.state}（merge 锚物化面停该子面呈报——详见 --json reason）· agent/空闲 active ${m3.agent_idle_buckets.active_ms_total}ms / idle ${m3.agent_idle_buckets.idle_ms_total}ms（estimation）`);
  lines.push(`[M4] 周趋势 ${summary.week_sparkline.text}`);
  lines.push(`[M4] 返工成本占比 ${rework_cost_share.state === 'available'
    ? TOKEN_LANES.map(k => `${k} ${rework_cost_share.lanes[k].share ?? 'n/a'}`).join(' ')
    : 'blocked（门红态分子源受阻——非 0）'} · 邻接拒绝 ${adjacent_rejections.state === 'available'
    ? `reviewer ${adjacent_rejections.buckets.reviewer}/qa ${adjacent_rejections.buckets.qa}/red_team ${adjacent_rejections.buckets.red_team}/premerge ${adjacent_rejections.buckets.premerge}`
    : 'blocked（门红态分子源受阻——非 0）'}`);
  lines.push(`[M4] 路由对照 ${m4.route_comparison.state}（verified ${m4.route_comparison.verified_change_points}/${m4.route_comparison.anchor_missing.dispatches_total} 派发全锚 ${m4.route_comparison.anchor_missing.fully_anchored}——锚缺失统计见 --json）`);
  {
    const mm = summary.role_model_month_matrix;
    const matrixText = Object.keys(mm).map(mo => `${mo} {${Object.entries(mm[mo]).map(([r, models]) => `${r}=${Object.entries(models).map(([md, n]) => `${md}×${n}`).join('+')}`).join(', ')}}`).join(' ');
    lines.push(`[摘要] 角色×模型×月度 ${matrixText || '（无派发）'}`);
    lines.push(`[摘要] 质量性返工票 ${summary.quality_rework_tickets.state === 'available'
    ? (summary.quality_rework_tickets.tickets.map(t => `${t.slug}(${t.quality_rework_attempts})`).join(' ') || '（无）')
    : 'blocked（门红态分子源受阻——非 0）'}`);
  }
  if (annotations.length > 0) lines.push(`[标注] ${annotations.join(', ')}（合计门降级——趋势照常出但不得用于结论性判读）`);
  console.log(lines.join('\n'));
  return EXIT.OK;
}
