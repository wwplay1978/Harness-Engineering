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
import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT, RFC3339_UTC_RE } from './cli.mjs';
import * as EE from './events-engine.mjs';
import { ensureStoreLayout } from './store.mjs';
import { sha256Hex, atomicWriteFile } from './util.mjs';
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

/** M2 计量（auto 面——门红时调用方以 null+blocked 态替换出仓；本函数恒算供结构面）。 */
function m2AutoFace(events) {
  const devDispatches = events.filter(isDevDispatch)
    .sort((a, b) => (a.created_at ?? '') < (b.created_at ?? '') ? -1 : (a.created_at ?? '') > (b.created_at ?? '') ? 1 : a.entity_id < b.entity_id ? -1 : 1);
  const mergedTickets = new Set(devDispatches.filter(e => e.state === 'terminal_completed').map(e => e.ticket_slug));
  const reworkDenominatorTickets = new Set(devDispatches.filter(e => e.state === 'terminal_completed' || e.state === 'terminal_failed').map(e => e.ticket_slug));

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
    if (!devDispatchesBySlug.has(d.ticket_slug)) devDispatchesBySlug.set(d.ticket_slug, []);
    devDispatchesBySlug.get(d.ticket_slug).push(d);
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
  const joinedRework = [];   // {slug, dispatch}
  for (const [slug, list] of reworkRowsBySlug) {
    const ds = devDispatchesBySlug.get(slug) ?? [];
    for (const item of list) joinedRework.push({ slug, dispatch: ds[item.ordinal] ?? null });
  }
  // 全角色派发面（review/qa 时点+返工花费的后续复审派发均取自此）
  const allBySlug = new Map();
  for (const e of events) {
    if (e.event_kind !== 'dispatch') continue;
    if (!allBySlug.has(e.ticket_slug)) allBySlug.set(e.ticket_slug, []);
    allBySlug.get(e.ticket_slug).push(e);
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
  const m1 = {
    dispatches_total: dispatches.length,
    dispatches_by_role_variant: tally(dispatches, roleVariantKey),
    dispatches_by_project: tally(dispatches, e => e.project_id ?? null),
    dispatches_by_day_utc: tally(dispatches.filter(e => e.created_at), e => String(e.created_at).slice(0, 10)),
    models_by_adapter: (() => {
      const byAdapter = {};
      const zc = tally(dispatches, e => e.route_anchor?.effective_model ?? null);
      if (Object.keys(zc).length > 0) byAdapter['zcode-sqlite'] = zc;
      for (const adapter of ['kimi-wire', 'codex-sessions']) {
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
      const numerator = dispatches.filter(e => e.state === 'terminal_failed').length;
      return { numerator, denominator, rate: rateOf(numerator, denominator) };   // 分母=terminal_completed+terminal_failed+missing_child（stats-1 gap-5 已裁）
    })(),
  };

  // ── M2 质量计量（三层门红态）──
  const gate = classifierGateRow(storeRoot);
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
    Object.assign(m2, m2AutoFace(scoped));
  }
  m2.manual_reconciled_subset = manualSubset(storeRoot, scoped);

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
    m2,
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
    if (existsSync(finalPath)) { console.error(`OUT_FILE_EXISTS：reports/${bucket}/${name} 已在场——append 语义禁覆写历史工件`); return EXIT.FAIL; }
    if (existsSync(manifestPath)) { console.error(`OUT_FILE_EXISTS：reports/${bucket}/${name}.manifest.json 已在场——append 语义禁覆写历史工件`); return EXIT.FAIL; }
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
    atomicWriteFile(finalPath, body + '\n');
    atomicWriteFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
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
  console.log(lines.join('\n'));
  return EXIT.OK;
}
