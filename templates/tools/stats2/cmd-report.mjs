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

/** 行面（面二）：每实体最新 ticket_snapshot → {slug→[dev 行]}（attempt_no/角色列；D7' 前票面可缺席）。
 *  stats-hygiene-2 交付物 5：latest 政策统一=collected_at 最新者胜（同刻事件序后者胜）——与 ledger 面
 *  （attributionFace P2-1）/effectiveDerivations 同哲学；修复前按 source_revision 取最新，同实体多快照
 *  （票文件变更后重 mine 的 append-only 历史面）下两面对称性破缺（rowFace 可取旧快照而 ledger 取新）。 */
function rowFace(events) {
  const latestSnap = new Map();
  for (const e of events) {
    if (e.event_kind !== 'observation' || e.observation_subtype !== 'ticket_snapshot') continue;
    const prev = latestSnap.get(e.entity_id);
    if (!prev || (e.collected_at ?? '') >= (prev.collected_at ?? '')) latestSnap.set(e.entity_id, e);   // 同刻（>=）：事件序后者胜
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
 * @returns {{face: Map, counts: {explicit_conflict, explicit_slug_divergence}, coverage: {covered, total}, upgraded_entity_ids: string[]}}
 *   basis∈{direct-worktree,explicit-ledger,conflict-refused,unattributed}——internals 诊断面（不入 JSON 体；
 *   MANUAL_RECONCILED 行锚=归档工件面非本 join，basis 如实落 unattributed=本面无机器证据承载）。
 *   upgraded_entity_ids（stats-hygiene-2 交付物 4）：经 join 升级的 dispatch entity_id 清单（排序确定）——
 *   CANDIDATE→EXPLICIT 回填+DIRECT 标签升两类；EXPLICIT→EXPLICIT 确认行不入。入 m1.attribution JSON 体。
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
  const upgradedEntityIds = new Set();   // stats-hygiene-2 交付物 4：经 join 升级的 dispatch entity_id（CANDIDATE→EXPLICIT 回填+DIRECT 标签升）
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
          upgradedEntityIds.add(e.entity_id);   // 升级行①：CANDIDATE→EXPLICIT 回填
        } else if (attribution === 'DIRECT' || attribution === 'EXPLICIT') {
          const labelUpgraded = attribution === 'DIRECT';   // EXPLICIT→EXPLICIT=确认非升级
          attribution = 'EXPLICIT';   // 标签升 EXPLICIT
          if (labelUpgraded) upgradedEntityIds.add(e.entity_id);   // 升级行②：DIRECT 标签升
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
  return { face, counts: { explicit_conflict: explicitConflict, explicit_slug_divergence: explicitSlugDivergence }, coverage: { covered, total: joinTotal }, upgraded_entity_ids: [...upgradedEntityIds].sort() };
}

function m2AutoFace(events, internals, attrFaceResult) {
  // attrFaceResult（红队修复轮 P1-1 收参；stats-hygiene-2 交付物 3 收紧为必传）：调用方在未过滤语料上
  // 算好的 attributionFace 结果——全报告恰一次计算（cmdReport 唯一调用点），scoped/untruncated 两消费形
  // 同面收参（m3Face 传参模式同法）；本函数不再自算（fallback 移除——消重算调用点）。
  const { face: attrFace } = attrFaceResult;
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

/** merge-anchor-materialization r2：共享 merge 锚归属面（一处实现两处消费：本文件 m3Face/m4WeekTrend——
 *  验收④ M4 周趋势与 M3 同源）。语料=merge_anchor 观察事件（mine 自 bundle manifest ticket_merges 物化）；
 *  读取语义=untruncated（P2-2/WB-5：--since/--until/--project 不作用锚面——票级归属不受截断）；
 *  多锚（revert+re-merge 形态=同票多事件并存）取 **max merge_ts** 胜（P2-3——week-bucket-rules v1.1）。
 *  @returns Map<slug, {merge_oid, merge_ts, merge_ts_ms}> */
export function mergeAnchorFace(events) {
  const m = new Map();
  for (const e of events) {
    if (e.event_kind !== 'observation' || e.observation_subtype !== 'merge_anchor') continue;
    const ms = Date.parse(e.merge_ts);
    if (!Number.isFinite(ms)) continue;   // 非法时戳已被 VR-S14 拦（生产面）——防御性跳过
    const prev = m.get(e.ticket_slug);
    if (!prev || ms > prev.merge_ts_ms) m.set(e.ticket_slug, { merge_oid: e.merge_oid, merge_ts: e.merge_ts, merge_ts_ms: ms });
  }
  return m;
}

/** M3 流动计量（stats-5 交付物 1；dispatch 面——不受分类器门阻）。
 *  attribution-explicit-closure r2：attrFaceMap=共享归因面（attributionFace().face）——票级桶只收
 *  TICKET_FACE 且 slug 取 post-join 值（CANDIDATE null 面不入票级指标——22:94 消费权限）。
 *  merge-anchor-materialization r2：anchorFace=共享锚面+untruncatedEvents（首次派发 untruncated 读取——
 *  WB-5 票级语义）；merged 票集分母=P3-1 钉（TICKET_FACE∧terminal_completed developer 派发——与 m2
 *  mergedTickets/b9matrix mergedTicketSlugs 同口径）。 */
function m3Face({ scopedDispatches, attrFaceMap, anchorFace, untruncatedEvents }) {
  const faceOf = (e) => attrFaceMap.get(e.entity_id) ?? { attribution: e.attribution, ticket_slug: e.ticket_slug, basis: null };
  // merged 票集（分母——P3-1：仓内定义；git merge 观察面〔manifest ticket_merges〕不入分母、锚覆盖对其披露）
  const mergedSet = new Set(scopedDispatches
    .filter(e => (e.role === 'developer' || e.role === 'developer-rerun') && e.state === 'terminal_completed' && TICKET_FACE.has(faceOf(e).attribution))
    .map(e => faceOf(e).ticket_slug));
  // 首次派发面（untruncated·any role·TICKET_FACE——cycle 端点=票级真值不受时窗截断；m4 fallback 锚同哲学）
  const firstDispMs = new Map();
  for (const e of untruncatedEvents) {
    if (e.event_kind !== 'dispatch' || !e.created_at) continue;
    const f = faceOf(e);
    if (!TICKET_FACE.has(f.attribution) || f.ticket_slug == null) continue;
    const ms = Date.parse(e.created_at);
    if (!Number.isFinite(ms)) continue;
    const prev = firstDispMs.get(f.ticket_slug);
    if (prev === undefined || ms < prev) firstDispMs.set(f.ticket_slug, ms);
  }
  // ticket cycle time（M3-1 出数——22:175 cycle=merge commit−首次派发）：样本=merged∩有锚票（多锚取
  // max merge_ts——共享面已裁）；无锚票 n/a 不入样本分母（P2-2），覆盖率分母=merged 票集如实披露。
  // p50 约定（P3-2 钉）：升序取 (s[(n-1)>>1]+s[n>>1])/2——奇数=中位值、偶数=中间两值均值（字节恒等面无自由度）。
  const anchoredSlugs = [...mergedSet].filter(slug => anchorFace.has(slug));
  const cycles = [];
  for (const slug of anchoredSlugs) {
    const first = firstDispMs.get(slug);
    if (first === undefined) continue;
    cycles.push(anchorFace.get(slug).merge_ts_ms - first);
  }
  const sorted = [...cycles].sort((a, b) => a - b);
  const p50 = sorted.length === 0 ? null : (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2;
  const ticket_cycle_time = {
    state: sorted.length > 0 ? 'available' : 'no-merge-anchors',
    reason: sorted.length > 0 ? null
      : 'merged 票集内零锚覆盖（未 mine 观察面/E3 rebuild 后未 re-mine〔validate notes 核对面〕/锚采集 n-a）——p50 n/a 如实非 0；分母与覆盖率照出',
    p50_ms: p50,
    sample_size: sorted.length,
    coverage: { covered: anchoredSlugs.length, total: mergedSet.size, rate: rateOf(anchoredSlugs.length, mergedSet.size) },
    note: 'cycle=merge_ts−首次派发（untruncated——WB-5 票级语义；锚读取不受 --since/--until/--project 截断）；分母=merged 票集（TICKET_FACE∧terminal_completed developer 派发——P3-1 钉）；无锚票 n/a 不入 p50 样本分母；p50 偶数样本=中间两值均值（P3-2 钉）；多锚票取 max merge_ts（P2-3/week-bucket-rules v1.1）',
  };
  // agent/空闲分桶（面一时间线；空闲含人闸+排队——估算标注义务）：
  // P2-4 estimation 票级退役：锚在场票周期端点=merge_ts 真值（该票估算退役）；锚缺席票保持
  // 「首次派发→末次派发完成」上界+估算标注（锚缺席态保留）——面级 estimation=任一 fallback 票在场即 true。
  const bySlug = new Map();
  for (const d of scopedDispatches) {
    if (!d.created_at) continue;
    const f = faceOf(d);
    if (!TICKET_FACE.has(f.attribution)) continue;   // CANDIDATE/UNATTRIBUTED null 面不入票级桶
    if (!bySlug.has(f.ticket_slug)) bySlug.set(f.ticket_slug, []);
    bySlug.get(f.ticket_slug).push(d);
  }
  let tickets = 0, activeMs = 0, idleMs = 0, anchoredTickets = 0, fallbackTickets = 0;
  for (const [slug, ds] of bySlug) {
    let first = Infinity, lastEnd = -Infinity, act = 0;
    for (const d of ds) {
      const c = Date.parse(d.created_at);
      if (Number.isFinite(c) && c < first) first = c;
      const e = d.completed_at ? Date.parse(d.completed_at) : c;
      if (Number.isFinite(e) && e > lastEnd) lastEnd = e;
      if (Number.isFinite(d.wall_clock_ms)) act += d.wall_clock_ms;
    }
    if (!Number.isFinite(first) || !Number.isFinite(lastEnd)) continue;
    const a = anchorFace.get(slug);
    const end = a ? a.merge_ts_ms : lastEnd;   // 锚在场=merge 真值端点；缺席=末次派发完成（上界估算）
    tickets++;
    if (a) anchoredTickets++; else fallbackTickets++;
    activeMs += act;
    idleMs += Math.max(0, end - first - act);
  }
  return {
    ticket_cycle_time,
    agent_idle_buckets: {
      estimation: fallbackTickets > 0,
      tickets, anchored_tickets: anchoredTickets, fallback_estimated_tickets: fallbackTickets,
      active_ms_total: activeMs, idle_ms_total: idleMs,
      note: '空闲含人闸+排队；票周期端点=锚在场票取 merge_ts 真值（estimation 票级退役——P2-4），锚缺席票保持首次派发→末次派发完成上界（面级 estimation=true=任一 fallback 票在场）',
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
 *  事件面桶位=scoped 派发周桶；票级归属=WB-1 真锚优先（merge_anchor 事件·untruncated 读取——多锚取
 *  max merge_ts〔P2-3/week-bucket-rules v1.1〕），锚缺席票 fallback=untruncated 首次派发周桶（锚缺席态
 *  保留）；WB-5 归属不受 --since/--until 截断。P2-4 混合态披露：attribution_basis 三值
 *  （merge-anchor/first-dispatch-fallback/mixed）+attribution 两计数。
 *  P1-1（红队修复轮）：票级归属键=post-join 归因面 slug（attrFaceMap 传参——m3Face 同法）且只收
 *  TICKET_FACE（null 跳过，与 m2/m3 同面）——raw slug 下 CANDIDATE/UNATTRIBUTED 行聚 null 幻影桶、
 *  纯升级票（无 DIRECT 派发）缺桶/quality_rework_tickets 漏。 */
function m4WeekTrend({ scoped, untruncated, gateBlocking, attrFaceMap, anchorFace, untruncatedReworkSlugs }) {
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
  // WB-1 归属：锚在场票=merge 周桶（共享锚面与 M3 同源——验收④）；锚缺席票=首次派发周桶（fallback 保留）
  const attributionWeekBySlug = new Map();
  let anchoredTickets = 0, fallbackTickets = 0;
  for (const [slug, ms] of firstDispMsBySlug) {
    const a = anchorFace.get(slug);
    if (a) { attributionWeekBySlug.set(slug, isoWeekBucket(a.merge_ts_ms)); anchoredTickets++; }
    else { attributionWeekBySlug.set(slug, isoWeekBucket(ms)); fallbackTickets++; }
  }
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
    attribution_basis: anchoredTickets === 0 ? 'first-dispatch-fallback' : (fallbackTickets === 0 ? 'merge-anchor' : 'mixed'),
    attribution: { merge_anchor_tickets: anchoredTickets, first_dispatch_fallback_tickets: fallbackTickets },
    attribution_note: 'WB-1：锚在场票按 merge 周桶归属（merge_anchor 事件·untruncated 读取·多锚取 max merge_ts——P2-3/week-bucket-rules v1.1）；锚缺席票 fallback=首次派发周桶（锚缺席态保留）；混合语料 basis=mixed+两计数披露（P2-4）；WB-5 归属不受 --since/--until 截断（时窗只作用事件面）；票级归属=post-join 归因面 slug（CANDIDATE/UNATTRIBUTED null 面不入票级——与 m2/m3 同面）',
    weeks,
  };
}

/** M4-4 路由变更对照（route-anchor-collection r2 门裁定修订——五 P1 吸收）：
 *  P1-1 **同键比较**：变更点=同 role 含 variant 键内相邻锚组变化（跨角色交替不计——消日常角色交替伪变更点洪水）；
 *  P1-2 **双侧 verified**：前后锚组均非 unknown/absent 才入对照（桩→真翻转/absent↔hash=基线建立日非变更点）；
 *  P1-3 **窗粒度语义**：锚=bundle 制作时点只读快照（窗内变迁不可观；变更点时戳=后窗该键首派发）；
 *  P1-4 repo 锚=templates/models.config.json 内容 hash（规范仓真源指纹——不声称生效面，sync 滞后不可观）；
 *  P1-5→effective-model r2：effective_model=dispatch 级 metadata.modelSelection 声明真值（profile 派发时点声明
 *  模型——非实际使用模型，运行时 fallback 不可观；两级缺席=unknown）；**锚组比较不含该字段**（双面语义保持
 *  ——仅入 points before/after 展示）。NOT_ENOUGH 判据维持 ≥2 verified 变更点。 */
function m4RouteComparison(scoped) {
  const UNKNOWN = 'unknown', ABSENT = 'absent';
  const ANCHOR_KEYS = ['repo_models_config_hash', 'local_override_hash', 'generated_role_card_hash'];
  const disp = scoped.filter(e => e.event_kind === 'dispatch' && e.created_at)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.entity_id < b.entity_id ? -1 : 1));
  const keyOf = (d) => (d.variant ? `${d.role}-${d.variant}` : d.role);   // P1-1/P2-3：键粒度=role 含 variant
  const groupOf = (d) => ANCHOR_KEYS.map(k => String(d.route_anchor?.[k] ?? UNKNOWN));
  const verified = (g) => g.every(v => v !== UNKNOWN && v !== ABSENT);   // P2-2：absent（确定不在场）与 unknown（未观测）均非真锚
  const miss = {
    dispatches_total: disp.length,
    repo_hash_unknown: 0, local_override_hash_unknown: 0, generated_role_card_hash_unknown: 0,
    repo_hash_absent: 0, local_override_hash_absent: 0, generated_role_card_hash_absent: 0,
    fully_anchored: 0,
  };
  for (const d of disp) {
    const g = groupOf(d);
    if (g[0] === UNKNOWN) miss.repo_hash_unknown++; else if (g[0] === ABSENT) miss.repo_hash_absent++;
    if (g[1] === UNKNOWN) miss.local_override_hash_unknown++; else if (g[1] === ABSENT) miss.local_override_hash_absent++;
    if (g[2] === UNKNOWN) miss.generated_role_card_hash_unknown++; else if (g[2] === ABSENT) miss.generated_role_card_hash_absent++;
    if (verified(g)) miss.fully_anchored++;
  }
  // P1-1 同键比较：键内时序相邻对照（全局相邻异角色对不入 diff——角色序列回声非路由变迁）
  const byKey = new Map();
  for (const d of disp) {
    const k = keyOf(d);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(d);
  }
  const points = [];
  for (const [key, list] of byKey) {
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1], cur = list[i];
      const pg = groupOf(prev), cg = groupOf(cur);
      if (pg.join('\u0000') === cg.join('\u0000')) continue;   // 锚组不变=非变更点
      if (!verified(pg) || !verified(cg)) continue;   // P1-2 双侧 verified：翻转/基线建立不入对照
      points.push({
        at: cur.created_at, key,
        repo_hash: cg[0], local_hash: cg[1], card_hash: cg[2],
        effective_model_before: prev.route_anchor?.effective_model ?? null,
        effective_model_after: cur.route_anchor?.effective_model ?? null,
      });
    }
  }
  points.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.key < b.key ? -1 : 1));
  const ok = points.length >= 2;
  return {
    state: ok ? 'ok' : 'NOT_ENOUGH_CHANGE_POINTS',
    verified_change_points: points.length,
    points: ok ? points : [],
    anchor_missing: miss,
    note: 'verified=同键（role 含 variant）相邻对照锚组双侧均非 unknown/absent（P1-1 同键比较消角色交替伪点；P1-2 桩→真翻转/absent↔hash=基线建立日非变更点）；锚=bundle 制作时点只读快照——窗粒度配置指纹（窗内变迁不可观，变更点时戳=后窗该键首派发——P1-3）；repo 锚=templates/models.config.json 内容 hash=规范仓真源指纹不声称生效面（sync 滞后不可观——P1-4）；effective_model=dispatch 级 metadata.modelSelection 声明模型（profile 派发时点声明——非实际使用模型，运行时 fallback 不可观；冻结面/字段缺席→unknown——effective-model r2）；锚组比较不含 effective_model（仅入 points before/after 展示）；锚采集面=route-anchor-collection r2',
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
    // P2-1（effective-model r2）语义注记：模型维=声明源——与 m1.models_by_adapter（model-request 实源）双源关系披露
    role_model_month_matrix_note: '模型维=route_anchor.effective_model=dispatch 级 metadata.modelSelection（profile 派发时点**声明**模型——非实际使用模型，运行时 fallback/override 不可观；冻结面/字段缺席→unknown 桶；effective-model r2）；双源关系：实际服务模型观 m1.models_by_adapter（model-request 事件实源）——同报告两面对同一派发可给出不同模型属预期（声明面 vs 实源面）',
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
  // excluded_unattributed 与 m2/m3/B9 票级准入同源（一处实现三处消费）。
  // stats-hygiene-2 交付物 2/3：在**未过滤语料**（events）上恰一次计算，scoped 消费方按 entity_id 查用——
  // --project/--since/--until 过滤不再令升级票 ledger 证据缺席（§V.1：observation 归属映射取 dispatch
  // pre-join slug→project，纯升级票无可命中派发 → ledger 快照被过滤出语料 → scoped 自算面看不到）。
  const attrFace = attributionFace(events);
  // 共享 merge 锚面（merge-anchor-materialization r2）：与 attrFace 同法在**未过滤语料**上恰一次计算
  // （untruncated 读取——P2-2/WB-5）；m3Face/m4WeekTrend 两消费方同面（验收④ M4 与 M3 同源）。
  const anchorFace = mergeAnchorFace(events);
  const faceOf = (e) => attrFace.face.get(e.entity_id) ?? { attribution: e.attribution, ticket_slug: e.ticket_slug, basis: null };
  const m1 = {
    dispatches_total: dispatches.length,
    dispatches_by_role_variant: tally(dispatches, roleVariantKey),
    dispatches_by_project: tally(dispatches, e => e.project_id ?? null),
    dispatches_by_day_utc: tally(dispatches.filter(e => e.created_at), e => String(e.created_at).slice(0, 10)),
    models_by_adapter: (() => {
      // 票 C P2-3：zcode 行实源——tally zcode-sqlite model-request 事件的实际 model（project.mjs 投影已载
      // model 字段），与 kimi/codex 行同源同法；不用 route_anchor.effective_model（effective-model r2 后=
      // 声明源——与本面「实源」双源分工，声明面消费归 summary.role_model_month_matrix，双源关系入其 note）。
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
        // stats-hygiene-2 交付物 4（canonical 落位登记：m1.attribution 对象内新键，explicit_slug_divergence
        // 之后 note 之前）：经 join 升级的 dispatch entity_id 清单（CANDIDATE→EXPLICIT 回填+DIRECT 标签升；
        // 排序确定）——供事后机读（reconcile/审计面），门红态照出（M1 attribution 面 dispatch 派生不受门阻）。
        upgraded_entity_ids: attrFace.upgraded_entity_ids,
        note: 'post-join 派生值（消费侧 EXPLICIT join 归因面——attribution-explicit-closure 裁决记录，非 collect 原值；explicit 含 DIRECT 标签升级〔slug 分歧时归属保留 worktree〕；MANUAL_RECONCILED 行由 m2.manual_reconciled_subset 面承载不入四计数；归因面在未过滤语料上计算——stats-hygiene-2 交付物 2/3）',
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
    Object.assign(m2, m2AutoFace(scoped, internals, attrFace));
  }
  m2.manual_reconciled_subset = manualSubset(storeRoot, scoped);

  // ── stats-5：M3 流动计量（dispatch 面——不受门阻）──
  const m3 = m3Face({ scopedDispatches: scoped.filter(e => e.event_kind === 'dispatch'), attrFaceMap: attrFace.face, anchorFace, untruncatedEvents: events });

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
  // P1-1（红队修复轮）：untruncated 归因面两处消费——m4WeekTrend 收参（m3Face 模式同法）+m2AutoFace
  // 收参（门红态 m4WeekTrend 票级计数仍需本面）。
  // stats-hygiene-2 交付物 3：归因面已上移至未过滤语料（events）恰一次计算（见 m1 前唯一调用点）——
  // 本处收参复用同一 attrFace（filtered 面重算调用点移除）。
  const untruncatedInternals = gate.blocking ? null : (() => { const it = {}; m2AutoFace(filtered, it, attrFace); return it; })();
  const weekTrend = m4WeekTrend({
    scoped, untruncated: filtered, gateBlocking: gate.blocking, attrFaceMap: attrFace.face, anchorFace,
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
  lines.push(`[M3] 周期时间 ${m3.ticket_cycle_time.state}（p50 ${m3.ticket_cycle_time.p50_ms ?? 'n/a'}ms · 覆盖 ${m3.ticket_cycle_time.coverage.covered}/${m3.ticket_cycle_time.coverage.total}——分母=merged 票集）· agent/空闲 active ${m3.agent_idle_buckets.active_ms_total}ms / idle ${m3.agent_idle_buckets.idle_ms_total}ms${m3.agent_idle_buckets.estimation ? '（estimation——锚缺席票上界）' : '（锚端点真值——估算退役）'}`);
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
