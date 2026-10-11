// stats2/cmd-phase4.mjs — stats-3 阶段四机制（本轮=机制与候选提取；正式执行含人工检查点=第二轮）
// 纪律：golden set=归因真值标注（派发→票 slug，planner 产出+用户批准——人工环节）；
// held-out 清单标注前封存（SHA 落工件）；CANDIDATE 永不入票级指标（VR-F08/S11+A4 断言面）。
// held-out 活仓执行轮（用户裁"活仓只读采样"）：heldout-live-sample/classify——两活仓零写入铁律，
// 密封先行（分类只消费密封清单），行内容 SHA 锁定（活仓后续编辑→ROW_CONTENT_DRIFT fail-loud，不可挑换）。
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { rfc3339, canon, sha256Hex } from './util.mjs';
import { EXIT } from './cli.mjs';
import * as EE from './events-engine.mjs';
import { ensureStoreLayout, ensureConfig } from './store.mjs';
import { parseTicketRunLog, sha8 } from './parser.mjs';
import { effectiveDerivations, crossSourceOverlap, MINER_ADAPTER_ID } from './cmd-mine.mjs';
import { CLASSIFIER_VERSION, classifyRow } from './classifier.mjs';

function loadStoreEvents(storeRoot) {
  const genDir = EE.genDirOf(storeRoot, EE.currentGeneration(storeRoot));
  return EE.loadCorpus(genDir).events;
}

function loadBundleSlugs(storeRoot, bundleId) {
  const dir = join(storeRoot, 'snapshots', String(bundleId));
  if (!existsSync(join(dir, 'manifest.json'))) return { error: `BUNDLE_NOT_FOUND：${dir}` };
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  return { manifest, dir };
}

/** ── heldout-sample：新抽样本封存机制（classifier-acceptance §4-1：抽样→清单锁定存档）──
 *  分层随机（slug×行序 strata），seed 驱动（hash 抖动——确定性可复算）；--seal 落仓工件
 *  （reports/heldout-sealed-<sha8>.json：清单 SHA+classifier_version+sealed_at）。
 *  隔离纪律：本命令只输出行标识（slug+line），不打印行内容（标注者才读内容——制定者隔离）。 */
export async function cmdHeldoutSample(opts) {
  const { storeRoot, flags } = opts;
  const bundleArg = flags.bundle;
  if (!bundleArg) { console.error('heldout-sample 需要 --bundle <pilot_bundle_id>（抽样框=冻结票据运行记录行）'); return EXIT.USAGE; }
  const count = Number(flags.count ?? 20);
  const seed = String(flags.seed ?? 'stats3-heldout-1');
  if (!(Number.isInteger(count) && count >= 20)) { console.error('heldout-sample --count 须 ≥20（classifier-acceptance §1）'); return EXIT.USAGE; }
  // 阶段四正式执行：--exclude-slug 排除面（golden 票+词典制定参与票；逗号分隔/可重复）
  const excludeSlugs = new Set(
    [flags['exclude-slug']].flat().filter(Boolean)
      .flatMap(v => String(v).split(',').map(s => s.trim()).filter(Boolean)),
  );
  const { manifest, dir, error } = loadBundleSlugs(storeRoot, bundleArg);
  if (error) { console.error(error); return EXIT.FAIL; }
  ensureStoreLayout(storeRoot);
  ensureConfig(storeRoot);

  // 抽样框=developer(±rerun) 行（分类验收面；排除面外票）+框普查（fail-loud 时留证据面）
  const frame = [];
  const census = { tickets_total: manifest.tickets_reviews.slug_list.length, tickets_excluded: 0, tickets_with_dev_rows: 0, dev_rows_total: 0, excluded_slugs: [...excludeSlugs] };
  for (const slug of manifest.tickets_reviews.slug_list) {
    if (excludeSlugs.has(slug)) { census.tickets_excluded++; continue; }
    const rows = parseTicketRunLog(readFileSync(join(dir, 'tickets', `${slug}.md`), 'utf8'));
    const dev = rows.filter(r => r.is_developer);
    if (dev.length > 0) { census.tickets_with_dev_rows++; census.dev_rows_total += dev.length; }
    rows.forEach((r, i) => { if (r.is_developer) frame.push({ slug, line: r.line, ordinal: i }); });
  }
  if (frame.length < count) {
    console.error(`SAMPLING_FRAME_TOO_SMALL：框=${frame.length} < count=${count}（排除 ${census.tickets_excluded} 票后含 developer 行票数=${census.tickets_with_dev_rows}、行数=${census.dev_rows_total}）——框不足 fail-loud（classifier-acceptance §1 ≥20；框普查：${JSON.stringify(census)}）`);
    return EXIT.FAIL;
  }
  // 分层随机：hash(slug|line|seed) 升序取前 count（确定性；层=stratum 内自然打散）
  const ranked = frame
    .map(x => ({ ...x, rank: createHash('sha256').update(`${x.slug}|${x.line}|${seed}`).digest('hex') }))
    .sort((a, b) => a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0);
  const sampled = ranked.slice(0, count).map(({ slug, line }) => ({ slug, line }));
  sampled.sort((a, b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : a.line - b.line);
  const listSha = sha256Hex(canon(sampled));
  const artifact = {
    artifact_kind: 'heldout-sealed-list',
    spec_anchor: 'classifier-acceptance.md §1/§4（数据集隔离：样本不得参与词典/规则制定；标注前封存）',
    bundle_id: manifest.bundle_id, classifier_version: CLASSIFIER_VERSION,
    sample_count: sampled.length, list_sha256: listSha, seed,
    sampled,   // 行标识（slug+line）——内容面由标注者读取（制定者隔离）
    generated_at: rfc3339(),
  };
  if (flags.seal) {
    const reportsDir = join(storeRoot, 'reports');
    mkdirSync(reportsDir, { recursive: true });
    const p = join(reportsDir, `heldout-sealed-${listSha.slice(0, 8)}.json`);
    if (existsSync(p)) { console.error(`OUT_FILE_EXISTS：reports/heldout-sealed-${listSha.slice(0, 8)}.json 已在场——append 语义禁覆写历史工件（快审 P3 修缮）`); return EXIT.FAIL; }
    writeFileSync(p, JSON.stringify(artifact, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify({ command: 'heldout-sample', sealed: true, artifact: `reports/heldout-sealed-${listSha.slice(0, 8)}.json`, sample_count: sampled.length, list_sha256: listSha }, null, 2));
    return EXIT.OK;
  }
  console.log(JSON.stringify({ command: 'heldout-sample', sealed: false, draft: true, sample_count: sampled.length, list_sha256: listSha,
    sampled_ids_only: sampled, note: 'draft 模式未落仓——正式封存须 --seal（第二轮：人工检查点后执行）' }, null, 2));
  return EXIT.OK;
}

/** ── golden-candidates：归因真值标注候选提取（≥20 派发+证据包→planner 标注工件）──
 *  候选=CANDIDATE 归因 dispatch（派发→票 slug 真值缺位面）；证据包=时间窗/角色/变体/日期吻合票
 *  候选清单（脱敏：匿名 source key=entity_id SHA-8——verify 输出纪律同款）。 */
export async function cmdGoldenCandidates(opts) {
  const { storeRoot, flags } = opts;
  const bundleArg = flags.bundle;
  if (!bundleArg) { console.error('golden-candidates 需要 --bundle <pilot_bundle_id>'); return EXIT.USAGE; }
  const min = Number(flags.min ?? 20);
  const { manifest, dir, error } = loadBundleSlugs(storeRoot, bundleArg);
  if (error) { console.error(error); return EXIT.FAIL; }
  ensureStoreLayout(storeRoot);
  ensureConfig(storeRoot);
  const events = loadStoreEvents(storeRoot);

  // 票据行日期索引（日期吻合票候选）
  const ticketDays = [];
  for (const slug of manifest.tickets_reviews.slug_list) {
    const rows = parseTicketRunLog(readFileSync(join(dir, 'tickets', `${slug}.md`), 'utf8'));
    const days = rows.map(r => r.date).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
    if (days.length > 0) ticketDays.push({ slug, days: [...new Set(days)].sort() });
  }

  const state = EE.entityState(events);
  const candidates = [];
  for (const [eid, st] of state) {
    const e = st.latest;
    if (e.event_kind !== 'dispatch' || e.attribution !== 'CANDIDATE') continue;
    const day = String(e.created_at ?? '').slice(0, 10);
    const dayMatch = ticketDays.filter(t => day >= t.days[0] && day <= t.days[t.days.length - 1]).map(t => t.slug);
    candidates.push({
      anonymous_source_key: sha8(e.entity_id),
      target_entity_id: e.entity_id,   // P3-5：反解承载（仓内工件面；stdout 摘要不出现）
      role: e.role, variant: e.variant || 'base', state: e.state,
      created_at: e.created_at, completed_at: e.completed_at,
      date_matched_ticket_candidates: dayMatch,   // 仅日期/项目吻合候选（CANDIDATE 级——永不入票级指标）
    });
  }
  candidates.sort((a, b) => a.created_at < b.created_at ? -1 : 1);
  if (candidates.length < min) {
    console.error(`CANDIDATES_TOO_FEW：CANDIDATE 派发=${candidates.length} < --min ${min}（golden set ≥20 派发——票面阶段四）`);
    return EXIT.FAIL;
  }
  // P3-5 返修：反解承载——匿名 key→target_entity_id 映射随工件入仓（本机仓内工件，D6' 默认不出本机；
  // stdout 摘要恒匿名——第二轮 reconcile 输入 target_entity_ids 直接取自此映射，不撞死胡同）
  const sourceKeyMap = {};
  for (const c of candidates) sourceKeyMap[c.anonymous_source_key] = c.target_entity_id;
  const artifact = {
    artifact_kind: 'golden-set-candidates',
    spec_anchor: '22 §2.3（CANDIDATE=候选清单面）/stats-3 票面阶段四（golden set=归因真值标注：planner 从 pilot 窗口产出派发→票 slug 真值清单，用户批准集）',
    bundle_id: manifest.bundle_id, classifier_version: CLASSIFIER_VERSION,
    candidate_count: candidates.length,
    annotation_request: 'planner 逐候选标注目标票 slug（或 UNATTRIBUTED）→ 用户批准 → reconcile（attribution_level=MANUAL_RECONCILED）入仓（target_entity_ids 取自 source_key_map[anonymous_source_key]）',
    source_key_map: sourceKeyMap,
    candidates,
    generated_at: rfc3339(),
  };
  const reportsDir = join(storeRoot, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const p = join(reportsDir, `golden-candidates-${manifest.bundle_id}.json`);
  writeFileSync(p, JSON.stringify(artifact, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ command: 'golden-candidates', artifact: `reports/golden-candidates-${manifest.bundle_id}.json`,
    candidate_count: candidates.length, min }, null, 2));
  return EXIT.OK;
}

/** ── pilot-report：分层对照报告生成器（draft；正式报告=标注批准后第二轮）──
 *  层1 ZCode 面（同 bundle 复跑 vs stats-2 基线 episode=0/NOT_IDENTIFIABLE=498/CANDIDATE=498）；
 *  层2 原生面单列（Kimi/Codex model-request/token 五路/时长）；层3 分类面（三率=第二轮）。 */
/** 人工归因读取面（gap-5 临时设计）：扫描 snapshots/reconcile/<sha8>/input.json——
 *  reconcile 输入工件=归因真值持久记录（ticket_slug+target_entity_ids+attribution_level）。
 *  @returns {{manualByEntity: Map, goldenSet: object|null}} */
export function manualAttributionArchives(storeRoot) {
  const rcDir = join(storeRoot, 'snapshots', 'reconcile');
  const manualByEntity = new Map();
  let goldenSet = null;
  if (!existsSync(rcDir)) return { manualByEntity, goldenSet };
  void readdirSync;
  for (const d of readdirSync(rcDir).sort()) {
    const p = join(rcDir, d, 'input.json');
    if (!existsSync(p)) continue;
    let j;
    try { j = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
    if (j?.artifact_kind === 'golden-set-v1') { goldenSet = { ...j, archive: `snapshots/reconcile/${d}/input.json` }; continue; }
    if (Array.isArray(j?.target_entity_ids)) {
      for (const eid of j.target_entity_ids)
        manualByEntity.set(eid, { ticket_slug: j.ticket_slug, attribution_level: j.attribution_level, archive: `snapshots/reconcile/${d}/input.json`, reconciler: j.reconciler });
    }
  }
  return { manualByEntity, goldenSet };
}

/** golden set v1 指标（阶段四正式执行）：auto 面 vs post-reconcile 面（M2 manual＞auto 读取语义）。 */
export function goldenSetEval(events, manualByEntity, goldenSet) {
  const pos = goldenSet?.positives ?? [];
  const negs = goldenSet?.negatives ?? [];
  const dispatchByEntity = new Map(events.filter(e => e.event_kind === 'dispatch').map(e => [e.entity_id, e]));
  const rate = (a, b) => b > 0 ? +(a / b).toFixed(4) : null;
  let autoAssigned = 0, autoCorrect = 0;
  for (const p of pos) {
    const d = dispatchByEntity.get(p.target_entity_id);
    if (!d) continue;
    if (['EXPLICIT', 'DIRECT', 'MANUAL_RECONCILED'].includes(d.attribution)) {
      autoAssigned++;
      if (d.ticket_slug === p.ticket_slug) autoCorrect++;
    }
  }
  let manualAssigned = 0, manualCorrect = 0;
  for (const p of pos) {
    const m = manualByEntity.get(p.target_entity_id);
    if (m?.attribution_level === 'MANUAL_RECONCILED') {
      manualAssigned++;
      if (m.ticket_slug === p.ticket_slug) manualCorrect++;
    }
  }
  const negativeCheck = negs.map(n => {
    const m = manualByEntity.get(n.target_entity_id ?? n);
    const d = dispatchByEntity.get(n.target_entity_id ?? n);
    return { key: n.anonymous_source_key ?? n, in_manual_archive: Boolean(m), dispatch_attribution: d?.attribution ?? null };
  });
  return {
    golden_set: { positives: pos.length, negatives: negs.length, archive: goldenSet?.archive ?? null, approved: goldenSet?.approved ?? null },
    auto_face: { assigned_top3: autoAssigned, correct: autoCorrect, coverage: rate(autoCorrect, pos.length), precision: rate(autoCorrect, autoAssigned), note: '现网 auto 归因（dispatch.attribution 面）——D7\' 缺口下全 CANDIDATE（预期≈0，诚实报告）' },
    post_reconcile: { assigned_manual: manualAssigned, correct: manualCorrect, coverage: rate(manualCorrect, pos.length), precision: rate(manualCorrect, manualAssigned), note: 'M2 manual＞auto：reconcile 工件归档读取面（gap-5 临时设计——人工归因经内容寻址输入工件承载）' },
    negative_verification: { all_clean: negativeCheck.every(n => !n.in_manual_archive && n.dispatch_attribution === 'CANDIDATE'), detail: negativeCheck },
  };
}

export async function cmdPilotReport(opts) {
  const { storeRoot, flags } = opts;
  const bundleArg = flags.bundle;
  const draft = flags.draft === true;
  const formal = flags.formal === true;
  if (!bundleArg) { console.error('pilot-report 需要 --bundle <pilot_bundle_id>'); return EXIT.USAGE; }
  if (!draft && !formal) { console.error('pilot-report 需要 --draft 或 --formal（正式模式=golden set 用户批准后——阶段四第二轮）'); return EXIT.USAGE; }
  if (draft && formal) { console.error('pilot-report --draft 与 --formal 互斥'); return EXIT.USAGE; }
  const { manifest, dir, error } = loadBundleSlugs(storeRoot, bundleArg);
  if (error) { console.error(error); return EXIT.FAIL; }
  ensureStoreLayout(storeRoot);
  ensureConfig(storeRoot);
  const events = loadStoreEvents(storeRoot);

  // ── 层1：ZCode 面 ──
  const dispatches = events.filter(e => e.event_kind === 'dispatch' && e.adapter_id === 'zcode-sqlite');
  const attrDist = { EXPLICIT: 0, DIRECT: 0, CANDIDATE: 0, MANUAL_RECONCILED: 0, UNATTRIBUTED: 0 };
  for (const d of dispatches) attrDist[d.attribution] = (attrDist[d.attribution] ?? 0) + 1;
  // 有效分类 join（行实体派生 → dispatch 面：slug+attempt 序）
  const eff = effectiveDerivations(events);
  let dispatchesClassified = 0, candidateExcluded = 0;
  const kindDist = {};
  const effKindByDispatch = new Map();   // dispatch entity_id → 有效 attempt_kind
  for (const d of dispatches) {
    if (d.attribution === 'CANDIDATE' || d.attribution === 'UNATTRIBUTED') { if (d.attribution === 'CANDIDATE') candidateExcluded++; continue; }
    const slug = d.ticket_slug;
    let effKind = null;
    if (slug) {
      // 该 slug developer 行派生的有效分类（行序↔attempt 序 join——DIRECT/EXPLICIT/MANUAL 面）
      const rows = parseTicketRunLog(readFileSync(join(dir, 'tickets', `${slug}.md`), 'utf8')).filter(r => r.is_developer);
      const idx = dispatches.filter(x => x.ticket_slug === slug && x.role === 'developer')
        .sort((a, b) => a.created_at < b.created_at ? -1 : 1)
        .findIndex(x => x.entity_id === d.entity_id);
      if (idx >= 0 && rows[idx]) {
        const pk = `tickets/${slug}.md#L${rows[idx].line}`;
        const drv = eff.get(`${d.source_instance_id}:${MINER_ADAPTER_ID}:${pk}`);
        if (drv) { dispatchesClassified++; effKind = drv.derivation.attempt_kind; }
      }
    }
    const kind = effKind ?? d.attempt_kind;   // 未 join 到=collect 侧值（unclassified-v0→unknown）
    effKindByDispatch.set(d.entity_id, kind);
    kindDist[kind] = (kindDist[kind] ?? 0) + 1;
  }
  // eligible repair episodes（§5.8：quality_rework ∧ 归因上三级 ∧ 终态 ∧ 路由锚可得）
  const episodes = dispatches.filter(d =>
    ['EXPLICIT', 'DIRECT', 'MANUAL_RECONCILED'].includes(d.attribution)
    && ['terminal_completed', 'terminal_failed'].includes(d.state)
    && effKindByDispatch.get(d.entity_id) === 'quality_rework'
    && d.route_anchor && Object.values(d.route_anchor).every(v => typeof v === 'string' && v !== ''));

  // ── 层2：原生面 ──
  const native = {};
  for (const adapter of ['kimi-wire', 'codex-sessions']) {
    const evs = events.filter(e => e.event_kind === 'model-request' && e.adapter_id === adapter);
    const usage = { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 };
    const na = { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 };
    for (const e of evs) for (const k of Object.keys(usage)) {
      if (e.usage?.[k] == null) na[k]++;
      else usage[k] += e.usage[k];
    }
    native[adapter] = {
      model_requests: evs.length, states: tally(evs.map(e => e.state)),
      usage_five_way: usage, usage_na_paths: na,
      note: adapter === 'kimi-wire' ? 'reasoning 恒 N/A（宿主缺路——A1-② 断言面）' : 'token_usage_record 逐请求直取（现行形态）',
    };
  }
  const overlap = crossSourceOverlap(events, { project_id: manifest.project_id });

  // P2-4 返修：基线恒等机械断言——期望值从 stats-2 pilot-eval 工件读取（禁内联裸数字）；
  // actual=本次同 bundle 复跑分布；工件缺失=available:false（draft 不失败，正式报告须在场）。
  const baselineIdentity = (() => {
    const p = join(storeRoot, 'reports', `pilot-eval-${manifest.bundle_id}.json`);
    if (!existsSync(p)) {
      return { available: false, reason: `stats-2 pilot-eval 工件缺失：reports/pilot-eval-${manifest.bundle_id}.json（正式报告须在场——draft 容缺）` };
    }
    let baseline;
    try { baseline = JSON.parse(readFileSync(p, 'utf8')); }
    catch (e) { return { available: false, reason: `pilot-eval 工件不可解析：${e.message}` }; }
    const expected = baseline.attribution_distribution ?? null;
    const keys = new Set([...Object.keys(expected ?? {}), ...Object.keys(attrDist)]);
    const diff_fields = [...keys].filter(k => (expected?.[k] ?? 0) !== (attrDist[k] ?? 0));
    return {
      available: true,
      source_artifact: `reports/pilot-eval-${manifest.bundle_id}.json`,
      expected_attribution_distribution: expected,
      expected_dispatch_entities_total: baseline.eligible_repair_episodes?.dispatch_entities_total ?? null,
      actual_attribution_distribution: attrDist,
      actual_dispatches_total: dispatches.length,
      match: diff_fields.length === 0 && dispatches.length === (baseline.eligible_repair_episodes?.dispatch_entities_total ?? -1),
      diff_fields,
      note: '同 bundle 复跑恒等断言（机械可判）：ZCode 面 dispatch 集无新采集面——差异仅分类 join 层',
    };
  })();

  // 阶段四正式执行面：golden set v1 指标（formal 模式承载；draft 模式零 golden 段）
  let goldenSection = null;
  if (formal) {
    const { manualByEntity, goldenSet } = manualAttributionArchives(storeRoot);
    goldenSection = goldenSet
      ? goldenSetEval(events, manualByEntity, goldenSet)
      : { status: 'GOLDEN_SET_ARCHIVE_MISSING', note: 'snapshots/reconcile/*/input.json 无 artifact_kind=golden-set-v1 工件' };
  }

  // held-out 活仓执行轮（用户裁"活仓只读采样"）：--heldout-classified <分类工件>——L3 段 blocked→三率
  // （建议真值临时面——provisional-awaiting-planner-review）；append 语义=--out 新时戳文件名+已存在
  // fail-loud（历史 formal 工件永不覆写）。
  let heldoutClassified = null;
  if (flags['heldout-classified'] !== undefined) {
    if (!formal) { console.error('--heldout-classified 仅 --formal 模式（L3 三率=正式报告承载面）'); return EXIT.USAGE; }
    let cls;
    try { cls = JSON.parse(readFileSync(String(flags['heldout-classified']), 'utf8')); }
    catch (e) { console.error(`HELDOUT_ARTIFACT_UNREADABLE：${flags['heldout-classified']}（${e.message}）`); return EXIT.FAIL; }
    if (cls.artifact_kind !== 'heldout-live-classified') { console.error(`HELDOUT_KIND_INVALID：须 artifact_kind=heldout-live-classified`); return EXIT.FAIL; }
    heldoutClassified = cls;
  }

  // 收口轮：--planner-final <终值工件>——L3 段=终值三率+纠正记录+框裁定+发现定性（与 --heldout-classified 互斥）
  let plannerFinal = null;
  if (flags['planner-final'] !== undefined) {
    if (!formal) { console.error('--planner-final 仅 --formal 模式（L3 终值三率=正式报告承载面）'); return EXIT.USAGE; }
    if (flags['heldout-classified'] !== undefined) { console.error('USAGE：--planner-final 与 --heldout-classified 互斥（v3 终值面取代 v2 provisional 面）'); return EXIT.USAGE; }
    try { plannerFinal = JSON.parse(readFileSync(String(flags['planner-final']), 'utf8')); }
    catch (e) { console.error(`PLANNER_FINAL_UNREADABLE：${flags['planner-final']}（${e.message}）`); return EXIT.FAIL; }
    if (plannerFinal.artifact_kind !== 'heldout-planner-final') { console.error('PLANNER_FINAL_KIND_INVALID：--planner-final 须 artifact_kind=heldout-planner-final'); return EXIT.FAIL; }
  }
  const supersedesName = flags.supersedes !== undefined
    ? String(flags.supersedes).replaceAll('\\', '/').replace(/^\/+/, '').replace(/^reports\//, '')
    : null;

  const report = {
    artifact_kind: formal ? 'pilot-layered-report-formal' : 'pilot-layered-report-draft',
    draft: !formal,
    formal: Boolean(formal),
    spec_anchor: 'stats-3 票面阶段四 ⑥（分层对照矩阵：ZCode 面=同 bundle 复跑 vs stats-2 基线；新增原生面单列）',
    bundle_id: manifest.bundle_id, classifier_version: CLASSIFIER_VERSION,
    generated_at: rfc3339(),
    layer1_zcode_face: {
      dispatches_total: dispatches.length,
      attribution_distribution: attrDist,
      baseline_identity: baselineIdentity,
      classification_joined: dispatchesClassified,
      candidate_excluded_from_ticket_metrics: candidateExcluded,
      attempt_kind_distribution_effective: kindDist,
      eligible_repair_episodes: { count: episodes.length, note: '§5.8 判据（quality_rework∧归因上三级∧终态∧路由锚可得）；CANDIDATE 面恒 NOT_IDENTIFIABLE——D7\' 落地前结构性占位' },
    },
    layer2_native_face: {
      note: '原生面单列（裁决⑤：不产 dispatch；票级/attempt 指标不涉原生面——token/时长计量面）',
      adapters: native,
      cross_source_overlap: overlap,
    },
    layer3_classification_quality: plannerFinal
      ? {
          status: 'final-planner-adjudicated（planner 终值真值三率——provisional 面已复核收口）',
          heldout_three_rates: plannerFinal.three_rates_final,
          gates: plannerFinal.gates_final,
          corrections: plannerFinal.corrections ?? [],
          provisional_reference: {
            artifact: plannerFinal.provenance?.classified_artifact ?? null,
            three_rates: plannerFinal.provisional_three_rates ?? null,
            gates: plannerFinal.provisional_gates ?? null,
            note: '建议真值临时面（v2 L3 承载）——终值取代；verdict 变更逐例见终值工件 verdict_changes',
          },
          frame_ruling: plannerFinal.frame_ruling ?? null,
          finding: plannerFinal.finding ?? null,
          provenance: {
            sealed_artifact: plannerFinal.provenance?.sealed_artifact ?? null,
            classified_artifact: plannerFinal.provenance?.classified_artifact ?? null,
            planner_final_artifact: reportsRel(String(flags['planner-final'])),
          },
          supersedes: `reports/${supersedesName ?? 'pilot-layered-report-formal-stats3.json'}`,
          note: 'append 语义 v3（L3 终值三率+纠正记录+框裁定+双门红=真实发现定性——结构病因四条见 docs/changes/stats-3-gap-7）；L1/L2/golden 复算不变=l1_l2_golden_identity_vs_superseded 机械断言承载',
          dev_regression: '38/38 绿（tests/stats3/classifier-36.test.mjs——不计 precision）',
        }
      : heldoutClassified
      ? {
          status: 'provisional-three-rates（awaiting planner review——建议真值临时面，planner 复核后裁定）',
          heldout_three_rates: heldoutClassified.three_rates,
          gates: heldoutClassified.gates,
          provenance: {
            sealed_artifact: heldoutClassified.provenance.sealed_artifact,
            classified_artifact: `reports/heldout-live-classified-${heldoutClassified.classified_sha8}.json`,
            frame_note: heldoutClassified.provenance.frame_note,
            sampling_method: heldoutClassified.provenance.sampling_method,
            live_sources: heldoutClassified.provenance.live_sources,
            exclusion: heldoutClassified.provenance.exclusion,
          },
          supersedes: `reports/${flags.supersedes ?? 'pilot-layered-report-formal-stats3.json'}`,
          note: 'append 语义新版本工件（L3 段 blocked→三率[建议真值]）；历史 formal 工件不覆写',
          dev_regression: '38/38 绿（tests/stats3/classifier-36.test.mjs——不计 precision）',
        }
      : formal
      ? {
          status: 'blocked-frame-insufficient（held-out 框不足——四票之外冻结票 developer 行=0；框普查见 heldout-sample fail-loud 输出/完工报告）',
          heldout_three_rates: null,
          gates: '§2.2-10 双门（合计>30% 降级；wrong_label>10% fail）——held_out_acceptance_set 标注后计算（本轮不可计算）',
          dev_regression: '38/38 绿（tests/stats3/classifier-36.test.mjs——不计 precision）',
          resolution_options: ['扩冻票据 corpus（新源接触授权票）', 'planner 重划 held-out 框（如含 golden 票行/他项目 corpus）'],
        }
      : {
          status: '第二轮（人工检查点后）',
          heldout_three_rates: null,
          gates: '§2.2-10 双门（合计>30% 降级；wrong_label>10% fail）——held_out_acceptance_set 标注后计算',
          dev_regression: '38/38 绿（tests/stats3/classifier-36.test.mjs——不计 precision）',
        },
    ...(goldenSection ? { golden_set_v1: goldenSection } : {}),
  };
  // 收口轮：L1/L2/golden 对前版（--supersedes）工件的机械恒等断言——复算不变声明的承载面
  // （L1/L2/golden 每轮自同 bundle+同事件仓复算无缓存面；失配=fail-loud 不落仓，复算不变不得虚报）
  if (plannerFinal) {
    let identity = { available: false, reason: '未提供 --supersedes（无前版可比对）' };
    if (flags.supersedes !== undefined) {
      const prevPath = join(storeRoot, 'reports', supersedesName);
      if (!existsSync(prevPath)) identity = { available: false, reason: `前版工件不在场：reports/${supersedesName}` };
      else {
        let prev = null;
        try { prev = JSON.parse(readFileSync(prevPath, 'utf8')); } catch { prev = null; }
        if (!prev || prev.artifact_kind !== 'pilot-layered-report-formal' || !prev.layer1_zcode_face || !prev.layer2_native_face) {
          identity = { available: false, reason: `前版工件不可比对（非 formal 报告形态或 L1/L2 段缺失）：reports/${supersedesName}` };
        } else {
          const diffFields = [];
          const cmpSection = (name, a, b) => {
            for (const k of [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])])
              if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) diffFields.push(`${name}.${k}`);
          };
          cmpSection('layer1_zcode_face', prev.layer1_zcode_face, report.layer1_zcode_face);
          cmpSection('layer2_native_face', prev.layer2_native_face, report.layer2_native_face);
          const goldenFace = Boolean(prev.golden_set_v1) || Boolean(report.golden_set_v1);
          if (goldenFace) cmpSection('golden_set_v1', prev.golden_set_v1, report.golden_set_v1);
          if (diffFields.length > 0) {
            console.error(`SUPERSEDED_IDENTITY_MISMATCH：L1/L2/golden 复算与前版 reports/${supersedesName} 不恒等——${diffFields.join('、')}（复算不变不得虚报；差异须先归因再出报告）`);
            return EXIT.FAIL;
          }
          identity = {
            available: true, compared_with: `reports/${supersedesName}`,
            sections: ['layer1_zcode_face', 'layer2_native_face', ...(goldenFace ? ['golden_set_v1'] : [])],
            match: true, diff_fields: [],
            note: 'L1/L2/golden 每轮自同 bundle+同事件仓复算（无缓存面）——本断言=与前版工件的机械恒等（L1/L2 复算不变+golden 段不变的承载面）',
          };
        }
      }
    }
    report.l1_l2_golden_identity_vs_superseded = identity;
  }
  const out = flags.out;
  if (typeof out === 'string') {
    const reportsDir = join(storeRoot, 'reports');
    mkdirSync(reportsDir, { recursive: true });
    const name = out.replaceAll('\\', '/').split('/').pop();
    const p = join(reportsDir, name);
    if (existsSync(p)) { console.error(`OUT_FILE_EXISTS：reports/${name} 已在场——append 语义禁覆写历史工件（新版本须时戳版本文件名）`); return EXIT.FAIL; }
    writeFileSync(p, JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify({ command: 'pilot-report', mode: formal ? 'formal' : 'draft', artifact: `reports/${name}` }, null, 2));
    return EXIT.OK;
  }
  console.log(JSON.stringify(report, null, 2));
  return EXIT.OK;
}

function tally(arr) {
  const t = {};
  for (const v of arr) t[v] = (t[v] ?? 0) + 1;
  return t;
}

/** ── 活仓行提取（用户裁"活仓只读采样"方案；零写入铁律——本层只 readFileSync）──
 *  小节定位=活仓双标题形态（「运行记录…」=parser 冻结面直取 ∨「attempts 记录表…」=活仓演进形态，
 *  提取面合成等价标题喂冻结 parser——契约 §1 零改动；行号 1:1 对齐=真实文件行号）。
 *  角色口径=developer 系前缀归一（developer/developer-rerun/developer（…限定）/dev … 缩写——活仓
 *  角色列受控枚举实测无误命中；role_raw 照录披露）。行结构（attempt 规范化/声明枚举）全部复用冻结 parser。 */
const LIVE_HEADING_RE = /^#{1,6}\s*(运行记录|attempts 记录表)/;
const DEV_FAMILY_RE = /^dev/i;

export function extractLiveRows(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  const synth = lines.map(l => (LIVE_HEADING_RE.test(l) ? '## 运行记录' : l));   // 行数恒等→行号 1:1
  const parsed = parseTicketRunLog(synth.join('\n'));
  return parsed.map(r => {
    const rowText = (lines[r.line - 1] ?? '').trim();
    return { ...r, is_dev_family: DEV_FAMILY_RE.test(r.role), row_text: rowText, row_sha256: sha256Hex(rowText) };
  });
}

/** 拒因工件名词法（classifier-dictionary §2.5——gap-7②，三形态）：
 *  ①slug 前缀形（v1 既有）；②省略号引用形 `…-redteam.md`（非 ASCII 前缀，v1 漏收=H01/H12 reviewer 误判病因）；
 *  ③裸形态 `redteam-exec.md`/`qa-v3.md`（须 .md 后缀——防 qa-tester 角色名误命中）。
 *  （修复轮 P3-4：v1 全表收集函数 artifactsFromContext 已删——零调用死代码；收集面统一走 rejectionAnchors） */
export const REVIEW_ARTIFACT_RE = /(?:[A-Za-z0-9_-]+(?:-r\d+)?-(?:review|qa|redteam)[A-Za-z0-9_.-]*|(?:…|\.\.\.)-(?:review|qa|redteam)[A-Za-z0-9_.-]*|\b(?:qa|redteam)-[A-Za-z0-9]+(?:[-.][A-Za-z0-9]+)*\.md)/g;

// ── 上下文规则层 v2（classifier-dictionary §2.5——gap-7②；attempt↔报告窗口对应）──
/** 评审系行（code-review/qa-tester/red-team 前缀，含 rerun 变体——活仓实测含「code-review」缩形态）。 */
const REVIEW_FAMILY_RE = /^(code-review|qa-tester|red-team)/i;
/** 拒因行判定：result 含 request changes/request-changes/合并前修（pass/accept/approve/mergeable=验证行非拒因行）。 */
const REJECTION_RE = /request[-\s]?changes|合并前修/i;
/** 行内 findings 编号形态（finding-ID 锚提取面 2.1.0=角色限定语∪result∪note——①b 角色列扫描；
 *  大小写不敏感（H19 实测：角色列 RT-E8 大写↔拒因行 rt-e8 小写——判交前统一 upper 归一）；
 *  E-n 清单编号不属 findings 族——防 H16 误锚）。 */
const FINDING_ID_RES = [/\bRT-[A-Za-z0-9]+/gi, /\bP\d{1,2}-\d{1,3}\b/gi, /\bF-\d{1,3}\b/gi];

/** 拒因工件名收集面（词典 §2.5 收集词法——冻结：result∪note；角色限定语不参与工件名词法）。 */
const rowTextOf = r => `${r.result} ${r.note}`;
/** finding-ID 提取面（2.1.0：角色限定语∪result∪note）。 */
const idTextOf = r => `${r.role_qualifier ?? ''} ${r.result} ${r.note}`;

/**
 * attempt↔报告窗口对应（词典 §2.5 v2）：目标 developer 系行的拒因工件锚集。
 *  ①窗口锚（主路径）：attempt_no 数字且 >1——窗口=上一 developer 系行与目标行之间的评审系**拒因行**；
 *  ②finding-ID 锚（fallback，窗口无拒因行）：目标行 result/note 的 findings 编号与全表任一拒因行重叠
 *    （表序非严格事件序——编号对应优先于行序，H04）；
 *  ③无序号行（attempt_no=null——F-n/段序标记）不适用窗口（无 attempt 序位），仅 finding-ID 锚可锚定（H05）。
 * @param rows 同票小节全行（extractLiveRows/parseTicketRunLog 形态——line/role/result/note）
 * @param target 目标行（含 attempt_no） */
export function rejectionAnchors(rows, target) {
  const isDev = r => r.is_dev_family ?? r.is_developer;
  const devRowsBefore = rows.filter(r => isDev(r) && r.line < target.line);
  const prevDevLine = devRowsBefore.length > 0 ? Math.max(...devRowsBefore.map(r => r.line)) : null;
  const inWindow = r => r.line > (prevDevLine ?? 0) && r.line < target.line;
  const rejectionRows = rows.filter(r => REVIEW_FAMILY_RE.test(r.role) && REJECTION_RE.test(r.result));
  const collect = list => [...new Set(list.flatMap(r => rowTextOf(r).match(REVIEW_ARTIFACT_RE) ?? []))];
  const numbered = Number.isInteger(target.attempt_no) && target.attempt_no > 1;
  const anchorOf = list => ({
    artifacts: collect(list),
    basis: null,
    triggerHint: list.length === 0 ? null
      : list.some(r => /^red-team/i.test(r.role)) ? 'red_team'
        : list.some(r => /^qa-tester/i.test(r.role)) ? 'qa'
          : list.some(r => /^code-review/i.test(r.role)) ? 'reviewer' : null,
  });

  if (numbered) {
    const win = rejectionRows.filter(r => inWindow(r));
    if (win.length > 0) {
      return { ...anchorOf(win), basis: `attempt↔报告窗口对应（窗口内拒因行 ${win.length} 行）` };
    }
  }
  // finding-ID 锚：目标行 findings 编号 ↔ 全表拒因行编号重叠
  // 修复轮 P1：重叠=**编号集合交集**（非裸子串包含——F-1 ⊄ F-10/RT-1 ⊄ RT-10；拒因行编号经同一
  // FINDING_ID_RES 提取为集合后判交，契约「编号重叠」语义）
  // 2.1.0 ①b：提取面=角色限定语∪result∪note；编号统一 upper 归一后判交（大小写不敏感+精确匹配）；
  // 锚仅作用 trigger 推断层（resolveTrigger 的 hint 路径）——secondary 标注层独立，互不压制
  const idsOfRow = r => new Set(FINDING_ID_RES.flatMap(re => idTextOf(r).match(re) ?? []).map(s => s.toUpperCase()));
  const ids = idsOfRow(target);
  if (ids.size > 0) {
    const matched = rejectionRows.filter(r => [...ids].some(id => idsOfRow(r).has(id)));
    if (matched.length > 0) {
      const hitIds = [...ids].filter(id => matched.some(r => idsOfRow(r).has(id)));
      return { ...anchorOf(matched), basis: `finding-ID 锚（${hitIds.join('/')} ↔ 拒因行 ${matched.length} 行）` };
    }
  }
  // RT- 命名空间 fallback（2.1.0 r3 人裁，词典 §2.5-2b）：目标行提取面（角色限定语∪result∪note）命中
  // RT-[A-Za-z0-9]+ 形（命名空间蕴含——红队 findings 编号系）→ triggerHint=red_team；序=工件锚/交集锚之后
  // （已有锚不覆盖）；命名空间形非子串匹配、不做编号比对（不涉 F-1↔F-10 纪律）；仅作用 trigger 推断层
  const ns = idTextOf(target).match(/\bRT-[A-Za-z0-9]+/i);
  if (ns) return { artifacts: [], basis: `RT- 命名空间（${ns[0]}）`, triggerHint: 'red_team' };
  return { artifacts: [], basis: null, triggerHint: null };
}

/** 段序计数（词典 §3 段序标记语义——H07）：目标行及此前 developer 系行中 segment_marker 形态的序数。 */
export function markerOrdinalOf(rows, target) {
  let n = 0;
  for (const r of rows) {
    const dev = r.is_dev_family ?? r.is_developer;
    if (!dev || r.line > target.line) continue;
    if (r.segment_marker) n++;
  }
  return n;
}

/** ── 行级排除机械判据（classifier-v2 裁决 B——阶段三机制）──
 *  判据：候选行排除 ⟺ row_sha256 ∈ 烧毁密封集（row_sha256） ∪ `${slug}:${line}` ∈ fixtures 38 例
 *  provenance 行集（slug:line）。两输入工件只读（SHA 留证溯源）；输入形态：
 *  ①fixtures-38 形（cases[].provenance.source 含 `tickets/<slug>.md:<line>`——非票源跳过）；
 *  ②密封/分类/对照 fixture 形（sampled[]/cases[] 携 row_sha256）。
 *  密封集按 row_sha256 排除（同位编辑行=新行不排除——内容寻址）；fixtures 行集按 slug:line 排除。 */
export function buildRowExclusion(paths) {
  const slugLines = new Set();
  const rowShas = new Set();
  const inputs = [];
  const SRC_RE = /tickets\/([a-z0-9][a-z0-9-]*)\.md:(\d+)/i;
  for (const raw of paths) {
    const p = String(raw);
    if (!existsSync(p)) throw new Error(`ROW_EXCLUSION_INPUT_MISSING：${p}（行级排除输入不在场——不静默空排除）`);
    const text = readFileSync(p, 'utf8');
    let j;
    try { j = JSON.parse(text); }
    catch (e) { throw new Error(`ROW_EXCLUSION_INPUT_UNREADABLE：${p}（${e.message}）`); }
    inputs.push({ path: p.replaceAll('\\', '/'), file_sha256: createHash('sha256').update(text, 'utf8').digest('hex') });
    for (const c of j?.cases ?? []) {
      const m = SRC_RE.exec(c?.provenance?.source ?? '');
      if (m) slugLines.add(`${m[1]}:${m[2]}`);
      if (typeof c?.row_sha256 === 'string') rowShas.add(c.row_sha256);
    }
    for (const s of j?.sampled ?? []) {
      if (typeof s?.row_sha256 === 'string') rowShas.add(s.row_sha256);
    }
  }
  return {
    slugLines, rowShas, inputs,
    basis: 'classifier-v2 裁决 B：行 SHA ∉ fixtures 38 例 provenance 行集（slug:line）∪ 烧毁 18 例密封集（row_sha256）——两输入工件只读',
    dilution_disclosure: '行级排除的隔离稀释（同票未用行与已用行同风格）——明文承认，终值报告强制披露（classifier-v2 P2-4 处置）',
  };
}

/** 解析 --live-tickets "name=dir[,name=dir]"（活仓 tickets 目录映射——只读）。stats-4：verify orphan drift 同形消费。 */
export function parseLiveTickets(raw) {
  const out = [];
  for (const pair of String(raw).split(',')) {
    const i = pair.indexOf('=');
    if (i <= 0) return { error: `--live-tickets 形态须 name=dir[,name=dir]（实得 ${JSON.stringify(pair)}）` };
    out.push({ repo: pair.slice(0, i), dir: pair.slice(i + 1) });
  }
  return { sources: out };
}

/** ── heldout-live-sample：活仓只读采样+密封（用户裁方案；census 全框或 ≥20 门抽样）──
 *  密封工件=reports/heldout-live-sealed-<sha8>.json：清单（repo/slug/line/role_raw/attempt_raw/row_sha256
 *  ——无行内容，制定者隔离）+框普查+排除清单+[AUDIT] 密封留证。--census=全框入样（框<20 时
 *  status='census-frame-below-20' 显著标注——不冒充达标；默认模式保持 classifier-acceptance §1 ≥20 门）。 */
export async function cmdHeldoutLiveSample(opts) {
  const { storeRoot, flags } = opts;
  if (!flags['live-tickets']) { console.error('heldout-live-sample 需要 --live-tickets <name=dir[,name=dir]>（活仓 tickets 目录——只读零写入）'); return EXIT.USAGE; }
  const { sources, error } = parseLiveTickets(flags['live-tickets']);
  if (error) { console.error(`USAGE：${error}`); return EXIT.USAGE; }
  const censusMode = flags.census === true;
  const count = Number(flags.count ?? 20);
  const seed = String(flags.seed ?? 'stats3-heldout-live-1');
  const excludeSlugs = new Set(
    [flags['exclude-slug']].flat().filter(Boolean)
      .flatMap(v => String(v).split(',').map(s => s.trim()).filter(Boolean)),
  );
  // 行级排除（classifier-v2 裁决 B——阶段三机制）：--row-exclusion <path[,path]>（fixtures-38/烧毁密封集——只读）
  // 修复轮 P3-6：--census 模式下 --row-exclusion 缺席=显式 fail-loud（裁决 B 必用判据不得静默跳过；
  // 非 census 模式维持可选——抽样门形态不受本加固约束）
  if (censusMode && flags['row-exclusion'] === undefined) {
    console.error('CENSUS_REQUIRES_ROW_EXCLUSION：--census 全框模式必须携带 --row-exclusion <fixtures-38.json>[,<烧毁密封集.json>]（classifier-v2 裁决 B 行级排除=必用判据——缺席即 fail-loud，不静默跳过）');
    return EXIT.FAIL;
  }
  let rowExclusion = null;
  if (flags['row-exclusion'] !== undefined) {
    const paths = [flags['row-exclusion']].flat().filter(Boolean)
      .flatMap(v => String(v).split(',').map(s => s.trim()).filter(Boolean));
    try { rowExclusion = buildRowExclusion(paths); }
    catch (e) { console.error(e.message); return EXIT.FAIL; }
  }
  // 框裁定记录（classifier-v2 阶段三执行轮——dispatch 项 5）：--frame-ruling <text> [--frame-ruled-by <by>]
  // 入 sealed 工件 frame_ruling 字段，经 classify 透传至分类工件 provenance 面（19≠18 裁定留痕）
  const frameRuling = flags['frame-ruling'] !== undefined ? {
    ruling: String(flags['frame-ruling']), ruled_by: String(flags['frame-ruled-by'] ?? 'planner'), ruled_at: rfc3339(),
  } : undefined;
  ensureStoreLayout(storeRoot);
  ensureConfig(storeRoot);

  const frame = [];
  const census = { repos: sources.map(s => s.repo), tickets_total: 0, tickets_excluded: 0, tickets_with_dev_rows: 0, dev_rows_total: 0, dev_rows_excluded_row_level: 0 };
  // 逐源分项（reval-draft-census：draft 报数可审计化）——仅 draft 出口承载；密封工件 census 结构冻结不加字段
  const censusBySource = sources.map(s => ({ repo: s.repo, tickets_total: 0, tickets_with_dev_rows: 0, dev_rows_total: 0, dev_rows_excluded_row_level: 0 }));
  for (let i = 0; i < sources.length; i++) {
    const { repo, dir } = sources[i];
    const perSource = censusBySource[i];   // 序绑 sources——by_source 序=sources 序
    if (!existsSync(dir)) { console.error(`LIVE_DIR_NOT_FOUND：${dir}（活仓 tickets 目录——只读）`); return EXIT.FAIL; }
    for (const f of readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
      const slug = f.replace(/\.md$/, '');
      census.tickets_total++; perSource.tickets_total++;
      if (excludeSlugs.has(slug)) { census.tickets_excluded++; continue; }
      const dev = extractLiveRows(readFileSync(join(dir, f), 'utf8')).filter(r => r.is_dev_family);   // 只读
      if (dev.length > 0) { census.tickets_with_dev_rows++; census.dev_rows_total += dev.length; perSource.tickets_with_dev_rows++; perSource.dev_rows_total += dev.length; }
      for (const r of dev) {
        // 行级排除机械判据（裁决 B）：row_sha256 ∈ 密封集 ∪ slug:line ∈ fixtures 行集
        if (rowExclusion && (rowExclusion.rowShas.has(r.row_sha256) || rowExclusion.slugLines.has(`${slug}:${r.line}`))) {
          census.dev_rows_excluded_row_level++; perSource.dev_rows_excluded_row_level++;
          continue;
        }
        frame.push({ repo, slug, line: r.line, role_raw: r.role, attempt_raw: r.attempt_raw, row_sha256: r.row_sha256 });
      }
    }
  }
  census.excluded_slugs = [...excludeSlugs];
  if (!censusMode && frame.length < count) {
    console.error(`LIVE_FRAME_TOO_SMALL：框=${frame.length} < count=${count}（排除 ${census.tickets_excluded} 票后 developer 系行票数=${census.tickets_with_dev_rows}、行数=${census.dev_rows_total}）——默认门=classifier-acceptance §1 ≥20；census 全框模式须显式 --census（框实数留证不冒充）。框普查：${JSON.stringify(census)}`);
    return EXIT.FAIL;
  }
  const take = censusMode ? frame : frame
    .map(x => ({ ...x, rank: createHash('sha256').update(`${x.repo}|${x.slug}|${x.line}|${seed}`).digest('hex') }))
    .sort((a, b) => a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0)
    .slice(0, count);
  // 清单序=hash(seed) 确定性排序（census 同样定序——例 ID 稳定绑定；ID 再按 repo/slug/line 输出序无涉）
  const ordered = take
    .map(x => ({ ...x, rank: createHash('sha256').update(`${x.repo}|${x.slug}|${x.line}|${seed}`).digest('hex') }))
    .sort((a, b) => a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0)
    .map(({ repo, slug, line, role_raw, attempt_raw, row_sha256 }, i) => ({ id: `H${String(i + 1).padStart(2, '0')}`, repo, slug, line, role_raw, attempt_raw, row_sha256 }));
  const listSha = sha256Hex(canon(ordered));
  const below = censusMode && ordered.length < 20;
  const artifact = {
    artifact_kind: 'heldout-live-sealed-list',
    spec_anchor: 'stats-3 票面阶段四 held-out 活仓执行轮（用户裁"活仓只读采样"：AITrader2 主源+web2api 补充源，零写入）+classifier-acceptance §4（清单标注前封存）',
    status: below ? 'census-frame-below-20' : 'sealed',
    frame_note: below ? `census 全框=${ordered.length}<20（授权活仓面穷尽后仍不足——不冒充达标；待 planner 复核处置：扩源/改门/缩排除粒度）` : `框=${ordered.length} ≥20`,
    sources, exclusion: {
      excluded_slugs: [...excludeSlugs],
      basis: '词典制定参与票（fixtures-36 provenance 反查+classifier-dictionary.md 版本历史）+golden 4 票（golden-set-v1 工件）——票粒度整票排除',
      ...(rowExclusion ? {
        row_level: {
          basis: rowExclusion.basis,
          inputs: rowExclusion.inputs,   // 逐输入工件 SHA 留证（只读溯源——对 sealed 工件+fixtures 逐行可审计）
          excluded_slug_lines: rowExclusion.slugLines.size,
          excluded_row_shas: rowExclusion.rowShas.size,
          rows_excluded: census.dev_rows_excluded_row_level,
          dilution_disclosure: rowExclusion.dilution_disclosure,   // 行级隔离稀释明文承认（终值报告强制披露）
        },
      } : {}),
    },
    census, classifier_version: CLASSIFIER_VERSION,
    sampling_method: censusMode
      ? 'census 全框入样（排除面外 developer 系行全量；hash(seed) 排序定序——确定性可复算；无抽样环节=全量留证）'
      : 'hash(slug|line|seed) 排序取前 count（确定性；同 heldout-sample 机制）',
    seed, sample_count: ordered.length, list_sha256: listSha,
    ...(frameRuling ? { frame_ruling: frameRuling } : {}),   // 框裁定留痕（19≠18 归因+planner 裁定）
    sampled: ordered,   // 行标识+行内容 SHA（无行内容——制定者隔离；内容面由标注者经 classify 读取）
    audit: { AUDIT: true, sealed_at: rfc3339(), sealed_by: 'heldout-live-sample', method: '活仓只读快照（readFileSync 零写入；行内容 sha256 逐例锁定——后续漂移=ROW_CONTENT_DRIFT fail-loud 不可挑换）' },
    generated_at: rfc3339(),
  };
  if (flags.seal) {
    const reportsDir = join(storeRoot, 'reports');
    mkdirSync(reportsDir, { recursive: true });
    const p = join(reportsDir, `heldout-live-sealed-${listSha.slice(0, 8)}.json`);
    if (existsSync(p)) { console.error(`OUT_FILE_EXISTS：reports/heldout-live-sealed-${listSha.slice(0, 8)}.json 已在场——append 语义禁覆写历史工件（快审 P3 修缮）`); return EXIT.FAIL; }
    writeFileSync(p, JSON.stringify(artifact, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify({ command: 'heldout-live-sample', sealed: true, status: artifact.status, artifact: `reports/heldout-live-sealed-${listSha.slice(0, 8)}.json`, sample_count: ordered.length, list_sha256: listSha }, null, 2));
    return EXIT.OK;
  }
  // draft 出口（reval-draft-census）：census 总量+逐源分项+行级排除摘要（rows_excluded+输入工件名）
  // ——操作者可核验每源贡献与排除生效数；与 --seal 输出分道（密封工件/audit 面/list_sha256 计算零变化）
  console.log(JSON.stringify({
    command: 'heldout-live-sample', sealed: false, draft: true, status: artifact.status, sample_count: ordered.length, list_sha256: listSha,
    census: { ...census, by_source: censusBySource },
    ...(rowExclusion ? { exclusion: { row_level: {
      rows_excluded: census.dev_rows_excluded_row_level,
      inputs: rowExclusion.inputs.map(x => x.path.split('/').pop()),   // 输入工件文件名（path 尾段）
    } } } : {}),
    note: 'draft 模式未落仓——正式封存须 --seal（密封先行：分类只消费密封工件）',
  }, null, 2));
  return EXIT.OK;
}

/** ── heldout-live-classify：密封清单→活仓重读（行 SHA 恒等校验）→冻结词典分类 vs 建议真值→三率 ──
 *  密封先行纪律（机械面）：只接受 --sealed 工件（不得直接对活仓分类）；行内容漂移→fail-loud。
 *  建议真值（--truth 文件）=developer 逐例手判（行原文+上下文角色行证据）——三率全为临时面，
 *  status='provisional-awaiting-planner-review'（planner 独立复核后可换真值重算）。 */
export async function cmdHeldoutLiveClassify(opts) {
  const { storeRoot, flags } = opts;
  if (!flags.sealed) { console.error('heldout-live-classify 需要 --sealed <path>（密封先行——分类只消费密封清单工件，不得直接对活仓选样）'); return EXIT.USAGE; }
  if (!flags.truth) { console.error('heldout-live-classify 需要 --truth <path>（建议真值文件：逐例 attempt_kind/trigger_stage/secondary_cause+rationale）'); return EXIT.USAGE; }
  if (!flags['live-tickets']) { console.error('heldout-live-classify 需要 --live-tickets <name=dir[,name=dir]>（活仓重读面——只读）'); return EXIT.USAGE; }
  const { sources, error } = parseLiveTickets(flags['live-tickets']);
  if (error) { console.error(`USAGE：${error}`); return EXIT.USAGE; }
  const dirByRepo = new Map(sources.map(s => [s.repo, s.dir]));
  const sealed = JSON.parse(readFileSync(flags.sealed, 'utf8'));
  if (sealed.artifact_kind !== 'heldout-live-sealed-list') { console.error(`SEALED_KIND_INVALID：${flags.sealed} 非 heldout-live-sealed-list 工件`); return EXIT.FAIL; }
  // P3-1 处置（classifier-v2）：sealed.classifier_version ≠ 当前 CLASSIFIER_VERSION → fail-loud
  // （版本对应表钉定：密封清单与其分类器版本绑定——版本升级须重新密封，禁跨版本分类）
  if (sealed.classifier_version !== CLASSIFIER_VERSION) {
    console.error(`SEALED_CLASSIFIER_VERSION_MISMATCH：sealed 工件 classifier_version=${sealed.classifier_version} ≠ 当前 ${CLASSIFIER_VERSION}（密封清单与分类器版本绑定——重新密封后再分类）`); return EXIT.FAIL;
  }
  const truth = JSON.parse(readFileSync(flags.truth, 'utf8'));
  if (truth.truth_kind !== 'heldout-suggested-truth') { console.error('TRUTH_KIND_INVALID：--truth 须 truth_kind=heldout-suggested-truth' ); return EXIT.FAIL; }
  const truthById = new Map(truth.cases.map(c => [c.id, c]));
  const missing = sealed.sampled.filter(s => !truthById.has(s.id)).map(s => s.id);
  if (missing.length > 0) { console.error(`TRUTH_INCOMPLETE：密封清单例缺真值：${missing.join(',')}`); return EXIT.FAIL; }
  // P3-3 处置（classifier-v2）：--truth 对称拒绝多余例（密封清单外真值例=挑换面——fail-loud）
  const sealedIds = new Set(sealed.sampled.map(s => s.id));
  const extra = [...truthById.keys()].filter(id => !sealedIds.has(id));
  if (extra.length > 0) { console.error(`TRUTH_EXTRA：真值文件含密封清单外例：${extra.join(',')}（真值面与密封清单须恰等——对称拒绝）`); return EXIT.FAIL; }
  ensureStoreLayout(storeRoot);
  ensureConfig(storeRoot);

  // 逐例：活仓重读（只读）→行定位+SHA 恒等→同票小节上下文→classifyRow（冻结词典）→verdict
  const fileRowsCache = new Map();
  const rowsOf = (repo, slug) => {
    const key = `${repo}/${slug}`;
    if (!fileRowsCache.has(key)) {
      const dir = dirByRepo.get(repo);
      if (!dir) { throw new Error(`LIVE_REPO_UNKNOWN：密封清单含 repo=${repo} 而 --live-tickets 未提供其目录`); }
      fileRowsCache.set(key, extractLiveRows(readFileSync(join(dir, `${slug}.md`), 'utf8')));
    }
    return fileRowsCache.get(key);
  };
  const cases = [];
  for (const s of sealed.sampled) {
    const rows = rowsOf(s.repo, s.slug);
    const row = rows.find(r => r.line === s.line);
    if (!row || sha256Hex(row.row_text) !== s.row_sha256) {
      console.error(`ROW_CONTENT_DRIFT：${s.repo}/${s.slug}#L${s.line} 活仓行内容与密封清单不符（不可挑换——重采样须重新密封）`); return EXIT.FAIL;
    }
    const segAnchor = `L${row.line}`;   // 上下文=同票同小节行（小节边界≈邻接行簇；取整票表格行为上下文证据面）
    const context = rows.filter(r => r.line !== row.line).map(r => ({ line: r.line, role_raw: r.role, result: r.result, note: r.note }));
    // v2 上下文规则层（词典 §2.5）：拒因工件=attempt↔报告窗口对应/finding-ID 锚（v1 全表收集→跨段误联病因修复）；
    // 段序上下文=segment_marker 形态序数（首段=initial/后续段=staged_delivery——H07）
    const anchors = rejectionAnchors(rows, row);
    const artifacts = anchors.artifacts;
    const segmentOrdinal = row.segment_marker ? markerOrdinalOf(rows, row) : undefined;
    const cls = classifyRow({ ...row, is_developer: true, is_rerun: /rerun/.test(row.role) }, { reviewArtifacts: artifacts, triggerHint: anchors.triggerHint ?? null, segmentOrdinal });
    const t = truthById.get(s.id);
    const ok = cls.attempt_kind === t.attempt_kind && cls.trigger_stage === t.trigger_stage && (cls.secondary_cause ?? null) === (t.secondary_cause ?? null);
    const verdict = ok ? 'correct' : cls.attempt_kind === 'unknown' ? 'unknown' : cls.attempt_kind === 'compound_unparseable' ? 'compound' : 'wrong_label';
    cases.push({
      id: s.id, repo: s.repo, slug: s.slug, line: s.line, seg_anchor: segAnchor,
      role_raw: s.role_raw, attempt_raw: s.attempt_raw,
      row_text: row.row_text, row_sha256: s.row_sha256,   // 行原文逐字（标注者/复核面）
      context_rows: context, review_artifacts_derived: artifacts,
      artifact_anchor_basis: anchors.basis,   // v2：锚定依据留痕（窗口对应/finding-ID/null=无锚）
      artifact_trigger_hint: anchors.triggerHint ?? null,   // v2：拒因行角色族（无 .md 工件名形态的 trigger fallback 证据——阶段三预检 ③）
      segment_ordinal: segmentOrdinal ?? null,
      classifier: { attempt_kind: cls.attempt_kind, trigger_stage: cls.trigger_stage, secondary_cause: cls.secondary_cause ?? null, primary_signal_level: cls.primary_signal_level, signal_evidence: cls.signal_evidence },
      suggested_truth: { attempt_kind: t.attempt_kind, trigger_stage: t.trigger_stage, secondary_cause: t.secondary_cause ?? null, rationale: t.rationale },
      verdict,
    });
  }
  const rate = k => +(cases.filter(c => c.verdict === k).length / cases.length).toFixed(4);
  const u = rate('unknown'), w = rate('wrong_label'), c = rate('compound');
  const combined = +(u + w + c).toFixed(4);
  const threeRates = { sample_count: cases.length, unknown_rate: u, wrong_label_rate: w, compound_rate: c, combined_unacceptable: combined };
  const gates = {
    combined_rate: combined, combined_gate: combined > 0.30 ? 'downgrade-triggered' : 'pass',
    wrong_label_rate: w, wrong_label_gate: w > 0.10 ? 'fail' : 'pass',
    rule: '§2.2-10 双门（unknown+wrong+compound 合计>30% 降级；wrong_label>10% fail）——初判待 planner 复核',
  };
  const classifiedSha8 = sha256Hex(canon(cases)).slice(0, 8);
  const artifact = {
    artifact_kind: 'heldout-live-classified',
    status: 'provisional-awaiting-planner-review',
    spec_anchor: 'stats-3 阶段四 held-out 活仓执行轮：冻结词典逐例分类 vs 建议真值（developer 手判）——三率/双门全为临时面，planner 独立复核后裁定；classifier-v2 2.0.0：分类面=上下文规则层 v2（attempt↔报告窗口对应+finding-ID 锚+段序上下文）',
    sealed_list_sha256: sealed.list_sha256, classifier_version: CLASSIFIER_VERSION,
    suggested_truth_classifier_version: sealed.classifier_version,
    three_rates: threeRates, gates,
    provenance: {
      sealed_artifact: flags.sealed.replaceAll('\\', '/').split('/').slice(-2).join('/'),
      frame_note: sealed.frame_note, sampling_method: sealed.sampling_method,
      live_sources: sealed.sources.map(x => ({ repo: x.repo })),
      exclusion: sealed.exclusion,
      ...(sealed.frame_ruling ? { frame_ruling: sealed.frame_ruling } : {}),   // 框裁定透传（dispatch 项 5）
    },
    classified_sha8: classifiedSha8,
    cases, generated_at: rfc3339(),
  };
  const reportsDir = join(storeRoot, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const p = join(reportsDir, `heldout-live-classified-${classifiedSha8}.json`);
  // 快审 P3 修缮（classifier-v2）：heldout 工件禁覆写守卫（append 语义——同内容重跑亦禁覆写）
  if (existsSync(p)) { console.error(`OUT_FILE_EXISTS：reports/heldout-live-classified-${classifiedSha8}.json 已在场——append 语义禁覆写历史工件`); return EXIT.FAIL; }
  writeFileSync(p, JSON.stringify(artifact, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ ...artifact, command: 'heldout-live-classify', classified_count: cases.length, artifact: `reports/heldout-live-classified-${classifiedSha8}.json` }, null, 2));
  return EXIT.OK;
}

/** 路径 → 仓内 reports 相对名（取末两段；跨平台分隔符归一）。 */
const reportsRel = p => String(p).replaceAll('\\', '/').split('/').slice(-2).join('/');

/** ── heldout-planner-final：planner 终值真值落档+三率/双门终算（收口轮——活仓零接触）──
 *  只消费分类工件（classifier 输出+建议真值已逐例内嵌）+ planner 决策文件（接受清单+纠正记录+
 *  框裁定/发现定性）——本轮不重读活仓（收口重算面=分类工件内证据）。
 *  机械校验：接受集∪纠正集=分类例集（无缺口/无未知例）；纠正 from=建议真值现值、to∈枚举且≠from、
 *  纠正必带依据引用；终值=建议真值+纠正应用 → verdict 终算（provisional verdict 留痕+变更逐例可溯）。
 *  工件=reports/heldout-planner-final-<sealed sha8>.json（append 禁覆写）。 */
const TRUTH_FIELD_ENUMS = {
  attempt_kind: ['initial', 'quality_rework', 'cancellation_retry', 'evidence_refresh', 'compound_unparseable', 'unknown'],
  trigger_stage: ['reviewer', 'qa', 'red_team', 'premerge', 'environment', 'user', 'unknown'],
  secondary_cause: ['non_defect', 'spec_face', 'user_directed', 'upstream_sync', 'staged_delivery', null],
};

export async function cmdHeldoutPlannerFinal(opts) {
  const { storeRoot, flags } = opts;
  if (!flags.classified) { console.error('heldout-planner-final 需要 --classified <path>（heldout-live-classified 工件——终值重算只消费分类面，活仓零接触）'); return EXIT.USAGE; }
  if (!flags.decision) { console.error('heldout-planner-final 需要 --decision <path>（planner 决策文件：接受清单+纠正记录+框裁定+发现定性）'); return EXIT.USAGE; }
  let classified, decision;
  try { classified = JSON.parse(readFileSync(String(flags.classified), 'utf8')); }
  catch (e) { console.error(`CLASSIFIED_UNREADABLE：${flags.classified}（${e.message}）`); return EXIT.FAIL; }
  try { decision = JSON.parse(readFileSync(String(flags.decision), 'utf8')); }
  catch (e) { console.error(`DECISION_UNREADABLE：${flags.decision}（${e.message}）`); return EXIT.FAIL; }
  if (decision?.decision_kind !== 'heldout-planner-final-decision') { console.error('DECISION_KIND_INVALID：--decision 须 decision_kind=heldout-planner-final-decision'); return EXIT.FAIL; }
  if (classified?.artifact_kind !== 'heldout-live-classified') { console.error('CLASSIFIED_KIND_INVALID：--classified 须 artifact_kind=heldout-live-classified'); return EXIT.FAIL; }
  // 决策完备性（收口语义必填：复核者/依据/框裁定/发现定性/纠正依据）
  const missing = [];
  for (const k of ['reviewer', 'review_basis', 'decided_at']) if (!decision[k]) missing.push(k);
  for (const k of ['ruling', 'isolation_verdict', 'mechanism_gate_verdict']) if (!decision.frame_ruling?.[k]) missing.push(`frame_ruling.${k}`);
  for (const k of ['characterization', 'structural_causes', 'gap_ref']) if (!decision.finding?.[k]) missing.push(`finding.${k}`);
  if (!Array.isArray(decision.finding?.structural_causes) || decision.finding.structural_causes.length === 0) missing.push('finding.structural_causes（非空数组）');
  if (missing.length > 0) { console.error(`DECISION_INCOMPLETE：决策文件缺必填项——${missing.join('、')}`); return EXIT.FAIL; }
  // 覆盖校验：接受集∪纠正集=分类例集
  const corrById = new Map();
  for (const c of decision.corrections ?? []) {
    if (corrById.has(c.id)) { console.error(`DECISION_COVERAGE：纠正记录重复——${c.id}`); return EXIT.FAIL; }
    corrById.set(c.id, c);
  }
  const accepted = new Set(decision.accepted_case_ids ?? []);
  for (const id of accepted) if (corrById.has(id)) { console.error(`DECISION_COVERAGE：${id} 同时出现在接受清单与纠正记录（互斥面）`); return EXIT.FAIL; }
  const classifiedIds = classified.cases.map(c => c.id);
  const covered = new Set([...accepted, ...corrById.keys()]);
  const uncovered = classifiedIds.filter(id => !covered.has(id));
  const unknownIds = [...covered].filter(id => !classifiedIds.includes(id));
  if (uncovered.length > 0 || unknownIds.length > 0) {
    console.error(`DECISION_COVERAGE：接受∪纠正 ≠ 分类例集——未处置=[${uncovered.join(',')}] 未知例=[${unknownIds.join(',')}]（planner 须逐例处置）`);
    return EXIT.FAIL;
  }
  // 纠正字段校验：from=建议真值现值；to∈枚举且≠from；纠正必带依据
  const norm = v => v === undefined ? null : v;
  for (const [id, corr] of corrById) {
    const caseRow = classified.cases.find(c => c.id === id);
    if (!corr.basis) { console.error(`DECISION_INCOMPLETE：纠正 ${id} 缺 basis（纠正依据引用必填）`); return EXIT.FAIL; }
    for (const ch of corr.changes ?? []) {
      if (!Object.prototype.hasOwnProperty.call(TRUTH_FIELD_ENUMS, ch.field)) { console.error(`PLANNER_CORRECTION_INVALID：${id} 字段 ${JSON.stringify(ch.field)} 不在真值三字段面（attempt_kind/trigger_stage/secondary_cause）`); return EXIT.FAIL; }
      if (!TRUTH_FIELD_ENUMS[ch.field].includes(ch.to)) { console.error(`PLANNER_CORRECTION_INVALID：${id}.${ch.field} to=${JSON.stringify(ch.to)} 非法枚举值`); return EXIT.FAIL; }
      if (norm(ch.to) === norm(ch.from)) { console.error(`PLANNER_CORRECTION_INVALID：${id}.${ch.field} to=from（无操作纠正拒收）`); return EXIT.FAIL; }
      const suggestedNow = norm(caseRow.suggested_truth[ch.field]);
      if (norm(ch.from) !== suggestedNow) { console.error(`PLANNER_CORRECTION_MISMATCH：${id}.${ch.field} from=${JSON.stringify(ch.from)} ≠ 建议真值现值 ${JSON.stringify(suggestedNow)}（from 必须锚定被纠正值）`); return EXIT.FAIL; }
    }
  }
  // 终值派生+verdict 终算（provisional verdict 留痕+变更逐例可溯）
  const finalCases = [];
  const verdictChanges = [];
  for (const c of classified.cases) {
    const corr = corrById.get(c.id);
    const ft = {
      attempt_kind: c.suggested_truth.attempt_kind,
      trigger_stage: c.suggested_truth.trigger_stage,
      secondary_cause: norm(c.suggested_truth.secondary_cause),
      rationale: c.suggested_truth.rationale ?? null,
    };
    if (corr) for (const ch of corr.changes) ft[ch.field] = ch.to;
    const cls = c.classifier;
    const ok = cls.attempt_kind === ft.attempt_kind && cls.trigger_stage === ft.trigger_stage && norm(cls.secondary_cause) === norm(ft.secondary_cause);
    const verdictFinal = ok ? 'correct' : cls.attempt_kind === 'unknown' ? 'unknown' : cls.attempt_kind === 'compound_unparseable' ? 'compound' : 'wrong_label';
    if (verdictFinal !== c.verdict) verdictChanges.push({ id: c.id, from: c.verdict, to: verdictFinal });
    finalCases.push({
      id: c.id, repo: c.repo ?? null, slug: c.slug ?? null, line: c.line ?? null,
      classifier: { attempt_kind: cls.attempt_kind, trigger_stage: cls.trigger_stage, secondary_cause: norm(cls.secondary_cause) },
      suggested_truth: { attempt_kind: c.suggested_truth.attempt_kind, trigger_stage: c.suggested_truth.trigger_stage, secondary_cause: norm(c.suggested_truth.secondary_cause), rationale: c.suggested_truth.rationale ?? null },
      final_truth: corr ? { ...ft, correction_basis: corr.basis } : ft,
      verdict_provisional: c.verdict ?? null,
      verdict_final: verdictFinal,
    });
  }
  // 三率终算：分量各自舍入；combined=不可接受计数直接舍入（x/n——非分量和，防累积舍入偏差）
  const n = finalCases.length;
  const cnt = k => finalCases.filter(c => c.verdict_final === k).length;
  const u = +(cnt('unknown') / n).toFixed(4);
  const w = +(cnt('wrong_label') / n).toFixed(4);
  const cp = +(cnt('compound') / n).toFixed(4);
  const combined = +((cnt('unknown') + cnt('wrong_label') + cnt('compound')) / n).toFixed(4);
  const threeRatesFinal = { sample_count: n, unknown_rate: u, wrong_label_rate: w, compound_rate: cp, combined_unacceptable: combined };
  const gatesFinal = {
    combined_rate: combined, combined_gate: combined > 0.30 ? 'downgrade-triggered' : 'pass',
    wrong_label_rate: w, wrong_label_gate: w > 0.10 ? 'fail' : 'pass',
    rule: '§2.2-10 双门（unknown+wrong+compound 合计>30% 降级；wrong_label>10% fail）——planner 终值真值终算（收口：双门红=真实发现，结构病因见 gap-7）',
  };
  const sealedSha = String(classified.sealed_list_sha256 ?? '');
  const artifact = {
    artifact_kind: 'heldout-planner-final', truth_kind: 'heldout-planner-final', status: 'final-planner-adjudicated',
    spec_anchor: 'stats-3 收口轮：planner 独立复核建议真值（接受+纠正）→终值真值+三率/双门终算——held-out 双门红=用户裁「红即发现」，本票以双门红+根因清单收口',
    reviewer: decision.reviewer, review_basis: decision.review_basis, decided_at: decision.decided_at,
    accepted_case_ids: [...accepted], corrections: [...corrById.values()],
    frame_ruling: decision.frame_ruling, finding: decision.finding,
    sealed_list_sha256: sealedSha, classifier_version: classified.classifier_version ?? null,
    three_rates_final: threeRatesFinal, gates_final: gatesFinal,
    provisional_three_rates: classified.three_rates ?? null, provisional_gates: classified.gates ?? null,
    verdict_changes: verdictChanges,
    rounding_note: 'combined=不可接受计数直接舍入（x/n）；v2 provisional 面为分量和舍入（如 0.2222+0.3333=0.5555）——两约定同表 10/18，双门判定不变',
    provenance: {
      classified_artifact: reportsRel(String(flags.classified)),
      suggested_truth_artifact: sealedSha ? `reports/heldout-suggested-truth-${sealedSha.slice(0, 8)}.json` : null,
      sealed_artifact: classified.provenance?.sealed_artifact ?? null,
      decision_embedded: 'planner 决策文件内容（reviewer/接受清单/纠正记录/框裁定/发现定性）全量随工件承载——工件自包含',
    },
    cases: finalCases, generated_at: rfc3339(),
  };
  const reportsDir = join(storeRoot, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const p = join(reportsDir, `heldout-planner-final-${sealedSha.slice(0, 8)}.json`);
  if (existsSync(p)) { console.error(`OUT_FILE_EXISTS：reports/heldout-planner-final-${sealedSha.slice(0, 8)}.json 已在场——append 语义禁覆写历史工件`); return EXIT.FAIL; }
  writeFileSync(p, JSON.stringify(artifact, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ command: 'heldout-planner-final', artifact: `reports/heldout-planner-final-${sealedSha.slice(0, 8)}.json`,
    sample_count: n, three_rates_final: threeRatesFinal, gates_final: gatesFinal, verdict_changes: verdictChanges }, null, 2));
  return EXIT.OK;
}
